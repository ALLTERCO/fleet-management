// The single report-generation entrypoint. report.Generate and
// reporttemplate.Run both start jobs through here, so there is exactly one
// dispatch path for the two report kinds (energy / interval).

import {randomUUID} from 'node:crypto';
import {getLogger} from 'log4js';
import {enqueueReportExport} from '../../modules/delivery/OutboxWorker';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    REPORT_GENERATE_UNIFIED_PARAMS_SCHEMA,
    type ReportGenerateUnifiedParams
} from '../../types/api/report';
import type CommandSender from '../CommandSender';
import {createExportJob} from '../energy/exportJobStore';
import type {EngineReportExportPayload} from '../energy/reportExportPayload';
import {runReportExportJob} from '../energy/reportExportTask';
import {eventOrgId} from './engineHelpers';
import {snapshotReportSender} from './reportJobSender';

const logger = getLogger('reportJobService');

export interface ReportJobHandle {
    jobId: string;
    status: 'pending';
}

// A report job in flight: its identity plus the validated request to run.
async function enqueueEngineExport(
    payload: EngineReportExportPayload
): Promise<void> {
    try {
        await enqueueReportExport(payload);
    } catch (err) {
        logger.warn(
            'report export enqueue failed, running in-process: %s',
            err instanceof Error ? err.message : String(err)
        );
        void runReportExportJob(payload);
    }
}

// Start a report job from a unified report request. Returns a jobId
// immediately; the result lands in the job record (read via report.GetReport).
export async function startReportJob(
    rawParams: unknown,
    sender: CommandSender
): Promise<ReportJobHandle> {
    const params = validateOrThrow<ReportGenerateUnifiedParams>(
        rawParams,
        REPORT_GENERATE_UNIFIED_PARAMS_SCHEMA
    );
    const userId = sender.getUserId();
    if (!userId) throw RpcError.Unauthorized();
    const jobId = randomUUID();
    await createExportJob({jobId, userId});
    await enqueueEngineExport({
        kind: params.kind,
        jobId,
        userId,
        orgId: eventOrgId(sender),
        rawParams,
        sender: snapshotReportSender(sender)
    });
    return {jobId, status: 'pending'};
}
