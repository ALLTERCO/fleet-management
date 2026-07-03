// Interval report engine — kind=interval branch of Report.Generate. Streams a
// per-device CSV with one column per selected metric/tag (the load profile)
// at the chosen granularity. 2M-row cap enforced via assertReportSafety.
// Streaming generator — one (bucket, device) row open at a time, no full
// materialization. Cost and bill totals live in the energy report, not here.

import {tuning} from '../../config';
import {type CsvMeta, createCsvArtifactWriter} from '../../modules/csvExport';
import * as PostgresProvider from '../../modules/PostgresProvider';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    REPORT_GENERATE_PARAMS_SCHEMA,
    type ReportGenerateParams
} from '../../types/api/report';
import type CommandSender from '../CommandSender';
import {buildRawExportSql} from '../energy/streamingExport';
import {streamSelectCsvRows} from '../energy/streamingExportRunner';
import {reportTimezoneFor} from './energyEngineHelpers';
import {
    bindReportArtifactOwner,
    reportCsvArtifactFormat,
    resolveScopeForGenerate,
    validateReportRequest,
    warmReportNameCache
} from './engineHelpers';
import {writeReportGeneratedAudit} from './reportAudit';
import type {ReportJobContext} from './reportJobContext';
import {resolveReportPeriod} from './reportPeriod';
import {assertReportSafety, estimateReportRows} from './reportSafety';

// Per-tag shaping: output column name, raw divisor, decimal precision.
interface TagFormat {
    col: string;
    divisor: number;
    precision: number;
}

// Union the tags of every selected metric, keeping first-seen order and
// each tag's shaping. A tag shared by two metrics maps once.
function tagFormats(
    reportDefs: {
        tags: string[];
        columns: Record<string, string>;
        divisor: number;
        precision: number;
    }[]
): Map<string, TagFormat> {
    const formats = new Map<string, TagFormat>();
    for (const def of reportDefs) {
        for (const tag of def.tags) {
            if (formats.has(tag)) continue;
            formats.set(tag, {
                col: def.columns[tag] || tag,
                divisor: def.divisor,
                precision: def.precision
            });
        }
    }
    return formats;
}

export async function generateIntervalReport(
    rawParams: unknown,
    sender: CommandSender,
    context?: ReportJobContext
) {
    const params = validateOrThrow<ReportGenerateParams>(
        rawParams,
        REPORT_GENERATE_PARAMS_SCHEMA
    );
    const generateStart = Date.now();
    const {metrics, granularity, per_device} = params;
    const {reportDefs, bucket} = validateReportRequest(
        metrics,
        granularity,
        params
    );
    const {from, to} = await resolveIntervalRange(params, sender);
    const {shellyIDs, scope} = await resolveScopeForGenerate(params, sender);
    const {internalIds, idMap} =
        await PostgresProvider.resolveDeviceIds(shellyIDs);
    if (!internalIds.length) throw RpcError.NotFound('device_ids');

    const formats = tagFormats(reportDefs);
    const tags = [...formats.keys()];
    const allCols = [...formats.values()].map((f) => f.col);
    const safety = {
        deviceCount: internalIds.length,
        from: new Date(from),
        to: new Date(to),
        granularity,
        seriesCount: tags.length
    };
    assertReportSafety(safety);
    if (context) context.estimatedRows = estimateReportRows(safety);
    await context?.update({
        currentPhase: 'streaming',
        estimatedRows: context?.estimatedRows,
        percent: 0
    });
    await context?.throwIfCancelled();

    const nameCache = await warmReportNameCache(idMap, per_device);
    const resolveDeviceCell = (deviceInternalId: number | string): string => {
        if (per_device === false) return 'All Devices';
        const iid = Number(deviceInternalId);
        return nameCache.get(iid) || idMap[iid] || String(deviceInternalId);
    };

    let rowCount = 0;
    let currentKey: string | null = null;
    let currentRow: Record<string, unknown> | null = null;

    const ts = Date.now();
    const perDeviceLabel = per_device !== false ? 'per_device' : 'group';
    const metricLabel = metrics.length === 1 ? metrics[0] : 'interval';
    const format = reportCsvArtifactFormat();
    const safeName = await bindReportArtifactOwner({
        name: `${metricLabel}_${granularity}_${perDeviceLabel}_${ts}`,
        sender,
        extension: format
    });
    const writer = createCsvArtifactWriter({name: safeName, format});
    const writeReportRow = async (row: Record<string, unknown>) => {
        await writer.write(row);
        rowCount++;
        if (rowCount % tuning.report.streamChunkRows === 0) {
            await context?.update({
                currentPhase: 'writing',
                estimatedRows: context?.estimatedRows,
                rowsWritten: rowCount,
                bytesWritten: writer.bytesWritten(),
                percent: progressPercent(rowCount, context?.estimatedRows)
            });
            await context?.throwIfCancelled();
        }
    };

    // Every row carries the full column set so the CSV header is complete.
    const finalizeRow = async (row: Record<string, unknown>) => {
        for (const col of allCols) if (row[col] === undefined) row[col] = '';
        row.device = resolveDeviceCell(row.device as number | string);
        await writeReportRow(row);
    };

    let meta: CsvMeta & {rows?: number};
    try {
        await streamSelectCsvRows(
            buildRawExportSql({
                internalIds,
                from: new Date(from),
                to: new Date(to),
                tags,
                perDevice: per_device !== false,
                bucket
            }),
            async (r) => {
                const fmt = formats.get(r.tag);
                if (!fmt) return;
                const value = +(Number(r.agg_value) / fmt.divisor).toFixed(
                    fmt.precision
                );
                const bucketDate = new Date(r.bucket);
                const key = `${bucketDate.toISOString()}::${r.device}`;
                if (key !== currentKey) {
                    if (currentRow) await finalizeRow(currentRow);
                    currentRow = {bucket: bucketDate, device: String(r.device)};
                    currentKey = key;
                }
                currentRow![fmt.col] = value;
            }
        );
        if (currentRow) await finalizeRow(currentRow);

        meta = (await writer.close({
            devices: shellyIDs,
            originalDeviceCount: scope.originalDeviceCount,
            droppedDeviceCount: scope.droppedDeviceCount,
            droppedShellyIDs: scope.droppedShellyIDs,
            metrics,
            granularity,
            per_device: per_device !== false,
            from,
            to
        })) as CsvMeta & {rows?: number};
    } catch (error) {
        writer.destroy(error as Error);
        throw error;
    }
    meta.rows = rowCount;
    await writeReportGeneratedAudit(sender, {
        reportType: metricLabel,
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

function progressPercent(
    rowsWritten: number,
    estimatedRows: number | undefined
): number | undefined {
    if (!estimatedRows || estimatedRows <= 0) return undefined;
    return Math.min(99, Math.floor((rowsWritten / estimatedRows) * 100));
}

// Resolve the report window to ISO from/to. A named `period` is resolved in the
// org timezone (one profile read); explicit from/to passes through unchanged.
async function resolveIntervalRange(
    params: ReportGenerateParams,
    sender: CommandSender
): Promise<{from: string; to: string}> {
    if (!params.period) return {from: params.from, to: params.to};
    const orgId = requireOrganizationId(sender, {
        organizationId: (params as {organizationId?: string}).organizationId
    });
    const timezone = await reportTimezoneFor(orgId, undefined);
    const range = resolveReportPeriod(params.period, new Date(), timezone, {
        billingDay: params.billing_day
    });
    return {from: range.from.toISOString(), to: range.to.toISOString()};
}
