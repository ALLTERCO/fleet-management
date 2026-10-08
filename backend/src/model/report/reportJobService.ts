// The single report-generation entrypoint. report.Generate and
// reporttemplate.Run both start jobs through here, so there is exactly one
// dispatch path for every report kind.

import {createHash, randomUUID} from 'node:crypto';
import {getLogger} from 'log4js';
import {enqueueReportExport} from '../../modules/delivery/OutboxWorker';
import {defaultEnergyRepository} from '../../modules/repositories/EnergyRepository';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    REPORT_GENERATE_ENERGY_PARAMS_SCHEMA,
    REPORT_GENERATE_UNIFIED_PARAMS_SCHEMA,
    type ReportGenerateEnergyParams,
    type ReportGenerateUnifiedParams
} from '../../types/api/report';
import type CommandSender from '../CommandSender';
import {
    claimExportJobKey,
    createExportJob,
    deleteExportJob,
    releaseExportJobKey
} from '../energy/exportJobStore';
import type {EngineReportExportPayload} from '../energy/reportExportPayload';
import {runReportExportJob} from '../energy/reportExportTask';
import {resolveEnergyReportTarget} from './energyReportData';
import {eventOrgId} from './engineHelpers';
import {assertRecordedReportData} from './reportCoveragePrecheck';
import {snapshotLogicalReportSelectors} from './reportDeviceSelectors';
import {snapshotReportSender} from './reportJobSender';

const logger = getLogger('reportJobService');

export interface ReportJobHandle {
    jobId: string;
    status: 'pending';
}

/** Seams the RPC surface does not own, so the job lifecycle stays testable
 *  without a database or a running worker behind it. */
export interface ReportJobServiceDeps {
    assertCoverage(
        params: ReportGenerateUnifiedParams,
        sender: CommandSender
    ): Promise<void>;
    snapshotSelectors(rawParams: unknown): Promise<unknown>;
    enqueue(payload: EngineReportExportPayload, jobKey: string): Promise<void>;
}

// A report job in flight: its identity plus the validated request to run.
async function enqueueEngineExport(
    payload: EngineReportExportPayload,
    jobKey: string
): Promise<void> {
    try {
        await enqueueReportExport(payload, jobKey);
    } catch (err) {
        logger.warn(
            'report export enqueue failed, running in-process: %s',
            err instanceof Error ? err.message : String(err)
        );
        void runReportExportJob(payload);
    }
}

/**
 * Refuse a request the fleet recorded nothing for, before a job exists. Only
 * the energy report resolves its window and devices cheaply enough to answer
 * this up front; the other kinds keep their in-engine checks.
 */
async function assertRequestCoverage(
    params: ReportGenerateUnifiedParams,
    sender: CommandSender
): Promise<void> {
    if (params.kind !== 'energy') return;
    const target = await resolveEnergyReportTarget({
        params: validateOrThrow<ReportGenerateEnergyParams>(
            params,
            REPORT_GENERATE_ENERGY_PARAMS_SCHEMA
        ),
        sender
    });
    await assertRecordedReportData({
        repo: await defaultEnergyRepository(),
        internalIds: target.internalIds,
        from: target.range.fromDate,
        to: target.range.toDate,
        metric: target.rawQuantityMetric
    });
}

export const PRODUCTION_REPORT_JOB_DEPS: ReportJobServiceDeps = {
    assertCoverage: assertRequestCoverage,
    snapshotSelectors: snapshotLogicalReportSelectors,
    enqueue: enqueueEngineExport
};

// Key order is not part of a request's identity, so sort before hashing.
function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(
                ([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`
            );
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

/** Same tenant, same caller, same report, same params — same running job. */
export function reportRequestFingerprint(input: {
    orgId: string | null;
    userId: string;
    params: ReportGenerateUnifiedParams;
}): string {
    return createHash('sha256')
        .update(
            canonicalJson({
                orgId: input.orgId,
                userId: input.userId,
                kind: input.params.kind,
                params: input.params
            })
        )
        .digest('hex');
}

// Start a report job from a unified report request. Returns a jobId
// immediately; the result lands in the job record (read via report.GetReport).
export async function startReportJob(
    rawParams: unknown,
    sender: CommandSender,
    deps: ReportJobServiceDeps = PRODUCTION_REPORT_JOB_DEPS
): Promise<ReportJobHandle> {
    const params = validateOrThrow<ReportGenerateUnifiedParams>(
        rawParams,
        REPORT_GENERATE_UNIFIED_PARAMS_SCHEMA
    );
    const userId = sender.getUserId();
    if (!userId) throw RpcError.Unauthorized();
    const orgId = eventOrgId(sender);
    const fingerprint = reportRequestFingerprint({orgId, userId, params});
    const jobId = randomUUID();
    // Record first: a duplicate caller gets this id and GetReport must find it.
    await createExportJob({jobId, userId, organizationId: orgId});
    const owner = await claimExportJobKey(fingerprint, jobId);
    if (owner !== jobId) {
        // Collapsed onto a live identical run: no coverage read, no second job.
        await deleteExportJob(jobId);
        return {jobId: owner, status: 'pending'};
    }
    try {
        await deps.assertCoverage(params, sender);
        const logicalParams = await deps.snapshotSelectors(params);
        await deps.enqueue(
            {
                kind: params.kind,
                jobId,
                userId,
                orgId,
                logicalParams,
                sender: snapshotReportSender(sender)
            },
            fingerprint
        );
    } catch (err) {
        // Nothing was queued, so leave neither a job nor a claim behind.
        await releaseExportJobKey(fingerprint, jobId);
        await deleteExportJob(jobId);
        throw err;
    }
    return {jobId, status: 'pending'};
}
