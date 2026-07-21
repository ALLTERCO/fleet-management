/**
 * Single executor for a report export job, shared by the durable
 * graphile-worker task and the in-process fallback. Streams the export,
 * records the outcome in the job store, and pushes the terminal Report.Ready
 * event. Self-contained (no CommandSender) so it can run in a worker that
 * survives a restart. Explicit device selectors are stored as permanent
 * device.list ids and projected to current external ids at execution time.
 */

import {emitReportReady} from '../../modules/EventDistributor';
import {generateEnergyReport} from '../report/energyEngine';
import {generateEnvironmentReport} from '../report/environmentEngine';
import {generateIntervalReport} from '../report/intervalEngine';
import {generatePerPhaseIntervalReport} from '../report/intervalPerPhaseEngine';
import {projectCurrentReportSelectors} from '../report/reportDeviceSelectors';
import {
    createReportJobContext,
    isReportCancelledError
} from '../report/reportJobContext';
import {restoreReportSender} from '../report/reportJobSender';
import {downloadUrlFor} from './exportHandler';
import {
    cancelExportJob,
    isExportCancelled,
    markExportFailed,
    markExportReady
} from './exportJobStore';
import type {ReportExportPayload} from './reportExportPayload';

export async function runReportExportJob(
    p: ReportExportPayload
): Promise<void> {
    try {
        if (await isExportCancelled(p.jobId)) return;
        const context = createReportJobContext({
            jobId: p.jobId,
            userId: p.userId,
            kind: p.kind,
            orgId: p.orgId
        });
        await context.update({
            currentPhase: 'running',
            estimatedRows: context.estimatedRows,
            percent: 0
        });
        const rawParams = await executionParams(p);
        const {downloadUrl, bytes, htmlUrl, artifacts} =
            await runReportExportPayload(p, rawParams, context);
        await context.throwIfCancelled();
        const published = await markExportReady({
            jobId: p.jobId,
            userId: p.userId,
            downloadUrl,
            bytes,
            htmlUrl,
            artifacts
        });
        // A cancel that raced in keeps the job cancelled — never emit ready.
        if (!published) return;
        emitReportReady(p.orgId, {
            jobId: p.jobId,
            status: 'ready',
            downloadUrl,
            htmlUrl: htmlUrl ?? null,
            artifacts: artifacts ?? null,
            bytes
        });
    } catch (err) {
        if (isReportCancelledError(err)) {
            await cancelExportJob({jobId: p.jobId, userId: p.userId});
            emitReportReady(p.orgId, {
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
            error
        });
        if (!recorded) return;
        emitReportReady(p.orgId, {jobId: p.jobId, status: 'failed', error});
    }
}

async function runReportExportPayload(
    p: ReportExportPayload,
    rawParams: unknown,
    context: ReturnType<typeof createReportJobContext>
) {
    const sender = restoreReportSender(p.sender);
    let meta:
        | Awaited<ReturnType<typeof generateEnergyReport>>
        | Awaited<ReturnType<typeof generateEnvironmentReport>>
        | Awaited<ReturnType<typeof generateIntervalReport>>
        | Awaited<ReturnType<typeof generatePerPhaseIntervalReport>>;
    // energy_dump is the legacy per-phase 15-minute dump (kept for t6 and other
    // tenants whose integrations still call it); route it to the same per-phase
    // engine as interval + per_phase=true.
    const perPhase =
        p.kind === 'energy_dump' ||
        (rawParams as {per_phase?: boolean} | null)?.per_phase === true;
    if (p.kind === 'energy') {
        meta = await generateEnergyReport(rawParams, sender, context);
    } else if (p.kind === 'environment') {
        meta = await generateEnvironmentReport(rawParams, sender, context);
    } else if (perPhase) {
        // interval + per_phase: keep phases as separate columns (fast path).
        meta = await generatePerPhaseIntervalReport(rawParams, sender, context);
    } else {
        meta = await generateIntervalReport(rawParams, sender, context);
    }
    const downloadUrl = downloadUrlFor(meta.file);
    const htmlUrl =
        typeof meta.html_file === 'string'
            ? downloadUrlFor(meta.html_file)
            : undefined;
    return {
        downloadUrl,
        htmlUrl,
        bytes: meta.size ?? 0,
        artifacts: {
            dataCsvGz: downloadUrl,
            ...(htmlUrl ? {summaryHtml: htmlUrl} : {})
        }
    };
}

async function executionParams(p: ReportExportPayload): Promise<unknown> {
    if (p.logicalParams !== undefined) {
        return projectCurrentReportSelectors(p.logicalParams);
    }
    if (Object.hasOwn(p, 'rawParams')) return p.rawParams;
    throw new Error('Report export payload has no parameters');
}
