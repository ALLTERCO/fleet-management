import {randomUUID} from 'node:crypto';
import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import * as Observability from '../Observability';
import type {BulkAcceptJobRecord} from '../redis/ports';
import {bulkAcceptJobStore} from '../redis/services';
import {
    type AcceptExternalIdsInput,
    acceptExternalIds
} from './acceptExternalIds';

const logger = log4js.getLogger('waiting-room');

export type BulkAcceptInput = AcceptExternalIdsInput;

function ttlSec(): number {
    return tuning.waitingRoom.bulkJobTtlSec;
}

function newRecord(input: BulkAcceptInput): BulkAcceptJobRecord {
    const now = Date.now();
    return {
        jobId: randomUUID(),
        organizationId: input.organizationId,
        total: input.externalIds.length,
        processed: 0,
        accepted: 0,
        failed: [],
        state: 'running',
        startedAt: now,
        updatedAt: now
    };
}

// Drive the shared accept path; persist progress and poll the cancel flag
// after each batch. Chunking itself lives in claimAndApproveByExternalIds.
async function runJob(
    input: BulkAcceptInput,
    record: BulkAcceptJobRecord
): Promise<BulkAcceptJobRecord> {
    let canceled = false;
    const startedMs = performance.now();
    logger.debug(
        'bulk accept start job=%s org=%s total=%d',
        record.jobId,
        record.organizationId,
        record.total
    );
    await acceptExternalIds(input, async ({accepted, failed}) => {
        const updatedAt = Date.now();
        const processed = accepted + failed.length;
        record.processed += processed;
        record.accepted += accepted;
        record.failed.push(...failed);
        record.updatedAt = updatedAt;
        const persistStart = performance.now();
        await bulkAcceptJobStore.recordProgress(
            {
                organizationId: record.organizationId,
                jobId: record.jobId
            },
            {processed, accepted, failed, updatedAt},
            ttlSec()
        );
        const persistMs = performance.now() - persistStart;
        const cancelStart = performance.now();
        canceled = await bulkAcceptJobStore.isCancelRequested(
            record.organizationId,
            record.jobId
        );
        const cancelMs = performance.now() - cancelStart;
        Observability.recordRpcTiming(
            'waitingroom.bulk_accept.progress_persist',
            persistMs
        );
        Observability.recordRpcTiming(
            'waitingroom.bulk_accept.cancel_check',
            cancelMs
        );
        logger.debug(
            'bulk accept progress job=%s processed=%d/%d accepted=%d failed=%d deltaProcessed=%d deltaAccepted=%d deltaFailed=%d persistMs=%d cancelCheckMs=%d canceled=%s',
            record.jobId,
            record.processed,
            record.total,
            record.accepted,
            record.failed.length,
            processed,
            accepted,
            failed.length,
            Math.round(persistMs),
            Math.round(cancelMs),
            canceled
        );
        return !canceled;
    });
    const finished = await finish(record, canceled ? 'canceled' : 'done');
    logger.debug(
        'bulk accept finish job=%s state=%s processed=%d/%d accepted=%d failed=%d totalMs=%d',
        record.jobId,
        finished.state,
        finished.processed,
        finished.total,
        finished.accepted,
        finished.failed.length,
        Math.round(performance.now() - startedMs)
    );
    Observability.recordRpcTiming(
        'waitingroom.bulk_accept.total',
        performance.now() - startedMs
    );
    return finished;
}

async function finish(
    record: BulkAcceptJobRecord,
    state: BulkAcceptJobRecord['state']
): Promise<BulkAcceptJobRecord> {
    record.state = state;
    record.updatedAt = Date.now();
    await bulkAcceptJobStore.set(record, ttlSec());
    return record;
}

export interface BulkAcceptStarted {
    jobId: string;
    total: number;
    // Resolves when the background run ends; the RPC ignores it, callers may await.
    completed: Promise<BulkAcceptJobRecord>;
}

// Returns immediately; the loop runs in the background.
export async function startBulkAccept(
    input: BulkAcceptInput
): Promise<BulkAcceptStarted> {
    const record = newRecord(input);
    await bulkAcceptJobStore.set(record, ttlSec());
    const completed = runJob(input, record).catch(async (err) => {
        logger.error('Bulk accept job %s crashed: %s', record.jobId, err);
        try {
            return await finish(record, 'error');
        } catch (finishErr) {
            logger.error(
                'Bulk accept job %s finish failed: %s',
                record.jobId,
                finishErr
            );
            return record;
        }
    });
    return {jobId: record.jobId, total: record.total, completed};
}

// A still-running record left idle past the stale window means the owner died.
export async function getBulkAccept(
    organizationId: string,
    jobId: string
): Promise<BulkAcceptJobRecord | null> {
    const record = await bulkAcceptJobStore.get(organizationId, jobId);
    if (!record || record.state !== 'running') return record;
    const staleMs = tuning.waitingRoom.bulkJobStaleSec * 1000;
    if (Date.now() - record.updatedAt > staleMs) {
        return {...record, state: 'error'};
    }
    return record;
}

// Only a still-running job can be canceled.
export async function cancelBulkAccept(
    organizationId: string,
    jobId: string
): Promise<{canceled: boolean}> {
    const record = await bulkAcceptJobStore.get(organizationId, jobId);
    if (!record || record.state !== 'running') return {canceled: false};
    await bulkAcceptJobStore.markCancel(organizationId, jobId, ttlSec());
    return {canceled: true};
}
