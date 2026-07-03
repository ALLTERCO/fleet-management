// Per-phase interval engine — the kind=interval + per_phase=true branch of
// Report.Generate (the summed-phase branch is intervalEngine).
//
// Per-phase 15-minute energy dump: one row per device per bucket carrying the
// consumed (act) and returned (ret) energy for EACH phase a/b/c, read straight
// from device_em.energy_15min WITHOUT summing the phases. The standard
// consumption/returned_energy reports collapse phases into one device total;
// this one preserves them so callers can apply their own clamp-orientation
// correction (e.g. abs per phase for reversed CT clamps).
//
// Output columns:
//   bucket, device, a_act_kwh, a_ret_kwh, b_act_kwh, b_ret_kwh, c_act_kwh, c_ret_kwh
//
// Reuses the timeseries fast path: bucket-aligned windows, each a bounded COPY
// streamed straight through gzip (no per-row JS).

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {tuning} from '../../config';
import {GRANULARITY_MAP} from '../../config/energy';
import {type CsvMeta, UPLOADS_DIR} from '../../modules/csvExport';
import * as PostgresProvider from '../../modules/PostgresProvider';
import RpcError from '../../rpc/RpcError';
import type CommandSender from '../CommandSender';
import {streamFormattedReportToGzip} from '../energy/streamingExportRunner';
import {
    bindReportArtifactOwner,
    reportCsvArtifactFormat,
    resolveScopeForGenerate
} from './engineHelpers';
import {writeReportGeneratedAudit} from './reportAudit';
import type {ReportJobContext} from './reportJobContext';
import {
    assertReportSafety,
    bucketSizeMs,
    estimateReportRows
} from './reportSafety';

const PHASES = ['a', 'b', 'c'] as const;
const HEADER_COLS = [
    'bucket',
    'device',
    'a_act_kwh',
    'a_ret_kwh',
    'b_act_kwh',
    'b_ret_kwh',
    'c_act_kwh',
    'c_ret_kwh'
] as const;

// Build the formatted COPY SELECT for one window. All inlined values are
// numeric device ids, a granularity token from GRANULARITY_MAP, and ISO
// timestamps — no caller-supplied strings reach the SQL.
function buildWindowSql(
    ids: number[],
    interval: string,
    from: Date,
    to: Date
): string {
    const idList = ids.map((n) => Math.trunc(Number(n))).join(',');
    const cols = PHASES.flatMap((p) => [
        `round((sum(e.sum_val) FILTER (WHERE e.tag = 'total_act_energy'` +
            ` AND e.phase = '${p}')) :: numeric / 1000, 4) AS ${p}_act_kwh`,
        `round((sum(e.sum_val) FILTER (WHERE e.tag = 'total_act_ret_energy'` +
            ` AND e.phase = '${p}')) :: numeric / 1000, 4) AS ${p}_ret_kwh`
    ]).join(', ');
    return (
        `SELECT to_char(e.tb AT TIME ZONE 'UTC', 'Dy Mon DD YYYY HH24:MI:SS')` +
        ` || ' GMT+0000 (Coordinated Universal Time)' AS bucket, ` +
        `COALESCE(max(dl.jdoc->>'name'), max(dl.external_id),` +
        ` e.device::text) AS device, ${cols} ` +
        `FROM (SELECT time_bucket('${interval}', bucket) AS tb, device,` +
        ` tag, phase, sum_val FROM device_em.energy_15min ` +
        `WHERE device = ANY(ARRAY[${idList}]::integer[]) ` +
        `AND tag IN ('total_act_energy', 'total_act_ret_energy') ` +
        `AND phase IN ('a', 'b', 'c') ` +
        `AND bucket >= '${from.toISOString()}'::timestamptz ` +
        `AND bucket < '${to.toISOString()}'::timestamptz) e ` +
        `LEFT JOIN device.list dl ON dl.id = e.device ` +
        `GROUP BY e.tb, e.device ORDER BY e.tb, e.device`
    );
}

export async function generatePerPhaseIntervalReport(
    rawParams: unknown,
    sender: CommandSender,
    context?: ReportJobContext
): Promise<CsvMeta & {rows?: number}> {
    const params = (rawParams ?? {}) as {
        from?: unknown;
        to?: unknown;
        granularity?: unknown;
    };
    const {from, to, granularity} = params;
    if (typeof from !== 'string' || typeof to !== 'string') {
        throw RpcError.InvalidParams('from and to are required ISO timestamps');
    }
    if (typeof granularity !== 'string' || !GRANULARITY_MAP[granularity]) {
        throw RpcError.InvalidParams(
            `Invalid granularity "${String(granularity)}". Valid options: ` +
                Object.keys(GRANULARITY_MAP).join(', ')
        );
    }
    const interval = GRANULARITY_MAP[granularity];
    const generateStart = Date.now();

    const {shellyIDs, scope} = await resolveScopeForGenerate(
        params as never,
        sender
    );
    const {internalIds} = await PostgresProvider.resolveDeviceIds(shellyIDs);
    if (!internalIds.length) throw RpcError.NotFound('device_ids');

    const safety = {
        deviceCount: internalIds.length,
        from: new Date(from),
        to: new Date(to),
        granularity,
        seriesCount: 1
    };
    assertReportSafety(safety);
    if (context) context.estimatedRows = estimateReportRows(safety);
    await context?.update({
        currentPhase: 'streaming',
        estimatedRows: context?.estimatedRows,
        percent: 0
    });
    await context?.throwIfCancelled();

    // Bucket-aligned windows so each COPY is a bounded statement. Size by
    // UNDERLYING rows read, not output rows: this report reads 6 series per
    // device per bucket (phases a/b/c × act/ret tags), so divide the target by
    // device_count × 6. Sizing by output rows alone made windows ~6× too large
    // and a full-year all-device COPY blew the per-statement timeout.
    const SERIES_PER_DEVICE = PHASES.length * 2; // a/b/c × {act, ret}
    const windowMs =
        bucketSizeMs(granularity) *
        Math.max(
            1,
            Math.floor(
                tuning.report.chunkTargetRows /
                    Math.max(1, internalIds.length * SERIES_PER_DEVICE)
            )
        );
    const windows: Array<{from: Date; to: Date}> = [];
    const rangeToMs = new Date(to).getTime();
    for (
        let winFromMs = new Date(from).getTime();
        winFromMs < rangeToMs;
        winFromMs += windowMs
    ) {
        windows.push({
            from: new Date(winFromMs),
            to: new Date(Math.min(winFromMs + windowMs, rangeToMs))
        });
    }
    const windowSqls = windows.map((w) =>
        buildWindowSql(internalIds, interval, w.from, w.to)
    );

    const ts = Date.now();
    const format = reportCsvArtifactFormat();
    const safeName = await bindReportArtifactOwner({
        name: `interval_per_phase_${granularity}_${ts}`,
        sender,
        extension: format
    });
    const filename = `${safeName}.${format}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    let rowCount = 0;
    let meta: CsvMeta & {rows?: number};
    try {
        const res = await streamFormattedReportToGzip({
            filePath,
            headerCols: HEADER_COLS,
            windowSqls,
            onProgress: async (rows, bytes) => {
                rowCount = rows;
                await context?.update({
                    currentPhase: 'writing',
                    estimatedRows: context?.estimatedRows,
                    rowsWritten: rows,
                    bytesWritten: bytes,
                    percent: context?.estimatedRows
                        ? Math.min(
                              99,
                              Math.floor((rows / context.estimatedRows) * 100)
                          )
                        : 0
                });
                await context?.throwIfCancelled();
            }
        });
        rowCount = res.rowsWritten;
        meta = {
            id: safeName,
            file: `uploads/reports/${filename}`,
            name: safeName,
            generated: new Date().toISOString(),
            size: res.bytesWritten,
            devices: shellyIDs,
            originalDeviceCount: scope.originalDeviceCount,
            droppedDeviceCount: scope.droppedDeviceCount,
            droppedShellyIDs: scope.droppedShellyIDs,
            report_type: 'interval_per_phase',
            granularity,
            per_device: true,
            from,
            to
        } as CsvMeta & {rows?: number};
    } catch (error) {
        await fs.unlink(filePath).catch(() => {});
        throw error;
    }

    meta.rows = rowCount;
    await writeReportGeneratedAudit(sender, {
        reportType: 'interval_per_phase',
        rows: rowCount,
        meta,
        generateStart
    });
    await context?.update({
        currentPhase: 'ready',
        rowsWritten: rowCount,
        bytesWritten: meta.size,
        percent: 100
    });
    return meta;
}
