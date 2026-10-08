/**
 * Single executor for a report export job, shared by the durable
 * graphile-worker task and the in-process fallback. Streams the export,
 * records the outcome in the job store, and pushes the terminal Report.Ready
 * event. Self-contained (no CommandSender) so it can run in a worker that
 * survives a restart. Explicit device selectors are stored as permanent
 * device.list ids and projected to current external ids at execution time.
 */

import {emitReportReady} from '../../modules/EventDistributor';
import type {
    ReportCoverageInterval,
    ReportMeasuredUsageCost
} from '../../types/api/report';
import type CommandSender from '../CommandSender';
import {generateEnergyReport} from '../report/energyEngine';
import {generateEnvironmentReport} from '../report/environmentEngine';
import {generateIntervalReport} from '../report/intervalEngine';
import {generatePerPhaseIntervalReport} from '../report/intervalPerPhaseEngine';
import {projectCurrentReportSelectors} from '../report/reportDeviceSelectors';
import {
    createReportJobContext,
    enterReportPhase,
    isReportCancelledError,
    type ReportJobContext
} from '../report/reportJobContext';
import {restoreReportSender} from '../report/reportJobSender';
import {reportArtifactExpiresAt} from '../report/reportRetention';
import {downloadUrlFor} from './exportHandler';
import {
    cancelExportJob,
    isExportCancelled,
    markExportFailed,
    markExportReady
} from './exportJobStore';
import type {ReportExportPayload} from './reportExportPayload';

export type ReportEngineMeta =
    | Awaited<ReturnType<typeof generateEnergyReport>>
    | Awaited<ReturnType<typeof generateEnvironmentReport>>
    | Awaited<ReturnType<typeof generateIntervalReport>>
    | Awaited<ReturnType<typeof generatePerPhaseIntervalReport>>;

/** Engine dispatch, injectable so the job lifecycle can be exercised without
 *  a database behind it. */
export type ReportEngineRunner = (
    kind: ReportExportPayload['kind'],
    rawParams: unknown,
    sender: CommandSender,
    context: ReportJobContext
) => Promise<ReportEngineMeta>;

export async function runReportExportJob(
    p: ReportExportPayload,
    runEngine: ReportEngineRunner = productionReportEngine
): Promise<void> {
    try {
        if (await isExportCancelled(p.jobId)) return;
        const context = createReportJobContext({
            jobId: p.jobId,
            userId: p.userId,
            kind: p.kind,
            orgId: p.orgId
        });
        await enterReportPhase(context, 'checking_data', {
            estimatedRows: context.estimatedRows
        });
        const rawParams = await executionParams(p);
        const {
            downloadUrl,
            bytes,
            htmlUrl,
            artifacts,
            coverage,
            measuredUsageCost,
            manifest
        } = await runReportExportPayload(p, rawParams, context, runEngine);
        await context.throwIfCancelled();
        const published = await markExportReady({
            jobId: p.jobId,
            userId: p.userId,
            organizationId: p.orgId,
            downloadUrl,
            bytes,
            htmlUrl,
            artifacts,
            coverage,
            measuredUsageCost,
            manifest
        });
        // A cancel that raced in keeps the job cancelled — never emit ready.
        if (!published) return;
        emitReportReady(p.orgId, p.userId, {
            jobId: p.jobId,
            status: 'ready',
            downloadUrl,
            htmlUrl: htmlUrl ?? null,
            artifacts: artifacts ?? null,
            bytes
        });
    } catch (err) {
        if (isReportCancelledError(err)) {
            await cancelExportJob({
                jobId: p.jobId,
                userId: p.userId,
                organizationId: p.orgId
            });
            emitReportReady(p.orgId, p.userId, {
                jobId: p.jobId,
                status: 'cancelled',
                error: 'cancelled'
            });
            return;
        }
        const error = err instanceof Error ? err.message : String(err);
        const recorded = await markExportFailed({
            jobId: p.jobId,
            userId: p.userId,
            organizationId: p.orgId,
            error
        });
        if (!recorded) return;
        emitReportReady(p.orgId, p.userId, {
            jobId: p.jobId,
            status: 'failed',
            error
        });
    }
}

const productionReportEngine: ReportEngineRunner = async (
    kind,
    rawParams,
    sender,
    context
) => {
    // energy_dump is the legacy per-phase 15-minute dump (kept for t6 and other
    // tenants whose integrations still call it); route it to the same per-phase
    // engine as interval + per_phase=true.
    const perPhase =
        kind === 'energy_dump' ||
        (rawParams as {per_phase?: boolean} | null)?.per_phase === true;
    if (kind === 'energy') {
        return generateEnergyReport(rawParams, sender, context);
    }
    if (kind === 'environment') {
        return generateEnvironmentReport(rawParams, sender, context);
    }
    if (perPhase) {
        // interval + per_phase: keep phases as separate columns (fast path).
        return generatePerPhaseIntervalReport(rawParams, sender, context);
    }
    return generateIntervalReport(rawParams, sender, context);
};

async function runReportExportPayload(
    p: ReportExportPayload,
    rawParams: unknown,
    context: ReportJobContext,
    runEngine: ReportEngineRunner
) {
    const sender = restoreReportSender(p.sender);
    const meta = await runEngine(p.kind, rawParams, sender, context);
    const downloadUrl = downloadUrlFor(meta.file);
    const htmlUrl =
        typeof meta.html_file === 'string'
            ? downloadUrlFor(meta.html_file)
            : undefined;
    const csvUrl =
        typeof meta.csv_file === 'string'
            ? downloadUrlFor(meta.csv_file)
            : /\.csv(?:\.gz)?$/.test(meta.file)
              ? downloadUrl
              : undefined;
    const xlsxUrl =
        typeof meta.xlsx_file === 'string'
            ? downloadUrlFor(meta.xlsx_file)
            : /\.xlsx$/.test(meta.file)
              ? downloadUrl
              : undefined;
    const pdfUrl =
        typeof meta.pdf_file === 'string'
            ? downloadUrlFor(meta.pdf_file)
            : /\.pdf$/.test(meta.file)
              ? downloadUrl
              : undefined;
    const artifacts = {
        ...(csvUrl ? {dataCsvGz: csvUrl} : {}),
        ...(htmlUrl ? {summaryHtml: htmlUrl} : {}),
        ...(xlsxUrl ? {workbookXlsx: xlsxUrl} : {}),
        ...(pdfUrl ? {documentPdf: pdfUrl} : {})
    };
    const coverage = reportCoverage(meta.coverage);
    const measuredCost = reportMeasuredUsageCost(meta.measured_usage_cost);
    return {
        downloadUrl,
        htmlUrl,
        bytes: meta.size ?? 0,
        artifacts,
        coverage,
        measuredUsageCost: measuredCost,
        manifest: {
            ...artifacts,
            bytes: meta.size ?? 0,
            expiresAt: reportArtifactExpiresAt(),
            report: {
                schema_version: meta.schema_version,
                calculation_version: meta.calculation_version,
                tariff_snapshot: meta.tariff_snapshot,
                emission_factors_g_per_kwh: meta.emission_factors_g_per_kwh,
                from: meta.from,
                to: meta.to,
                granularity: meta.granularity,
                total_consumption_kwh: meta.total_consumption_kwh,
                total_returned_kwh: meta.total_returned_kwh,
                total_cost: meta.total_cost,
                measured_usage_cost: measuredCost,
                coverage
            }
        }
    };
}

function reportMeasuredUsageCost(
    value: unknown
): ReportMeasuredUsageCost | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const cost = value as Partial<ReportMeasuredUsageCost>;
    if (
        typeof cost.amount !== 'number' ||
        typeof cost.roundedAmount !== 'number' ||
        typeof cost.currency !== 'string' ||
        typeof cost.fractionDigits !== 'number' ||
        !Number.isInteger(cost.fractionDigits) ||
        typeof cost.roundsToZeroAtMinorUnit !== 'boolean'
    ) {
        return undefined;
    }
    return cost as ReportMeasuredUsageCost;
}

function reportCoverage(value: unknown): ReportCoverageInterval | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const coverage = value as Partial<ReportCoverageInterval>;
    if (
        (coverage.status !== 'complete' && coverage.status !== 'partial') ||
        typeof coverage.requestedFrom !== 'string' ||
        typeof coverage.requestedTo !== 'string' ||
        typeof coverage.coveredFrom !== 'string' ||
        typeof coverage.coveredTo !== 'string' ||
        typeof coverage.fraction !== 'number'
    ) {
        return undefined;
    }
    return coverage as ReportCoverageInterval;
}

async function executionParams(p: ReportExportPayload): Promise<unknown> {
    if (p.logicalParams !== undefined) {
        return projectCurrentReportSelectors(p.logicalParams);
    }
    if (Object.hasOwn(p, 'rawParams')) return p.rawParams;
    throw new Error('Report export payload has no parameters');
}
