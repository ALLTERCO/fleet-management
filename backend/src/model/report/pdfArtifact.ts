import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import bidiFactory from 'bidi-js';
import PDFDocument from 'pdfkit';
import {tuning} from '../../config';
import {
    type CsvMeta,
    sanitizeFileName,
    UPLOADS_DIR
} from '../../modules/csvExport';
import {formatProseNumber} from '../../modules/i18n/localeNumber';
import {
    beginPdfRender,
    pdfTextNeedsComplexRendering,
    recordPdfRender
} from './pdfPerformance';
import {cell, prettySection} from './reportHtmlShared';

const PAGE_MARGIN = 42;
const PAGE_FOOTER_HEIGHT = 24;
const ROW_GAP = 7;
const MAX_CELL_CHARS = 2_000;
// Progress cadence while drawing. Time-based, not row-based: a small report
// whose rows are slow must still visibly move, and a huge one must not flood
// the channel. The host adds the heartbeat that covers a single slow row.
const PDF_PROGRESS_MIN_INTERVAL_MS = 500;
// Row counts are whole numbers; the region only decides how they are grouped.
const ROW_COUNT_DIGITS: Intl.NumberFormatOptions = {maximumFractionDigits: 0};
const bidi = bidiFactory();
const graphemeSegmenter = new Intl.Segmenter(undefined, {
    granularity: 'grapheme'
});

const COLORS = {
    brand: '#4495D1',
    brandDark: '#003C82',
    ink: '#122A4F',
    line: '#E3E7EE',
    muted: '#5B6B82',
    pale: '#F4F7FB',
    white: '#FFFFFF'
} as const;

const FONT_BASE = '@fontsource/noto-sans/files';
const FONT_SCRIPTS = [
    'latin',
    'latin-ext',
    'cyrillic',
    'cyrillic-ext',
    'greek',
    'greek-ext',
    'devanagari'
] as const;
type NotoScript = (typeof FONT_SCRIPTS)[number];
type OutlineScript = 'arabic' | 'hebrew' | 'bengali' | 'thai' | 'emoji';
type FontScript = NotoScript | OutlineScript | 'unifont';

const VENDORED_FONT_PATHS: Record<OutlineScript, string> = {
    arabic: fontAsset('noto-sans-arabic-arabic-400-normal.woff'),
    hebrew: fontAsset('noto-sans-hebrew-hebrew-400-normal.woff'),
    bengali: fontAsset('noto-sans-bengali-bengali-400-normal.woff'),
    thai: fontAsset('noto-sans-thai-thai-400-normal.woff'),
    emoji: fontAsset('noto-emoji-9-400-normal.woff')
};

export interface PdfArtifactWriter {
    readonly filename: string;
    bytesWritten(): number;
    write(row: Record<string, unknown>): Promise<void>;
    close(meta?: Record<string, unknown>): Promise<CsvMeta>;
    destroy(error: Error): void;
}

/** One section of the document, already capped and compacted for drawing. */
export interface PdfRenderSection {
    name: string;
    rows: readonly Record<string, unknown>[];
}

/**
 * Everything the drawing pass needs, and nothing that cannot cross a thread
 * boundary: plain data only, so the render runs in a worker.
 */
export interface PdfRenderInput {
    safeName: string;
    filename: string;
    outputPath: string;
    temporaryPath: string;
    title: string;
    subtitle: string;
    locale: string;
    generatedAt: string;
    sections: PdfRenderSection[];
    /** Rows that survived the per-section cap, for the truncation note. */
    renderedRows: number;
    /** Rows the report produced in total, for the truncation note. */
    totalRows: number;
    maxBytes: number;
}

export interface PdfRenderProgress {
    drawnRows: number;
    totalRows: number;
}

export interface PdfRenderOptions {
    /** Forward movement only: fires when rows have actually been drawn. */
    onProgress?: (progress: PdfRenderProgress) => void;
    /**
     * Liveness while the render is quiet. It restates the last known position
     * and never claims rows that were not drawn, so a consumer must not let it
     * advance a percentage — only `onProgress` may do that.
     */
    onHeartbeat?: (last: PdfRenderProgress) => void;
    heartbeatMs?: number;
    /** Polled while the render is queued and while it runs; true stops it. */
    shouldCancel?: () => Promise<boolean>;
    /** Injectable clock for the progress cadence. Tests drive it. */
    now?: () => number;
}

export type PdfRenderRunner = (
    input: PdfRenderInput,
    options?: PdfRenderOptions
) => Promise<{bytes: number}>;

export interface PdfArtifactRequest {
    name: string;
    title: string;
    subtitle: string;
    /** The organization's region (BCP-47), so person-facing counts in the
     *  document read the way the rest of its reports do. */
    locale: string;
    generatedAt?: string;
    /**
     * Where the drawing pass runs. Required, not defaulted: drawing a report
     * takes tens of seconds, so a caller must say out loud that it is handing
     * the work to the worker rather than freezing this thread by omission.
     */
    render: PdfRenderRunner;
    onProgress?: (progress: PdfRenderProgress) => void;
    onHeartbeat?: (last: PdfRenderProgress) => void;
    shouldCancel?: () => Promise<boolean>;
}

/**
 * Draw a whole document and write it to its file. Every expensive pdfkit call
 * in the product happens inside here, which is why it is plain-data in and a
 * byte count out: the report worker runs it off the main thread so a long
 * render cannot stall requests, redis heartbeats or device connections.
 */
export async function renderPdfDocument(
    input: PdfRenderInput,
    options: PdfRenderOptions = {}
): Promise<{bytes: number}> {
    await fs.unlink(input.temporaryPath).catch(() => undefined);
    const output = fsSync.createWriteStream(input.temporaryPath, {flags: 'wx'});
    const limiter = new PdfByteLimit(input.maxBytes);
    const document = new PDFDocument({
        autoFirstPage: false,
        bufferPages: false,
        compress: true,
        tagged: true,
        pdfVersion: '1.7',
        info: {
            Title: input.title,
            Author: 'Shelly Fleet Manager',
            Subject: input.subtitle
        },
        margins: {
            top: PAGE_MARGIN,
            right: PAGE_MARGIN,
            bottom: PAGE_MARGIN + PAGE_FOOTER_HEIGHT,
            left: PAGE_MARGIN
        },
        size: 'A4'
    });
    const pipelineDone = pipeline(document, limiter, output);
    void pipelineDone.catch(() => undefined);
    const renderer = new PdfDocumentRenderer({
        document,
        limiter,
        pipelineDone,
        input,
        onProgress: options.onProgress,
        now: options.now ?? Date.now
    });
    return renderer.render();
}

export async function createPdfArtifactWriter(
    request: PdfArtifactRequest
): Promise<PdfArtifactWriter> {
    const safeName = sanitizeFileName(request.name);
    const filename = `${safeName}.pdf`;
    const outputPath = path.join(UPLOADS_DIR, filename);
    return new BufferingPdfWriter({
        safeName,
        filename,
        outputPath,
        temporaryPath: `${outputPath}.tmp`,
        title: request.title,
        subtitle: request.subtitle,
        locale: request.locale,
        generatedAt: request.generatedAt ?? new Date().toISOString(),
        render: request.render,
        onProgress: request.onProgress,
        onHeartbeat: request.onHeartbeat,
        shouldCancel: request.shouldCancel
    });
}

/**
 * Main-thread half of the PDF artifact: it only buffers and groups rows, which
 * is cheap and interleaves with the rest of the report. The drawing pass is
 * handed to `render`, which in production is the worker-backed one.
 */
class BufferingPdfWriter implements PdfArtifactWriter {
    readonly filename: string;
    private readonly input: Omit<
        PdfRenderInput,
        'sections' | 'renderedRows' | 'totalRows'
    >;
    private readonly render: PdfRenderRunner;
    private readonly onProgress?: (progress: PdfRenderProgress) => void;
    private readonly onHeartbeat?: (last: PdfRenderProgress) => void;
    private readonly shouldCancel?: () => Promise<boolean>;
    private readonly rows = new SectionAwarePdfRows(
        tuning.report.pdfSummaryMaxRows
    );
    private totalRows = 0;
    private complexRows = 0;
    private bytes = 0;
    private closed = false;

    constructor(input: {
        safeName: string;
        filename: string;
        outputPath: string;
        temporaryPath: string;
        title: string;
        subtitle: string;
        locale: string;
        generatedAt: string;
        render: PdfRenderRunner;
        onProgress?: (progress: PdfRenderProgress) => void;
        onHeartbeat?: (last: PdfRenderProgress) => void;
        shouldCancel?: () => Promise<boolean>;
    }) {
        this.filename = input.filename;
        this.render = input.render;
        this.onProgress = input.onProgress;
        this.onHeartbeat = input.onHeartbeat;
        this.shouldCancel = input.shouldCancel;
        this.input = {
            safeName: input.safeName,
            filename: input.filename,
            outputPath: input.outputPath,
            temporaryPath: input.temporaryPath,
            title: input.title,
            subtitle: input.subtitle,
            locale: input.locale,
            generatedAt: input.generatedAt,
            maxBytes: tuning.report.pdfMaxBytes
        };
    }

    bytesWritten(): number {
        return this.bytes;
    }

    async write(row: Record<string, unknown>): Promise<void> {
        if (this.closed) throw new Error('PDF artifact writer is closed');
        this.totalRows += 1;
        if (
            Object.entries(row).some(
                ([key, value]) =>
                    key !== 'section' &&
                    pdfTextNeedsComplexRendering(cell(value))
            )
        ) {
            this.complexRows += 1;
        }
        this.rows.add(row);
    }

    async close(meta: Record<string, unknown> = {}): Promise<CsvMeta> {
        if (this.closed) throw new Error('PDF artifact writer is closed');
        this.closed = true;
        const startedAt = performance.now();
        const finishCapacity = beginPdfRender();
        let failed = true;
        try {
            const {bytes} = await this.render(
                {
                    ...this.input,
                    sections: this.rows.sections().map((section) => ({
                        name: section.name,
                        rows: [...section.rows]
                    })),
                    renderedRows: this.rows.size,
                    totalRows: this.totalRows
                },
                {
                    onProgress: this.onProgress,
                    onHeartbeat: this.onHeartbeat,
                    shouldCancel: this.shouldCancel
                }
            );
            this.bytes = bytes;
            failed = false;
            return {
                id: this.input.safeName,
                file: `uploads/reports/${this.filename}`,
                name: this.input.safeName,
                generated: this.input.generatedAt,
                size: bytes,
                ...meta
            };
        } catch (error) {
            await removePdfArtifacts(this.input);
            throw error;
        } finally {
            finishCapacity();
            recordPdfRender({
                durationMs: performance.now() - startedAt,
                complexRows: this.complexRows,
                failed
            });
        }
    }

    destroy(_error: Error): void {
        if (this.closed) return;
        this.closed = true;
        void removePdfArtifacts(this.input);
    }
}

async function removePdfArtifacts(paths: {
    temporaryPath: string;
    outputPath: string;
}): Promise<void> {
    await fs.unlink(paths.temporaryPath).catch(() => undefined);
    await fs.unlink(paths.outputPath).catch(() => undefined);
}

class PdfDocumentRenderer {
    private readonly document: PDFKit.PDFDocument;
    private readonly limiter: PdfByteLimit;
    private readonly pipelineDone: Promise<void>;
    private readonly outputPath: string;
    private readonly temporaryPath: string;
    private readonly title: string;
    private readonly subtitle: string;
    private readonly locale: string;
    private readonly generatedAt: string;
    private readonly sections: PdfRenderSection[];
    private readonly renderedRows: number;
    private readonly totalRows: number;
    private readonly onProgress?: (progress: PdfRenderProgress) => void;
    private readonly now: () => number;
    private lastProgressAt = 0;
    private pageNumber = 0;

    constructor(input: {
        document: PDFKit.PDFDocument;
        limiter: PdfByteLimit;
        pipelineDone: Promise<void>;
        input: PdfRenderInput;
        onProgress?: (progress: PdfRenderProgress) => void;
        now: () => number;
    }) {
        this.document = input.document;
        this.limiter = input.limiter;
        this.pipelineDone = input.pipelineDone;
        this.outputPath = input.input.outputPath;
        this.temporaryPath = input.input.temporaryPath;
        this.title = input.input.title;
        this.subtitle = input.input.subtitle;
        this.locale = input.input.locale;
        this.generatedAt = input.input.generatedAt;
        this.sections = input.input.sections;
        this.renderedRows = input.input.renderedRows;
        this.totalRows = input.input.totalRows;
        this.onProgress = input.onProgress;
        this.now = input.now;
    }

    async render(): Promise<{bytes: number}> {
        try {
            registerFonts(this.document);
            this.addPage(true);
            this.drawRows();
            this.drawTruncationNote();
            this.drawFooter();
            this.document.end();
            await this.pipelineDone;
            await fs.rename(this.temporaryPath, this.outputPath);
            const stat = await fs.stat(this.outputPath);
            return {bytes: stat.size};
        } catch (error) {
            this.document.destroy(error as Error);
            await this.pipelineDone.catch(() => undefined);
            await this.removeArtifacts();
            throw error;
        }
    }

    private drawRow(row: Record<string, unknown>): void {
        const presentation = this.rowPresentation(row);
        if (!presentation) {
            this.document.y += ROW_GAP;
            return;
        }
        const {text, width, cardHeight} = presentation;
        this.ensureSpace(cardHeight + ROW_GAP);
        const y = this.document.y;
        this.document
            .roundedRect(PAGE_MARGIN, y, this.contentWidth(), cardHeight, 5)
            .fillAndStroke(COLORS.pale, COLORS.line);
        drawMultiscriptText(this.document, text, {
            x: PAGE_MARGIN + 12,
            y: y + 8,
            width,
            fontSize: 8.5,
            color: COLORS.ink,
            lineGap: 1
        });
        this.document.y = y + cardHeight + ROW_GAP;
    }

    private drawRows(): void {
        let drawn = 0;
        // Say we have started before the first row is drawn, so a caller sees
        // the stage begin rather than waiting out the first interval.
        this.emitProgress(0, true);
        for (const section of this.sections) {
            const firstRow = section.rows[0];
            const firstPresentation = firstRow
                ? this.rowPresentation(firstRow)
                : null;
            this.ensureSpace(
                30 + (firstPresentation?.cardHeight ?? 0) + ROW_GAP
            );
            this.drawSectionHeading(section.name);
            for (const row of section.rows) {
                this.drawRow(row);
                drawn += 1;
                this.emitProgress(drawn, false);
            }
        }
        this.emitProgress(drawn, true);
    }

    private emitProgress(drawnRows: number, force: boolean): void {
        if (!this.onProgress) return;
        const now = this.now();
        if (
            !force &&
            now - this.lastProgressAt < PDF_PROGRESS_MIN_INTERVAL_MS
        ) {
            return;
        }
        this.lastProgressAt = now;
        this.onProgress({drawnRows, totalRows: this.renderedRows});
    }

    private rowPresentation(row: Record<string, unknown>): {
        text: string;
        width: number;
        cardHeight: number;
    } | null {
        const values = Object.entries(row)
            .filter(([key, value]) => key !== 'section' && cell(value) !== '')
            .map(([key, value]) => `${columnLabel(key)}: ${cell(value)}`);
        if (values.length === 0) return null;
        const text = truncateText(values.join('  |  '));
        const width = this.contentWidth() - 24;
        const textHeight = measureText(this.document, text, width, 8.5);
        return {text, width, cardHeight: Math.max(27, textHeight + 15)};
    }

    private drawSectionHeading(section: string): void {
        this.ensureSpace(30);
        this.document
            .font(fontName('latin', 700))
            .fontSize(12)
            .fillColor(COLORS.brandDark)
            .text(prettySection(section), PAGE_MARGIN + 8, this.document.y, {
                width: this.contentWidth() - 8,
                lineBreak: false
            });
        const y = this.document.y - 14;
        this.document.rect(PAGE_MARGIN, y, 3, 16).fill(COLORS.brand);
        this.document.y += 8;
    }

    private rowCount(value: number): string {
        return formatProseNumber(value, this.locale, ROW_COUNT_DIGITS);
    }

    private drawTruncationNote(): void {
        if (this.renderedRows >= this.totalRows) return;
        this.ensureSpace(38);
        const note =
            `Showing ${this.rowCount(this.renderedRows)} section-balanced rows of ` +
            `${this.rowCount(this.totalRows)}. The companion CSV contains the complete dataset.`;
        const y = this.document.y;
        this.document
            .roundedRect(PAGE_MARGIN, y, this.contentWidth(), 30, 5)
            .fill(COLORS.pale);
        this.document
            .font(fontName('latin', 400))
            .fontSize(8.5)
            .fillColor(COLORS.muted)
            .text(note, PAGE_MARGIN + 10, y + 9, {
                width: this.contentWidth() - 20
            });
        this.document.y = y + 38;
    }

    private addPage(first: boolean): void {
        this.document.addPage();
        this.pageNumber += 1;
        if (first) {
            const y = PAGE_MARGIN;
            this.document
                .roundedRect(PAGE_MARGIN, y, this.contentWidth(), 88, 9)
                .fill(COLORS.ink);
            this.document
                .font(fontName('latin', 700))
                .fontSize(22)
                .fillColor(COLORS.white)
                .text(this.title, PAGE_MARGIN + 18, y + 17, {
                    width: this.contentWidth() - 36
                });
            this.document
                .font(fontName('latin', 400))
                .fontSize(9.5)
                .fillColor('#CFE3F6')
                .text(this.subtitle, PAGE_MARGIN + 18, y + 48, {
                    width: this.contentWidth() - 36,
                    height: 27,
                    ellipsis: true
                });
            this.document.y = y + 108;
            return;
        }
        this.document
            .font(fontName('latin', 700))
            .fontSize(9)
            .fillColor(COLORS.brandDark)
            .text(`${this.title} - continued`, PAGE_MARGIN, PAGE_MARGIN, {
                width: this.contentWidth(),
                lineBreak: false
            });
        this.document
            .moveTo(PAGE_MARGIN, PAGE_MARGIN + 16)
            .lineTo(PAGE_MARGIN + this.contentWidth(), PAGE_MARGIN + 16)
            .strokeColor(COLORS.line)
            .stroke();
        this.document.y = PAGE_MARGIN + 28;
    }

    private ensureSpace(height: number): void {
        if (this.document.y + height <= this.contentBottom()) return;
        this.drawFooter();
        this.addPage(false);
    }

    private drawFooter(): void {
        const y = this.document.page.height - PAGE_MARGIN - 10;
        const bottomMargin = this.document.page.margins.bottom;
        // The footer lives inside the reserved bottom band. Temporarily remove
        // PDFKit's automatic flow margin so positioning it there cannot create
        // a footer-only page.
        this.document.page.margins.bottom = 0;
        this.document
            .font(fontName('latin', 400))
            .fontSize(7.5)
            .fillColor(COLORS.muted)
            .text(
                `Shelly Fleet Manager | Generated ${this.generatedAt} | Page ${this.pageNumber}`,
                PAGE_MARGIN,
                y,
                {width: this.contentWidth(), align: 'center', lineBreak: false}
            );
        this.document.page.margins.bottom = bottomMargin;
    }

    private contentWidth(): number {
        return this.document.page.width - PAGE_MARGIN * 2;
    }

    private contentBottom(): number {
        return this.document.page.height - PAGE_MARGIN - PAGE_FOOTER_HEIGHT;
    }

    private async removeArtifacts(): Promise<void> {
        await Promise.all([
            fs.unlink(this.temporaryPath).catch(() => undefined),
            fs.unlink(this.outputPath).catch(() => undefined)
        ]);
    }
}

class PdfByteLimit extends Transform {
    bytes = 0;
    private readonly maxBytes: number;

    constructor(maxBytes: number) {
        super();
        this.maxBytes = maxBytes;
    }

    override _transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null, data?: Buffer) => void
    ): void {
        const next = this.bytes + chunk.length;
        if (next > this.maxBytes) {
            callback(
                new Error(
                    `PDF report exceeds the safe ${this.maxBytes}-byte limit; use CSV or XLSX for the complete dataset.`
                )
            );
            return;
        }
        this.bytes = next;
        callback(null, chunk);
    }
}

function registerFonts(document: PDFKit.PDFDocument): void {
    for (const script of FONT_SCRIPTS) {
        for (const weight of [400, 700] as const) {
            document.registerFont(
                fontName(script, weight),
                require.resolve(
                    `${FONT_BASE}/noto-sans-${script}-${weight}-normal.woff`
                )
            );
        }
    }
    document.registerFont(
        fontName('unifont', 400),
        require.resolve(
            '@fontsource/unifont/files/unifont-latin-400-normal.woff'
        )
    );
    for (const [script, fontPath] of Object.entries(VENDORED_FONT_PATHS)) {
        document.registerFont(fontName(script as OutlineScript, 400), fontPath);
    }
}

function fontName(script: FontScript, weight: 400 | 700): string {
    if (script === 'unifont') return 'Unifont-400';
    if (script in VENDORED_FONT_PATHS) return `Noto-${script}-400`;
    return `NotoSans-${script}-${weight}`;
}

function fontAsset(name: string): string {
    return path.resolve(__dirname, '../../../assets/pdf-fonts', name);
}

function columnLabel(key: string): string {
    return key
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

function truncateText(value: string): string {
    return value.length <= MAX_CELL_CHARS
        ? value
        : `${value.slice(0, MAX_CELL_CHARS - 3)}...`;
}

function measureText(
    document: PDFKit.PDFDocument,
    value: string,
    width: number,
    fontSize: number
): number {
    return layoutMultiscriptText(document, value, width, fontSize, 1).height;
}

function drawMultiscriptText(
    document: PDFKit.PDFDocument,
    value: string,
    options: {
        x: number;
        y: number;
        width: number;
        fontSize: number;
        color: string;
        lineGap: number;
    }
): void {
    const layout = layoutMultiscriptText(
        document,
        value,
        options.width,
        options.fontSize,
        options.lineGap
    );
    const semanticLayer = needsSemanticLayer(document, layout.logicalText);
    layout.lines.forEach((line, lineIndex) => {
        let x = options.x;
        const y = options.y + lineIndex * layout.lineHeight;
        for (const run of line) {
            if (semanticLayer) {
                drawOutlinedRun(document, run, x, y, options.color);
            } else {
                drawVisibleRun(document, run, x, y, options.color);
            }
            x += run.width;
        }
    });
    if (semanticLayer) {
        drawSemanticText(
            document,
            layout.logicalText,
            options.x,
            options.y,
            options.width
        );
    }
}

function drawVisibleRun(
    document: PDFKit.PDFDocument,
    run: PdfTextRun,
    x: number,
    y: number,
    color: string
): void {
    if (run.script in VENDORED_FONT_PATHS) {
        drawOutlinedRun(document, run, x, y, color);
        return;
    }
    // Keep fast, mature Noto text rendering for rows whose PDF encoding is
    // already stable. Rows needing a semantic layer are outlined instead.
    document
        .font(fontName(run.script, 400))
        .fontSize(run.fontSize)
        .fillColor(color)
        .text(run.text, x, y, {lineBreak: false});
}

function needsSemanticLayer(
    document: PDFKit.PDFDocument,
    value: string
): boolean {
    return graphemes(value).some((grapheme) => {
        const script = fontScript(document, grapheme);
        return (
            script === 'devanagari' ||
            script === 'unifont' ||
            script in VENDORED_FONT_PATHS
        );
    });
}

interface FontkitGlyph {
    id: number;
    path: {toSVG(): string};
}

interface FontkitPosition {
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
}

interface FontkitRun {
    glyphs: FontkitGlyph[];
    positions: FontkitPosition[];
    advanceWidth: number;
}

interface FontkitFont {
    ascent: number;
    unitsPerEm: number;
    layout(text: string, features?: readonly string[]): FontkitRun;
}

type PdfDocumentWithFontkit = PDFKit.PDFDocument & {
    _font: {font: FontkitFont};
};

function drawOutlinedRun(
    document: PDFKit.PDFDocument,
    run: PdfTextRun,
    x: number,
    y: number,
    color: string
): void {
    const font = fontkitFont(document, run.script, run.fontSize);
    const shaped = font.layout(run.text);
    const scale = run.fontSize / font.unitsPerEm;
    const baseline = y + font.ascent * scale;
    let penX = x;
    for (let index = 0; index < shaped.glyphs.length; index += 1) {
        const glyph = shaped.glyphs[index]!;
        const position = shaped.positions[index]!;
        document
            .save()
            .translate(
                penX + position.xOffset * scale,
                baseline - position.yOffset * scale
            )
            .scale(scale, -scale)
            .path(glyph.path.toSVG())
            .fill(color)
            .restore();
        penX += position.xAdvance * scale;
    }
}

function drawSemanticText(
    document: PDFKit.PDFDocument,
    logicalText: string,
    x: number,
    y: number,
    width: number
): void {
    // PDFKit encodes RTL text in visual glyph order. Reverse each RTL
    // grapheme run before writing the invisible layer so ToUnicode extraction
    // reconstructs the original logical order.
    const encodedText = encodeSemanticRtlRuns(logicalText);
    const fontSize = 1;
    const lines: Array<
        Array<{script: 'emoji' | 'unifont'; text: string; width: number}>
    > = [[]];
    let lineWidth = 0;
    for (const grapheme of graphemes(encodedText)) {
        const script = emojiGlyphAvailable(document, grapheme)
            ? 'emoji'
            : 'unifont';
        document.font(fontName(script, 400)).fontSize(fontSize);
        const graphemeWidth = document.widthOfString(grapheme, {features: []});
        if (lineWidth > 0 && lineWidth + graphemeWidth > width) {
            lines.push([]);
            lineWidth = 0;
        }
        const line = lines.at(-1)!;
        const last = line.at(-1);
        if (last?.script === script) {
            last.text += grapheme;
            last.width += graphemeWidth;
        } else {
            line.push({script, text: grapheme, width: graphemeWidth});
        }
        lineWidth += graphemeWidth;
    }
    document.save().fillOpacity(0);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        let cursor = x;
        for (const run of lines[lineIndex]!) {
            document.font(fontName(run.script, 400)).fontSize(fontSize);
            document.text(run.text, cursor, y + lineIndex * 1.25, {
                lineBreak: false,
                features: []
            });
            cursor += run.width;
        }
    }
    document.restore();
}

interface PdfTextRun {
    script: FontScript;
    text: string;
    width: number;
    fontSize: number;
}

interface PdfTextLayout {
    logicalText: string;
    lines: PdfTextRun[][];
    lineHeight: number;
    height: number;
}

function layoutMultiscriptText(
    document: PDFKit.PDFDocument,
    value: string,
    maxWidth: number,
    fontSize: number,
    lineGap: number
): PdfTextLayout {
    const logicalText = pdfDisplayText(document, value);
    const displayText = logicalText;
    const visualText = restoreShapedRtlRuns(
        bidi.getReorderedString(
            displayText,
            bidi.getEmbeddingLevels(displayText)
        )
    );
    const lines: PdfTextRun[][] = [[]];
    let lineWidth = 0;
    const append = (
        text: string,
        script: FontScript,
        width: number,
        runFontSize: number
    ): void => {
        const line = lines.at(-1)!;
        const last = line.at(-1);
        if (last?.script === script) {
            last.text += text;
            last.width += width;
        } else {
            line.push({script, text, width, fontSize: runFontSize});
        }
        lineWidth += width;
    };
    const nextLine = (): void => {
        if (lines.at(-1)?.length === 0) return;
        lines.push([]);
        lineWidth = 0;
    };
    for (const token of visualText.match(/\s+|\S+/gu) ?? []) {
        const whitespace = /^\s+$/u.test(token);
        if (whitespace) {
            if (lineWidth === 0) continue;
            const script = lines.at(-1)?.at(-1)?.script ?? 'latin';
            const runFontSize = fontSizeForScript(script, fontSize);
            const width = shapedWidth(document, script, token, runFontSize);
            if (lineWidth + width > maxWidth) {
                nextLine();
                continue;
            }
            append(token, script, width, runFontSize);
            continue;
        }
        const tokenRuns = measuredRuns(document, token, fontSize);
        const tokenWidth = tokenRuns.reduce((sum, run) => sum + run.width, 0);
        if (lineWidth > 0 && lineWidth + tokenWidth > maxWidth) {
            nextLine();
        }
        if (tokenWidth <= maxWidth) {
            for (const run of tokenRuns) {
                append(run.text, run.script, run.width, run.fontSize);
            }
            continue;
        }
        for (const grapheme of graphemes(token)) {
            const [run] = measuredRuns(document, grapheme, fontSize);
            if (lineWidth > 0 && lineWidth + run.width > maxWidth) nextLine();
            append(run.text, run.script, run.width, run.fontSize);
        }
    }
    if (lines.length > 1 && lines.at(-1)?.length === 0) lines.pop();
    const scripts = new Set(lines.flat().map((run) => run.script));
    let fontLineHeight = 0;
    for (const script of scripts) {
        document
            .font(fontName(script, 400))
            .fontSize(fontSizeForScript(script, fontSize));
        fontLineHeight = Math.max(
            fontLineHeight,
            document.currentLineHeight(true)
        );
    }
    const lineHeight = fontLineHeight + lineGap;
    return {
        logicalText,
        lines,
        lineHeight,
        height: Math.max(fontLineHeight, lines.length * lineHeight - lineGap)
    };
}

function measuredRuns(
    document: PDFKit.PDFDocument,
    value: string,
    fontSize: number
): PdfTextRun[] {
    const runs: PdfTextRun[] = [];
    for (const grapheme of graphemes(value)) {
        const script = renderFontScript(document, grapheme);
        const runFontSize = fontSizeForScript(script, fontSize);
        const last = runs.at(-1);
        if (last?.script === script) {
            last.text += grapheme;
        } else {
            runs.push({
                script,
                text: grapheme,
                width: 0,
                fontSize: runFontSize
            });
        }
    }
    for (const run of runs) {
        run.width = shapedWidth(document, run.script, run.text, run.fontSize);
    }
    return runs;
}

function shapedWidth(
    document: PDFKit.PDFDocument,
    script: FontScript,
    value: string,
    fontSize: number
): number {
    const font = fontkitFont(document, script, fontSize);
    return (font.layout(value).advanceWidth * fontSize) / font.unitsPerEm;
}

function fontkitFont(
    document: PDFKit.PDFDocument,
    script: FontScript,
    fontSize: number
): FontkitFont {
    document.font(fontName(script, 400)).fontSize(fontSize);
    return (document as PdfDocumentWithFontkit)._font.font;
}

function fontSizeForScript(script: FontScript, fontSize: number): number {
    // Unifont prioritizes global BMP coverage over optical sizing. A small,
    // measured increase makes last-resort CJK runs legible beside Noto.
    return script === 'unifont' ? fontSize * 1.08 : fontSize;
}

function graphemes(value: string): string[] {
    return [...graphemeSegmenter.segment(value)].map(({segment}) => segment);
}

function renderFontScript(
    document: PDFKit.PDFDocument,
    grapheme: string
): FontScript {
    return fontScript(document, grapheme);
}

function pdfDisplayText(document: PDFKit.PDFDocument, value: string): string {
    let result = '';
    for (const original of graphemes(value)) {
        if (emojiGlyphAvailable(document, original)) {
            result += original;
            continue;
        }
        for (const scalar of original) {
            const codePoint = scalar.codePointAt(0) ?? 0;
            result +=
                codePoint > 0xffff
                    ? `[U+${codePoint.toString(16).toUpperCase()}]`
                    : scalar;
        }
    }
    return result;
}

function emojiGlyphAvailable(
    document: PDFKit.PDFDocument,
    grapheme: string
): boolean {
    if (
        ![...grapheme].some((scalar) => (scalar.codePointAt(0) ?? 0) > 0xffff)
    ) {
        return false;
    }
    const font = fontkitFont(document, 'emoji', 10);
    const shaped = font.layout(grapheme);
    return shaped.glyphs.length > 0 && shaped.glyphs.every((glyph) => glyph.id);
}

function fontScript(
    document: PDFKit.PDFDocument,
    character: string
): FontScript {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint > 0xffff && emojiGlyphAvailable(document, character)) {
        return 'emoji';
    }
    if (codePoint <= 0x024f) return codePoint <= 0x00ff ? 'latin' : 'latin-ext';
    if (codePoint >= 0x0300 && codePoint <= 0x036f) return 'latin-ext';
    if (codePoint >= 0x0370 && codePoint <= 0x03ff) return 'greek';
    if (codePoint >= 0x1f00 && codePoint <= 0x1fff) return 'greek-ext';
    if (codePoint >= 0x0400 && codePoint <= 0x045f) return 'cyrillic';
    if (codePoint >= 0x0460 && codePoint <= 0x052f) return 'cyrillic-ext';
    if (codePoint >= 0x0590 && codePoint <= 0x05ff) return 'hebrew';
    if (
        (codePoint >= 0x0600 && codePoint <= 0x077f) ||
        (codePoint >= 0x08a0 && codePoint <= 0x08ff) ||
        (codePoint >= 0xfb50 && codePoint <= 0xfdff) ||
        (codePoint >= 0xfe70 && codePoint <= 0xfeff)
    ) {
        return 'arabic';
    }
    if (codePoint >= 0x0900 && codePoint <= 0x097f) return 'devanagari';
    if (codePoint >= 0x0980 && codePoint <= 0x09ff) return 'bengali';
    if (codePoint >= 0x0e00 && codePoint <= 0x0e7f) return 'thai';
    return 'unifont';
}

function restoreShapedRtlRuns(value: string): string {
    return value.replace(
        /[\p{Script=Arabic}\p{Script=Hebrew}\p{Mark}]+/gu,
        (run) => graphemes(run).reverse().join('')
    );
}

function encodeSemanticRtlRuns(value: string): string {
    return value.replace(
        /(?:[\p{Script=Arabic}\p{Script=Hebrew}]\p{Mark}*)+(?:\s+(?:[\p{Script=Arabic}\p{Script=Hebrew}]\p{Mark}*)+)*/gu,
        (run) => graphemes(run).reverse().join('')
    );
}

class SectionAwarePdfRows {
    private readonly limit: number;
    private readonly buckets = new Map<string, Record<string, unknown>[]>();
    private currentSection = 'REPORT';

    constructor(limit: number) {
        this.limit = limit;
    }

    get size(): number {
        let size = 0;
        for (const rows of this.buckets.values()) size += rows.length;
        return size;
    }

    add(row: Record<string, unknown>): void {
        const declaredSection = cell(row.section);
        if (declaredSection) this.currentSection = declaredSection;
        if (!this.buckets.has(this.currentSection)) {
            this.addSection(this.currentSection);
        }
        this.rebalance();
        const bucket = this.buckets.get(this.currentSection)!;
        const sectionCapacity = Math.max(
            1,
            Math.floor(this.limit / this.buckets.size)
        );
        if (bucket.length < sectionCapacity) bucket.push(compactPdfRow(row));
    }

    sections(): Array<{
        name: string;
        rows: readonly Record<string, unknown>[];
    }> {
        return [...this.buckets.entries()].map(([name, rows]) => ({
            name,
            rows
        }));
    }

    private addSection(name: string): void {
        if (this.buckets.size >= this.limit) {
            const oldest = this.buckets.keys().next().value;
            if (oldest !== undefined) this.buckets.delete(oldest);
        }
        this.buckets.set(name, []);
    }

    private rebalance(): void {
        const sectionCapacity = Math.max(
            1,
            Math.floor(this.limit / this.buckets.size)
        );
        for (const rows of this.buckets.values()) {
            if (rows.length > sectionCapacity) rows.length = sectionCapacity;
        }
    }
}

function compactPdfRow(row: Record<string, unknown>): Record<string, unknown> {
    const compact: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row).slice(0, 64)) {
        if (key === 'section') continue;
        const rendered = cell(value);
        if (rendered) compact[key] = truncateText(rendered);
    }
    return compact;
}
