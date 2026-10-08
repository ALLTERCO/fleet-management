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
import {
    type StatsTagAggregation,
    statsTagAggregation,
    tagAggregationCaseSql
} from '../../modules/energyTagAggregation';
import {
    DEVICE_POWER_DOMAIN,
    DEVICE_POWER_TAG_PAIRS,
    devicePowerTags
} from './devicePower';

function safeInt(n: number): number {
    if (!Number.isInteger(n)) throw new Error(`unsafe device id: ${n}`);
    return n;
}

function safeTag(tag: string): string {
    if (!/^[a-z0-9_]+$/.test(tag)) throw new Error(`unsafe tag: ${tag}`);
    return tag;
}

function tagListSql(tags: Iterable<string>): string {
    return [...tags]
        .map(safeTag)
        .map((tag) => `'${tag}'`)
        .join(',');
}

function safeColumn(column: string): string {
    if (!/^[A-Za-z][A-Za-z0-9_ ()%./-]{0,127}$/.test(column)) {
        throw new Error(`unsafe export column: ${column}`);
    }
    return column;
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
    /** Physical internal id -> selected custom-device external id. */
    deviceAliases?: Readonly<Record<number, string>>;
}

function safeVirtualDeviceAlias(alias: string): string {
    if (!/^vdev_[A-Za-z0-9_-]+$/.test(alias)) {
        throw new Error(`unsafe custom-device alias: ${alias}`);
    }
    return alias;
}

/** SQL CASE used by COPY report paths to hide bound physical identities. */
export function virtualDeviceAliasSql(
    deviceExpression: string,
    aliases: Readonly<Record<number, string>> | undefined
): string {
    const entries = Object.entries(aliases ?? {});
    if (entries.length === 0) return 'NULL';
    const branches = entries.map(([rawId, rawAlias]) => {
        const id = safeInt(Number(rawId));
        const alias = safeVirtualDeviceAlias(rawAlias);
        return `WHEN ${id} THEN '${alias}'`;
    });
    return `CASE ${deviceExpression} ${branches.join(' ')} ELSE NULL END`;
}

/**
 * The device-power ladder as a joinable relation for one tag. Same routing rule
 * as Energy.Query, so the CSV and the API answer a 3-phase meter identically.
 * An aggregate export carries device 0, so its ladder is summed to one fleet
 * value per bucket — the same collapse the per-device rows would add up to.
 */
function devicePowerRelationSql(
    p: ExportQueryParams,
    tag: string,
    alias: string
): string {
    const ids = p.internalIds.map(safeInt).join(',');
    const functionName = bucketUsesRollup(p.bucket)
        ? 'device_em.fn_device_power_avg'
        : 'device_em.fn_device_power_avg_raw';
    const call =
        `${functionName}(ARRAY[${ids}]::integer[], ` +
        `'${p.from.toISOString()}'::timestamptz, ` +
        `'${p.to.toISOString()}'::timestamptz, ` +
        `'${safeBucket(p.bucket)}', '${safeTag(tag)}', ` +
        `'${safeTag(DEVICE_POWER_TAG_PAIRS[tag])}')`;
    if (p.perDevice) return `${call} ${alias}`;
    return (
        `(SELECT f.bucket, SUM(f.avg_w) AS avg_w FROM ${call} f ` +
        `GROUP BY f.bucket) ${alias}`
    );
}

/**
 * LEFT JOIN the ladder onto an already-bucketed relation. At most one ladder
 * row matches a source row's join key, so the join swaps values and can never
 * multiply rows.
 */
function devicePowerJoinSql(
    p: ExportQueryParams,
    tags: readonly string[],
    source: string
): string {
    return tags
        .map((tag, index) => {
            const device = p.perDevice
                ? ` AND pw${index}.device = ${source}.device`
                : '';
            return (
                `LEFT JOIN ${devicePowerRelationSql(p, tag, `pw${index}`)} ` +
                `ON pw${index}.bucket = ${source}.bucket${device}`
            );
        })
        .join(' ');
}

/**
 * Build the raw-export SELECT for COPY. p_limit = NULL returns every row —
 * the streaming sink, not a row cap, bounds memory here.
 */
export function buildRawExportSql(p: ExportQueryParams): string {
    const ids = p.internalIds.map(safeInt).join(',');
    const tags = tagListSql(p.tags);
    const bucket = safeBucket(p.bucket);
    const rollup = bucketUsesRollup(bucket);
    const from = `'${p.from.toISOString()}'::timestamptz`;
    const to = `'${p.to.toISOString()}'::timestamptz`;
    // Raw rows take the rollup's scope, source and one-row-per-second rule;
    // rollup rows add the records of EM buckets not rolled yet.
    const relation = rollup
        ? `device_em.fn_logical_energy_15min_rows(ARRAY[${ids}]::integer[], ` +
          `${from}, ${to}, ARRAY[${tags}]::varchar(30)[])`
        : `device_em.fn_stats_readings(ARRAY[${ids}]::integer[], ${from}, ` +
          `${to}, ARRAY[${tags}]::varchar(30)[], TRUE)`;
    const timestamp = rollup ? 's.bucket' : 's.ts';
    const value = rollup ? 's.sum_val' : 's.val';
    const sampleCount = rollup ? 's.sample_count' : '1';
    const minValue = rollup ? 's.min_val' : 's.val';
    const maxValue = rollup ? 's.max_val' : 's.val';
    const device = p.perDevice ? 's.device' : '0';
    const commodity = p.commodity
        ? ` AND s.commodity = '${safeFilter(p.commodity)}'`
        : '';
    const electricalSource = p.electricalSource
        ? ` AND s.electrical_source IS NOT DISTINCT FROM ` +
          `'${safeFilter(p.electricalSource)}'`
        : '';
    const base =
        `SELECT time_bucket('${bucket}', ${timestamp}) AS bucket, ` +
        `${device} AS device, s.tag, ` +
        `${tagAggregationCaseSql({
            tag: 's.tag',
            sum: `SUM(${value})`,
            min: `MIN(${minValue})`,
            max: `MAX(${maxValue})`,
            mean: `SUM(${value}) / NULLIF(SUM(${sampleCount}), 0)`
        })} AS agg_value, ` +
        `s.domain FROM ${relation} s ` +
        `WHERE ${timestamp} >= ${from} ` +
        `AND ${timestamp} < ${to} ` +
        `AND s.tag IN (${tags})${commodity}${electricalSource} ` +
        `GROUP BY 1, 2, s.tag, s.domain`;
    const ladderTags = devicePowerTags({
        tags: p.tags,
        bucket,
        commodity: p.commodity,
        electricalSource: p.electricalSource
    });
    if (ladderTags.length === 0) {
        return `${base} ORDER BY bucket, device, domain, tag`;
    }
    // Swap the per-phase mean for the device total on the AC-mains rows only;
    // DC power rows exist nowhere else, so they keep the generic value. The
    // COALESCE keeps a row the ladder cannot total readable instead of blank.
    const swap = ladderTags
        .map(
            (tag, index) =>
                `WHEN b.domain = '${DEVICE_POWER_DOMAIN}' ` +
                `AND b.tag = '${safeTag(tag)}' ` +
                `THEN COALESCE(pw${index}.avg_w, b.agg_value) `
        )
        .join('');
    return (
        `SELECT b.bucket AS bucket, b.device AS device, b.tag AS tag, ` +
        `CASE ${swap}ELSE b.agg_value END AS agg_value, ` +
        `b.domain AS domain FROM (${base}) b ` +
        `${devicePowerJoinSql(p, ladderTags, 'b')} ` +
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

export interface FormattedExportColumn {
    tag: string;
    column: string;
    divisor: number;
    precision: number;
}

const FORMATTED_AGGREGATES: Readonly<
    Record<StatsTagAggregation, (filter: string) => string>
> = {
    sum: (filter) => `sum(s.sum_val) ${filter}`,
    min: (filter) => `min(s.min_val) ${filter}`,
    max: (filter) => `max(s.max_val) ${filter}`,
    mean: (filter) =>
        `(sum(s.sum_val) ${filter}) / NULLIF(sum(s.sample_count) ${filter}, 0)`
};

function formattedAggregate(column: FormattedExportColumn): string {
    const tag = safeTag(column.tag);
    const divisor = Number(column.divisor);
    const precision = Number(column.precision);
    if (!Number.isFinite(divisor) || divisor <= 0) {
        throw new Error(`unsafe divisor: ${column.divisor}`);
    }
    if (!Number.isInteger(precision) || precision < 0 || precision > 12) {
        throw new Error(`unsafe precision: ${column.precision}`);
    }
    const filter = `FILTER (WHERE s.tag = '${tag}')`;
    const aggregate = FORMATTED_AGGREGATES[statsTagAggregation(tag)](filter);
    const output = safeColumn(column.column);
    return (
        `round(((${aggregate}) / ${divisor})::numeric, ${precision}) ` +
        `AS "${output}"`
    );
}

/**
 * Build one final CSV SELECT directly from the long-term rollup.
 *
 * The legacy formatted path first materialises fn_report_stats_rollup_paged
 * and then groups those rows again. This query applies each tag's aggregation
 * rule and pivots the requested columns in one grouping pass.
 */
export function buildDirectFormattedRollupSql(
    p: ExportQueryParams,
    columns: readonly FormattedExportColumn[]
): {sql: string; headerCols: string[]} {
    if (columns.length === 0) throw new Error('no export columns');
    const ids = p.internalIds.map(safeInt).join(',');
    const bucket = safeBucket(p.bucket);
    const tags = [...new Set(columns.map((column) => safeTag(column.tag)))];
    const tagList = tags.map((tag) => `'${tag}'`).join(',');
    const bucketExpr =
        bucket === '15 minutes'
            ? 's.bucket'
            : `time_bucket('${bucket}', s.bucket)`;
    const deviceExpr = p.perDevice ? 's.device' : '0';
    const valueColumns = columns.map(formattedAggregate);
    const commodityWhere =
        p.commodity === undefined
            ? ''
            : ` AND s.commodity = '${safeFilter(p.commodity)}'`;
    const sourceWhere =
        p.electricalSource === undefined
            ? ''
            : ` AND s.electrical_source IS NOT DISTINCT FROM ` +
              `'${safeFilter(p.electricalSource)}'`;

    const from = `'${p.from.toISOString()}'::timestamptz`;
    const to = `'${p.to.toISOString()}'::timestamptz`;
    const aggregated =
        `SELECT ${bucketExpr} AS bucket, ${deviceExpr} AS device, s.domain, ` +
        `${valueColumns.join(', ')} ` +
        `FROM device_em.fn_logical_energy_15min_rows(ARRAY[${ids}]::integer[], ` +
        `${from}, ${to}, ARRAY[${tagList}]::varchar(30)[]) s ` +
        `WHERE s.bucket >= ${from} AND s.bucket < ${to} ` +
        `AND s.tag IN (${tagList})${commodityWhere}${sourceWhere} ` +
        `GROUP BY 1, 2, s.domain`;
    const bucketLabel =
        `to_char(p.bucket AT TIME ZONE 'UTC', 'Dy Mon DD YYYY HH24:MI:SS')` +
        ` || ' GMT+0000 (Coordinated Universal Time)'`;
    const deviceLabel = p.perDevice
        ? csvFormulaEscapeSql(
              `COALESCE(${virtualDeviceAliasSql('p.device', p.deviceAliases)}, ` +
                  `dl.jdoc->>'name', dl.external_id, p.device::text)`
          )
        : `'All Devices'`;
    const join = p.perDevice
        ? 'LEFT JOIN device.list dl ON dl.id = p.device'
        : '';
    const headerCols = [
        'bucket',
        'device',
        'domain',
        ...columns.map((column) => safeColumn(column.column))
    ];
    const ladderTags = devicePowerTags({
        tags,
        bucket,
        commodity: p.commodity,
        electricalSource: p.electricalSource
    });
    // The pivot's sum(sum_val)/sum(sample_count) is a per-phase mean for power.
    // Take the device total from the ladder on the AC-mains rows instead.
    const valueCell = (column: FormattedExportColumn): string => {
        const output = safeColumn(column.column);
        const index = ladderTags.indexOf(column.tag);
        if (index < 0) return `p."${output}"`;
        return (
            `CASE WHEN p.domain = '${DEVICE_POWER_DOMAIN}' THEN ` +
            `COALESCE(round((pw${index}.avg_w / ` +
            `${Number(column.divisor)})::numeric, ` +
            `${Number(column.precision)}), p."${output}") ` +
            `ELSE p."${output}" END AS "${output}"`
        );
    };
    const ladderJoin =
        ladderTags.length > 0
            ? ` ${devicePowerJoinSql(p, ladderTags, 'p')}`
            : '';
    const sql =
        `SELECT ${bucketLabel} AS bucket, ${deviceLabel} AS device, ` +
        `p.domain, ` +
        `${columns.map(valueCell).join(', ')} ` +
        `FROM (${aggregated}) p ${join}${ladderJoin} ` +
        `ORDER BY p.bucket, p.device, p.domain`;
    return {sql, headerCols};
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
    const tags = p.tags.map(safeTag);
    safeBucket(p.bucket);
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
        `FROM (${buildRawExportSql(p)}) p ` +
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
    const tag = safeTag(p.tags[0]);
    safeBucket(p.bucket);
    const divisor = Number(metric.divisor) || 1;
    const precision = Number.isInteger(metric.precision) ? metric.precision : 3;
    return (
        `SELECT round((COALESCE(sum(agg_value),0) / ${divisor})::numeric, ` +
        `${precision}) FROM (${buildRawExportSql({...p, tags: [tag]})}) totals`
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
