/**
 * Pure core of the energy streaming export.
 *
 * The report CSV path materialises the whole result set in Node memory
 * (capped at 2M rows). The streaming export builds a COPY SELECT here and
 * pipes the rows through gzip into a file one at a time, so a year of
 * fine-grained data for thousands of devices exports without buffering it.
 *
 * COPY cannot bind query parameters, so every value inlined into the SELECT
 * is validated first. The `safe*` guards below ARE the injection boundary.
 *
 * Kept free of heavy imports (no PostgresProvider) so unit tests can exercise
 * it without pulling in config/db init — the pg-dependent runner lives in
 * streamingExportRunner.ts.
 */

import {createWriteStream} from 'node:fs';
import {type Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {bucketUsesRollup, VALID_BUCKETS} from '../../config/energy';

function safeInt(n: number): number {
    if (!Number.isInteger(n)) throw new Error(`unsafe device id: ${n}`);
    return n;
}

function safeTag(tag: string): string {
    if (!/^[a-z0-9_]+$/.test(tag)) throw new Error(`unsafe tag: ${tag}`);
    return tag;
}

function safeBucket(bucket: string): string {
    if (!VALID_BUCKETS.has(bucket)) throw new Error(`unsafe bucket: ${bucket}`);
    return bucket;
}

// Injection boundary for inlined commodity/source literals — same shape as
// safeTag. Values are lowercase letters + underscore (electricity, ac_mains, …).
function safeFilter(value: string): string {
    if (!/^[a-z_]+$/.test(value)) throw new Error(`unsafe filter: ${value}`);
    return value;
}

// Inlined optional filter arg: NULL (all) when omitted, else the validated
// literal. No hidden default — a water/heat export returns its rows.
function filterArg(value: string | undefined): string {
    return value === undefined ? 'NULL' : `'${safeFilter(value)}'`;
}

export interface ExportQueryParams {
    internalIds: readonly number[];
    from: Date;
    to: Date;
    tags: readonly string[];
    perDevice: boolean;
    bucket: string;
    /** Commodity filter (electricity/water/heat). Omitted → all. */
    commodity?: string;
    /** Electrical-source filter (ac_mains/…). Omitted → all. */
    electricalSource?: string;
}

/**
 * Build the raw-export SELECT for COPY. p_limit = NULL returns every row —
 * the streaming sink, not a row cap, bounds memory here.
 */
export function buildRawExportSql(p: ExportQueryParams): string {
    const ids = p.internalIds.map(safeInt).join(',');
    const tags = p.tags
        .map(safeTag)
        .map((t) => `'${t}'`)
        .join(',');
    const bucket = safeBucket(p.bucket);
    // 15 min+ reads the long-term rollup; finer reads raw (1-month window).
    // Both functions share the same signature (trailing p_commodity,
    // p_electrical_source).
    const fn = bucketUsesRollup(bucket)
        ? 'fn_report_stats_rollup_paged'
        : 'fn_report_stats_paged';
    // Order by domain so the interval pivot (keyed by domain) sees contiguous
    // rows; AC+DC on one device would otherwise fragment.
    return (
        `SELECT bucket, device, tag, agg_value, domain FROM device_em.${fn}(` +
        `ARRAY[${ids}]::integer[],` +
        `'${p.from.toISOString()}'::timestamptz,` +
        `'${p.to.toISOString()}'::timestamptz,` +
        `ARRAY[${tags}]::varchar(30)[],` +
        `'${bucket}',` +
        `${p.perDevice ? 'true' : 'false'},` +
        `NULL,0,${filterArg(p.commodity)},${filterArg(p.electricalSource)}) ` +
        `ORDER BY bucket, device, domain, tag`
    );
}

/**
 * Wrap a validated SELECT as a COPY TO STDOUT statement.
 */
export function toCopyStatement(selectSql: string): string {
    return `COPY (${selectSql}) TO STDOUT WITH (FORMAT csv, HEADER true)`;
}

/**
 * Wrap a validated SELECT as a COPY without a header line (the formatted
 * fast-path writes one header for the whole file, then appends each window's
 * rows headerless).
 */
export function toCopyStatementNoHeader(selectSql: string): string {
    return `COPY (${selectSql}) TO STDOUT WITH (FORMAT csv)`;
}

// SQL-side CSV formula-injection guard (CWE-1236) for the COPY fast path, which
// inlines user cells (device names) the JS escapeCsvFormula never sees. Prefixes
// a value starting with a formula trigger (= + - @ TAB CR) with a quote.
export function csvFormulaEscapeSql(expr: string): string {
    return (
        `CASE WHEN left((${expr}), 1) ` +
        `IN ('=', '+', '-', '@', chr(9), chr(13)) ` +
        `THEN '''' || (${expr}) ELSE (${expr}) END`
    );
}

export interface FormattedExportMetric {
    tags: readonly string[];
    columns: Record<string, string>;
    divisor: number;
    precision: number;
}

/**
 * Build the FINAL formatted CSV SELECT for one window — the COPY fast path.
 *
 * Does in SQL everything the per-row JS engine used to do (unit divide, round,
 * the multi-tag pivot into one column per metric, the device label, and the
 * exact JS-style bucket label), so the COPY output is the finished CSV and can
 * be piped straight to gzip with no per-row Node work. Output column order and
 * formatting match the legacy per-row path byte-for-byte.
 *
 * All inlined values pass the same safe* guards as buildRawExportSql.
 */
export function buildFormattedExportSql(
    p: ExportQueryParams,
    metric: FormattedExportMetric
): {sql: string; headerCols: string[]} {
    const ids = p.internalIds.map(safeInt).join(',');
    const tags = p.tags.map(safeTag);
    const tagList = tags.map((t) => `'${t}'`).join(',');
    const bucket = safeBucket(p.bucket);
    const fn = bucketUsesRollup(bucket)
        ? 'fn_report_stats_rollup_paged'
        : 'fn_report_stats_paged';
    const divisor = Number(metric.divisor) || 1;
    const precision = Number.isInteger(metric.precision) ? metric.precision : 3;

    // One pivoted column per metric tag (single-tag reports → one column).
    const valueCols = tags.map((t) => {
        const col = (metric.columns[t] || t).replace(/"/g, '');
        return (
            `round((max(agg_value) FILTER (WHERE tag = '${t}'))::numeric` +
            ` / ${divisor}, ${precision}) AS "${col}"`
        );
    });
    const headerCols = [
        'bucket',
        'device',
        ...tags.map((t) => (metric.columns[t] || t).replace(/"/g, ''))
    ];

    // JS `new Date(bucket).toString()` in a UTC container, reproduced in SQL.
    const bucketLabel =
        `to_char(p.bucket AT TIME ZONE 'UTC', 'Dy Mon DD YYYY HH24:MI:SS')` +
        ` || ' GMT+0000 (Coordinated Universal Time)'`;
    // The per-device label is user-controlled, so escape it; 'All Devices' is a
    // fixed literal.
    const deviceLabel = p.perDevice
        ? csvFormulaEscapeSql(
              `COALESCE(max(dl.jdoc->>'name'), max(dl.external_id), p.device::text)`
          )
        : `'All Devices'`;
    const join = p.perDevice
        ? 'LEFT JOIN device.list dl ON dl.id = p.device'
        : '';

    const sql =
        `SELECT ${bucketLabel} AS bucket, ${deviceLabel} AS device, ` +
        `${valueCols.join(', ')} ` +
        `FROM device_em.${fn}(` +
        `ARRAY[${ids}]::integer[],` +
        `'${p.from.toISOString()}'::timestamptz,` +
        `'${p.to.toISOString()}'::timestamptz,` +
        `ARRAY[${tagList}]::varchar(30)[],` +
        `'${bucket}',${p.perDevice ? 'true' : 'false'},NULL,0,` +
        `${filterArg(p.commodity)},${filterArg(p.electricalSource)}) p ` +
        `${join} GROUP BY p.bucket, p.device ORDER BY p.bucket, p.device`;
    return {sql, headerCols};
}

/**
 * Grand total over the whole range for energy metrics (single value),
 * used to append the legacy "Totals" row. Returns a scalar SELECT.
 */
export function buildExportTotalSql(
    p: ExportQueryParams,
    metric: FormattedExportMetric
): string {
    const ids = p.internalIds.map(safeInt).join(',');
    const tag = safeTag(p.tags[0]);
    const bucket = safeBucket(p.bucket);
    const fn = bucketUsesRollup(bucket)
        ? 'fn_report_stats_rollup_paged'
        : 'fn_report_stats_paged';
    const divisor = Number(metric.divisor) || 1;
    const precision = Number.isInteger(metric.precision) ? metric.precision : 3;
    return (
        `SELECT round((COALESCE(sum(agg_value),0) / ${divisor})::numeric, ` +
        `${precision}) FROM device_em.${fn}(` +
        `ARRAY[${ids}]::integer[],` +
        `'${p.from.toISOString()}'::timestamptz,` +
        `'${p.to.toISOString()}'::timestamptz,` +
        `ARRAY['${tag}']::varchar(30)[],` +
        `'${bucket}',${p.perDevice ? 'true' : 'false'},NULL,0,` +
        `${filterArg(p.commodity)},${filterArg(p.electricalSource)})`
    );
}

export interface GzipFileProgress {
    bytesWritten: number;
}

export interface GzipFileOptions {
    signal?: AbortSignal;
    onProgress?: (progress: GzipFileProgress) => void;
}

/**
 * Stream a Readable through gzip into a file. Pure pipeline — unit-testable
 * with any Readable. Returns the gzipped byte count.
 */
export async function pipeToGzipFile(
    source: Readable,
    filePath: string,
    options: GzipFileOptions = {}
): Promise<number> {
    const sink = createWriteStream(filePath);
    const progress = new ByteProgressTransform(options.onProgress);
    await pipeline(source, createGzip(), progress, sink, {
        signal: options.signal
    });
    return sink.bytesWritten;
}

class ByteProgressTransform extends Transform {
    private bytesWritten = 0;
    private readonly onProgress?: (progress: GzipFileProgress) => void;

    constructor(onProgress?: (progress: GzipFileProgress) => void) {
        super();
        this.onProgress = onProgress;
    }

    override _transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null, data?: Buffer) => void
    ): void {
        this.bytesWritten += chunk.length;
        this.onProgress?.({bytesWritten: this.bytesWritten});
        callback(null, chunk);
    }
}
