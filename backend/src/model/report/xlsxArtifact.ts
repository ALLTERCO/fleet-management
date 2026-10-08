import {once} from 'node:events';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {Writable} from 'node:stream';
import AdmZip from 'adm-zip';
import {
    type CsvMeta,
    sanitizeFileName,
    UPLOADS_DIR
} from '../../modules/csvExport';

// AdmZip assembles the final ZIP in memory. Spooling the largest member to
// disk keeps row production streaming; these hard limits bound the one final
// in-memory assembly rather than letting a report exhaust the worker.
export const XLSX_MAX_DATA_ROWS = 250_000;
export const XLSX_MAX_SHEET_XML_BYTES = 64 * 1024 * 1024;
const XLSX_MAX_CELL_CHARS = 32_767;

export interface XlsxArtifactWriter {
    readonly filename: string;
    bytesWritten(): number;
    write(row: Record<string, unknown>): Promise<void>;
    close(meta?: Record<string, unknown>): Promise<CsvMeta>;
    destroy(error: Error): void;
}

export async function createXlsxArtifactWriter(
    name: string
): Promise<XlsxArtifactWriter> {
    const safeName = sanitizeFileName(name);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-xlsx-'));
    const sheetPath = path.join(tempDir, 'sheet1.xml');
    const stream = fsSync.createWriteStream(sheetPath, {
        encoding: 'utf8',
        flags: 'wx'
    });
    const writer = new StreamingXlsxWriter({
        safeName,
        tempDir,
        sheetPath,
        stream
    });
    await writer.initialize();
    return writer;
}

class StreamingXlsxWriter implements XlsxArtifactWriter {
    readonly filename: string;
    private readonly safeName: string;
    private readonly tempDir: string;
    private readonly sheetPath: string;
    private readonly stream: Writable;
    private headers: string[] | null = null;
    private rowCount = 0;
    private sheetBytes = 0;
    private closed = false;

    constructor(input: {
        safeName: string;
        tempDir: string;
        sheetPath: string;
        stream: Writable;
    }) {
        this.safeName = input.safeName;
        this.filename = `${input.safeName}.xlsx`;
        this.tempDir = input.tempDir;
        this.sheetPath = input.sheetPath;
        this.stream = input.stream;
    }

    async initialize(): Promise<void> {
        await this.writeXml(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
                '<sheetViews><sheetView workbookViewId="0">' +
                '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
                '</sheetView></sheetViews><sheetData>'
        );
    }

    bytesWritten(): number {
        return this.sheetBytes;
    }

    async write(row: Record<string, unknown>): Promise<void> {
        if (this.closed) throw new Error('XLSX artifact writer is closed');
        if (this.rowCount >= XLSX_MAX_DATA_ROWS) {
            throw new Error(
                `XLSX report exceeds the safe ${XLSX_MAX_DATA_ROWS}-row limit; use CSV for larger exports.`
            );
        }
        if (!this.headers) {
            this.headers = Object.keys(row);
            if (this.headers.length > 16_384) {
                throw new Error("XLSX report exceeds Excel's column limit");
            }
            await this.writeXml(renderRow(this.headers, 1, true));
        } else {
            const unexpected = Object.keys(row).find(
                (key) => !this.headers!.includes(key) && row[key] != null
            );
            if (unexpected) {
                throw new Error(
                    `XLSX row introduced column '${unexpected}' after the header was written`
                );
            }
        }
        this.rowCount += 1;
        await this.writeXml(
            renderRow(
                this.headers.map((header) => row[header]),
                this.rowCount + 1,
                false
            )
        );
    }

    async close(meta: Record<string, unknown> = {}): Promise<CsvMeta> {
        if (this.closed) throw new Error('XLSX artifact writer is closed');
        this.closed = true;
        const outputPath = path.join(UPLOADS_DIR, this.filename);
        const outputTempPath = `${outputPath}.tmp`;
        try {
            await this.writeXml('</sheetData></worksheet>');
            this.stream.end();
            await once(this.stream, 'finish');

            const zip = workbookArchive(this.safeName, this.rowCount);
            zip.addLocalFile(this.sheetPath, 'xl/worksheets', 'sheet1.xml');
            await zip.writeZipPromise(outputTempPath, {overwrite: true});
            await fs.rename(outputTempPath, outputPath);
            const stat = await fs.stat(outputPath);
            return {
                id: this.safeName,
                file: `uploads/reports/${this.filename}`,
                name: this.safeName,
                generated: new Date().toISOString(),
                size: stat.size,
                ...meta
            };
        } catch (error) {
            await fs.unlink(outputTempPath).catch(() => undefined);
            await fs.unlink(outputPath).catch(() => undefined);
            throw error;
        } finally {
            await fs.rm(this.tempDir, {recursive: true, force: true});
        }
    }

    destroy(_error: Error): void {
        if (this.closed) return;
        this.closed = true;
        // The caller already propagates the original failure. Destroy without
        // re-emitting it on an otherwise unobserved file stream.
        this.stream.destroy();
        void fs.rm(this.tempDir, {recursive: true, force: true});
    }

    private async writeXml(xml: string): Promise<void> {
        const bytes = Buffer.byteLength(xml);
        if (this.sheetBytes + bytes > XLSX_MAX_SHEET_XML_BYTES) {
            throw new Error(
                `XLSX report exceeds the safe ${XLSX_MAX_SHEET_XML_BYTES}-byte worksheet limit; use CSV for larger exports.`
            );
        }
        this.sheetBytes += bytes;
        if (!this.stream.write(xml)) await once(this.stream, 'drain');
    }
}

function renderRow(
    values: readonly unknown[],
    rowNumber: number,
    header: boolean
): string {
    const cells = values
        .map((value, index) =>
            renderCell(value, columnName(index + 1), rowNumber, header)
        )
        .join('');
    return `<row r="${rowNumber}">${cells}</row>`;
}

function renderCell(
    value: unknown,
    column: string,
    rowNumber: number,
    header: boolean
): string {
    const reference = `${column}${rowNumber}`;
    const style = header ? ' s="1"' : '';
    if (value === null || value === undefined)
        return `<c r="${reference}"${style}/>`;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(
                `XLSX cell ${reference} is not a finite number`
            );
        }
        return `<c r="${reference}"${style}><v>${value}</v></c>`;
    }
    if (typeof value === 'boolean') {
        return `<c r="${reference}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
    }
    const raw = value instanceof Date ? value.toISOString() : String(value);
    if (raw.length > XLSX_MAX_CELL_CHARS) {
        throw new Error(
            `XLSX cell ${reference} exceeds Excel's ${XLSX_MAX_CELL_CHARS}-character limit`
        );
    }
    return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(raw)}</t></is></c>`;
}

function columnName(index: number): string {
    let current = index;
    let result = '';
    while (current > 0) {
        const remainder = (current - 1) % 26;
        result = String.fromCharCode(65 + remainder) + result;
        current = Math.floor((current - 1) / 26);
    }
    return result;
}

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function workbookArchive(title: string, rowCount: number): AdmZip {
    const zip = new AdmZip();
    const add = (name: string, xml: string) =>
        zip.addFile(name, Buffer.from(xml, 'utf8'));
    add(
        '[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
            '</Types>'
    );
    add(
        '_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
            '</Relationships>'
    );
    add(
        'xl/workbook.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            '<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'
    );
    add(
        'xl/_rels/workbook.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
            '</Relationships>'
    );
    add(
        'xl/styles.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
            '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
            '</styleSheet>'
    );
    const created = new Date().toISOString();
    add(
        'docProps/core.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
            `<dc:title>${escapeXml(title)}</dc:title><dc:creator>Fleet Manager</dc:creator>` +
            `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
            '</cp:coreProperties>'
    );
    add(
        'docProps/app.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
            `<Application>Fleet Manager</Application><AppVersion>1.0</AppVersion><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Report (${rowCount} rows)</vt:lpstr></vt:vector></TitlesOfParts>` +
            '</Properties>'
    );
    return zip;
}
