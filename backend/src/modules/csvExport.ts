import {once} from 'node:events';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Writable} from 'node:stream';
import {pipeline} from 'node:stream';
import {createGzip} from 'node:zlib';
import {format as csvFormat} from 'fast-csv';

export const UPLOADS_DIR = path.join(__dirname, '../../uploads/reports');

if (!fsSync.existsSync(UPLOADS_DIR)) {
    fsSync.mkdirSync(UPLOADS_DIR, {recursive: true});
}

export interface CsvMeta {
    id: string;
    file: string;
    name: string;
    generated: string;
    size: number;
    [extra: string]: unknown;
}

export type CsvArtifactFormat = 'csv' | 'csv.gz';

export interface CsvArtifactRequest {
    rows: Iterable<Record<string, unknown>>;
    name: string;
    meta?: Record<string, unknown>;
    format?: CsvArtifactFormat;
}

export interface CsvArtifactWriter {
    readonly safeName: string;
    readonly filename: string;
    bytesWritten(): number;
    write(row: Record<string, unknown>): Promise<void>;
    close(meta?: Record<string, unknown>): Promise<CsvMeta>;
    destroy(error: Error): void;
}

// Keep report metadata honest with the published schema.
export function assertReportMetaShape(meta: Record<string, unknown>): void {
    assertStringArrayIfPresent(meta, 'devices');
    assertStringArrayIfPresent(meta, 'droppedShellyIDs');
}

function assertStringArrayIfPresent(
    meta: Record<string, unknown>,
    key: string
): void {
    const value = meta[key];
    if (value === undefined) return;
    if (!Array.isArray(value)) {
        throw new TypeError(
            `Report meta ${key} must be string[]; received non-array`
        );
    }
    for (const item of value) {
        if (typeof item !== 'string') {
            throw new TypeError(
                `Report meta ${key} must be string[]; received ${typeof item}`
            );
        }
    }
}

export function sanitizeFileName(
    input: string,
    opts: {maxLength?: number} = {}
): string {
    const maxLength = opts.maxLength ?? 120;

    let s = String(input || '')
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '');

    s = s.replace(/[<>:"/\\|?*]/g, '-');

    {
        let out = '';
        for (const ch of s) {
            const code = ch.charCodeAt(0);
            out += code < 32 || code === 127 ? '-' : ch;
        }
        s = out;
    }

    s = s.trim().replace(/\s+/g, '-');

    s = s.replace(/^\.+/, '');
    s = s.replace(/[ .]+$/g, '');

    s = s.replace(/[-_]{2,}/g, '-');

    const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
    if (reserved.test(s)) s = `_${s}`;

    if (s.length > maxLength) {
        s = s.slice(0, maxLength).replace(/[ .]+$/g, '');
    }

    if (!s) s = 'report';

    return s;
}

// CWE-1236 mitigation: prefix risky string cells with apostrophe so
// Excel/LibreOffice show the value instead of evaluating it. Numbers,
// booleans, null/undefined are untouched. Applied per-cell at the
// stream boundary so every writer path is covered.
export function escapeCsvFormula(value: string): string {
    if (value.length === 0) return value;
    const first = value.charCodeAt(0);
    // '=' 61, '+' 43, '-' 45, '@' 64, TAB 9, CR 13
    if (
        first === 61 ||
        first === 43 ||
        first === 45 ||
        first === 64 ||
        first === 9 ||
        first === 13
    ) {
        return `'${value}`;
    }
    return value;
}

function escapeRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
        out[k] = typeof v === 'string' ? escapeCsvFormula(v) : v;
    }
    return out;
}

// HTML artifacts share naming and ownership with CSV artifacts.
export async function writeHtmlAndReturnMeta(
    html: string,
    name: string,
    extraMeta: Record<string, unknown> = {}
): Promise<CsvMeta> {
    assertReportMetaShape(extraMeta);
    const safeName = sanitizeFileName(name);
    const filePath = path.join(UPLOADS_DIR, `${safeName}.html`);
    await fs.writeFile(filePath, html, 'utf8');
    return {
        id: safeName,
        file: `uploads/reports/${safeName}.html`,
        name: safeName,
        generated: new Date().toISOString(),
        size: (await fs.stat(filePath)).size,
        ...extraMeta
    };
}

export async function writeCsvAndReturnMeta(
    rows: Iterable<Record<string, unknown>>,
    name: string,
    extraMeta: Record<string, unknown> = {}
): Promise<CsvMeta> {
    return writeCsvArtifactAndReturnMeta({
        rows,
        name,
        meta: extraMeta,
        format: 'csv'
    });
}

export async function writeCsvArtifactAndReturnMeta(
    request: CsvArtifactRequest
): Promise<CsvMeta> {
    const meta = request.meta ?? {};
    const format = request.format ?? 'csv';
    assertReportMetaShape(meta);
    const safeName = sanitizeFileName(request.name);
    const filename = reportCsvFilename(safeName, format);
    const filePath = path.join(UPLOADS_DIR, filename);

    await writeCsvRows({rows: request.rows, format, filePath});

    return buildCsvMeta({safeName, filename, filePath, meta});
}

export function createCsvArtifactWriter(input: {
    name: string;
    format?: CsvArtifactFormat;
}): CsvArtifactWriter {
    const format = input.format ?? 'csv';
    const safeName = sanitizeFileName(input.name);
    const filename = reportCsvFilename(safeName, format);
    const filePath = path.join(UPLOADS_DIR, filename);
    const csvStream = csvFormat({headers: true});
    const output = fsSync.createWriteStream(filePath);
    const pipelineDone =
        format === 'csv.gz'
            ? gzipPipelinePromise({csvStream, output})
            : plainPipelinePromise({csvStream, output});
    return {
        safeName,
        filename,
        bytesWritten: () => output.bytesWritten,
        write: (row) => writeCsvRow({csvStream, row, pipelineDone}),
        close: (meta = {}) =>
            closeCsvArtifactWriter({
                csvStream,
                output,
                pipelineDone,
                safeName,
                filename,
                filePath,
                meta
            }),
        destroy: (error) => {
            csvStream.destroy(error);
            output.destroy(error);
        }
    };
}

function reportCsvFilename(
    safeName: string,
    format: CsvArtifactFormat
): string {
    return `${safeName}.${format}`;
}

interface CsvRowsWriteRequest {
    rows: Iterable<Record<string, unknown>>;
    format: CsvArtifactFormat;
    filePath: string;
}

async function writeCsvRows(request: CsvRowsWriteRequest): Promise<void> {
    const csvStream = csvFormat({headers: true});
    const output = fsSync.createWriteStream(request.filePath);
    const pipelineDone =
        request.format === 'csv.gz'
            ? gzipPipelinePromise({csvStream, output})
            : plainPipelinePromise({csvStream, output});
    try {
        await writeRowsWithBackpressure(csvStream, request.rows, pipelineDone);
        csvStream.end();
        await pipelineDone;
    } catch (error) {
        csvStream.destroy(error as Error);
        output.destroy(error as Error);
        throw error;
    }
}

function plainPipelinePromise(input: {
    csvStream: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
}): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        pipeline(input.csvStream, input.output, (error) =>
            error ? reject(error) : resolve()
        );
    });
}

function gzipPipelinePromise(input: {
    csvStream: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
}): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        pipeline(input.csvStream, createGzip(), input.output, (error) =>
            error ? reject(error) : resolve()
        );
    });
}

async function writeRowsWithBackpressure(
    csvStream: Writable,
    rows: Iterable<Record<string, unknown>>,
    pipelineDone: Promise<void>
): Promise<void> {
    for (const row of rows) {
        await writeCsvRow({csvStream, row, pipelineDone});
    }
}

async function writeCsvRow(input: {
    csvStream: Writable;
    row: Record<string, unknown>;
    pipelineDone: Promise<void>;
}): Promise<void> {
    if (input.csvStream.write(escapeRow(input.row))) return;
    await Promise.race([once(input.csvStream, 'drain'), input.pipelineDone]);
}

async function closeCsvArtifactWriter(input: {
    csvStream: Writable;
    output: Writable;
    pipelineDone: Promise<void>;
    safeName: string;
    filename: string;
    filePath: string;
    meta: Record<string, unknown>;
}): Promise<CsvMeta> {
    assertReportMetaShape(input.meta);
    try {
        input.csvStream.end();
        await input.pipelineDone;
        return buildCsvMeta(input);
    } catch (error) {
        input.csvStream.destroy(error as Error);
        input.output.destroy(error as Error);
        throw error;
    }
}

interface CsvMetaRequest {
    safeName: string;
    filename: string;
    filePath: string;
    meta: Record<string, unknown>;
}

async function buildCsvMeta(request: CsvMetaRequest): Promise<CsvMeta> {
    return {
        id: request.safeName,
        file: `uploads/reports/${request.filename}`,
        name: request.safeName,
        generated: new Date().toISOString(),
        size: (await fs.stat(request.filePath)).size,
        ...request.meta
    };
}
