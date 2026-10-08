/**
 * Redis-backed status record for background report jobs.
 *
 * Report.Generate returns a jobId immediately and runs the report in the
 * background; Report.GetReport reads the record here to report progress and
 * hand back the download URL once ready. Records live in the generic `kv` store
 * (Redis in prod, in-memory in OSS) with a 24h TTL to match the file's
 * owner-bind lifetime.
 */

import {getLogger} from 'log4js';
import {kv} from '../../modules/redis/services';
import type {
    ReportCoverageInterval,
    ReportMeasuredUsageCost
} from '../../types/api/report';
import {
    reportArtifactExpiresAt,
    reportArtifactTtlSec
} from '../report/reportRetention';

const logger = getLogger('exportJobStore');

export type ExportJobStatus = 'pending' | 'ready' | 'failed' | 'cancelled';

export interface ExportArtifacts {
    dataCsvGz?: string;
    summaryHtml?: string;
    workbookXlsx?: string;
    documentPdf?: string;
}

export interface ExportManifest extends ExportArtifacts {
    expiresAt: string;
    bytes: number;
    report?: Record<string, unknown>;
}

export interface ExportProgress {
    estimatedRows?: number;
    rowsWritten?: number;
    bytesWritten?: number;
    currentPhase?: string;
    percent?: number;
    /** When this job last did something. Lets a caller tell a slow poll from
     *  work that has stopped moving, which a percentage alone cannot. */
    lastActivityAt?: string;
}

export interface ExportJob {
    jobId: string;
    userId: string;
    organizationId: string | null;
    status: ExportJobStatus;
    downloadUrl?: string;
    htmlUrl?: string;
    artifacts?: ExportArtifacts;
    coverage?: ReportCoverageInterval;
    measuredUsageCost?: ReportMeasuredUsageCost;
    manifest?: ExportManifest;
    progress?: ExportProgress;
    bytes?: number;
    expiresAt?: string;
    error?: string;
}

export interface ExportJobOwner {
    jobId: string;
    userId: string;
    organizationId: string | null;
}

export interface ExportJobSuccess extends ExportJobOwner {
    downloadUrl: string;
    bytes: number;
    htmlUrl?: string;
    artifacts?: ExportArtifacts;
    coverage?: ReportCoverageInterval;
    measuredUsageCost?: ReportMeasuredUsageCost;
    manifest?: ExportManifest;
}

export interface ExportJobFailure extends ExportJobOwner {
    error: string;
}

// Spans any running report; a node that died mid-claim frees it by expiry.
const JOB_KEY_TTL_SEC = 3600;

// Three lost races in a row is already past real contention.
const CLAIM_ATTEMPTS = 3;

// A progress write that keeps losing to concurrent writers is stale anyway.
const PROGRESS_WRITE_ATTEMPTS = 3;

function jobKey(jobId: string): string {
    return `export:job:${jobId}`;
}

function requestKey(fingerprint: string): string {
    return `export:job:key:${fingerprint}`;
}

// Set-once cancel marker on a separate key: the job record is overwritten on
// every transition, so a terminal write could clobber a concurrent cancel.
function cancelMarkerKey(jobId: string): string {
    return `export:job:${jobId}:cancelled`;
}

async function isCancelMarked(jobId: string): Promise<boolean> {
    return (await kv.get(cancelMarkerKey(jobId))) !== null;
}

async function save(job: ExportJob): Promise<void> {
    await kv.set(
        jobKey(job.jobId),
        JSON.stringify(job),
        reportArtifactTtlSec()
    );
}

/**
 * Bind a request fingerprint to a job id, so the same report asked for twice
 * runs once. Returns the id that owns the fingerprint: `jobId` when this caller
 * claimed it, the in-flight job's id when one is already running. A job that
 * reached a terminal status no longer holds its fingerprint, so the next
 * identical request starts a fresh run.
 *
 * Every write is atomic. Taking the key from a finished job is a
 * compare-and-set against the id that finished, so two callers arriving after
 * the same completed run cannot both mint a job. The caller must have created
 * `jobId`'s record first: a held key whose record is gone counts as free, and
 * a returned foreign id is always one whose record was read and is live.
 */
export async function claimExportJobKey(
    fingerprint: string,
    jobId: string
): Promise<string> {
    const key = requestKey(fingerprint);
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
        if (await kv.setIfAbsent(key, jobId, JOB_KEY_TTL_SEC)) return jobId;
        const held = await kv.get(key);
        // Expired between the two calls — go round and claim the free key.
        if (held === null) continue;
        if (held === jobId) return jobId;
        const previous = await getExportJob(held);
        if (previous && !isTerminalStatus(previous.status)) return held;
        if (await kv.compareAndSet(key, held, jobId, JOB_KEY_TTL_SEC)) {
            return jobId;
        }
    }
    // Never hand back an id whose record this call did not verify.
    return jobId;
}

/** Give the fingerprint up, but only while this job still holds it. */
export async function releaseExportJobKey(
    fingerprint: string,
    jobId: string
): Promise<void> {
    await kv.compareAndDelete(requestKey(fingerprint), jobId);
}

/** Drop a job record that will never run (a collapsed duplicate, or a request
 *  refused after its record was created). */
export async function deleteExportJob(jobId: string): Promise<void> {
    await kv.delete(jobKey(jobId));
}

export async function createExportJob(owner: ExportJobOwner): Promise<void> {
    await save({
        ...owner,
        status: 'pending',
        expiresAt: reportArtifactExpiresAt(),
        progress: stampedProgress({currentPhase: 'queued'})
    });
}

// Returns false when cancelled so the caller suppresses the irreversible
// "ready" event. The cancel marker is re-checked after the write to catch a
// Report.Cancel that raced the save (rolling a brief "ready" back to cancelled).
export async function markExportReady(
    result: ExportJobSuccess
): Promise<boolean> {
    const previous = await getExportJob(result.jobId);
    if (
        previous?.status === 'cancelled' ||
        (await isCancelMarked(result.jobId))
    ) {
        return false;
    }
    await save({
        ...previous,
        ...result,
        status: 'ready',
        manifest:
            result.manifest ??
            buildManifest({
                artifacts: result.artifacts,
                bytes: result.bytes,
                expiresAt: previous?.expiresAt
            }),
        progress: stampedProgress(
            {
                ...previous?.progress,
                rowsWritten: previous?.progress?.rowsWritten,
                bytesWritten: result.bytes,
                currentPhase: 'ready',
                percent: 100
            },
            previous?.progress
        )
    });
    if (await isCancelMarked(result.jobId)) {
        await writeCancelled(
            result.jobId,
            result.userId,
            result.organizationId
        );
        return false;
    }
    return true;
}

// Returns false when the job was already cancelled (the caller then suppresses
// the "failed" event in favour of the cancellation it is handling separately).
export async function markExportFailed(
    failure: ExportJobFailure
): Promise<boolean> {
    const previous = await getExportJob(failure.jobId);
    if (
        previous?.status === 'cancelled' ||
        (await isCancelMarked(failure.jobId))
    ) {
        return false;
    }
    await save({
        ...previous,
        ...failure,
        status: 'failed',
        progress: stampedProgress(
            {...previous?.progress, currentPhase: 'failed'},
            previous?.progress
        )
    });
    return true;
}

export async function getExportJob(jobId: string): Promise<ExportJob | null> {
    const raw = await kv.get(jobKey(jobId));
    return raw ? (JSON.parse(raw) as ExportJob) : null;
}

/**
 * Record progress, but never at the cost of an outcome.
 *
 * The read and the write are separate round trips, so a job can finish in
 * between; a plain write would then put the finished record back to pending and
 * lose its download URL. The write is therefore conditional on the record being
 * byte-for-byte what was read. Losing that race is not an error: re-read, and
 * if the job has since finished, the progress is simply stale and dropped.
 */
export async function updateExportProgress(
    owner: ExportJobOwner,
    progress: ExportProgress
): Promise<void> {
    for (let attempt = 0; attempt < PROGRESS_WRITE_ATTEMPTS; attempt++) {
        const key = jobKey(owner.jobId);
        const raw = await kv.get(key);
        if (!raw) return;
        const previous = JSON.parse(raw) as ExportJob;
        if (!sameExportOwner(previous, owner)) return;
        if (isTerminalStatus(previous.status)) {
            logger.debug(
                'dropping progress for %s: already %s',
                owner.jobId,
                previous.status
            );
            return;
        }
        const next: ExportJob = {
            ...previous,
            progress: stampedProgress(
                {...previous.progress, ...progress},
                previous.progress
            )
        };
        const written = await kv.compareAndSet(
            key,
            raw,
            JSON.stringify(next),
            reportArtifactTtlSec()
        );
        if (written) return;
    }
    logger.debug(
        'dropping progress for %s: record kept changing under the write',
        owner.jobId
    );
}

export async function cancelExportJob(
    owner: ExportJobOwner
): Promise<ExportJob | null> {
    const previous = await getExportJob(owner.jobId);
    if (!previous || !sameExportOwner(previous, owner)) return null;
    if (previous.status === 'ready' || previous.status === 'failed') {
        return previous;
    }
    // Marker first: a concurrent markExportReady that already passed its initial
    // read still sees this on its post-write re-check and rolls back to cancelled.
    await kv.set(cancelMarkerKey(owner.jobId), '1', reportArtifactTtlSec());
    const cancelled = {
        ...previous,
        status: 'cancelled' as const,
        progress: stampedProgress(
            {...previous.progress, currentPhase: 'cancelled'},
            previous.progress
        )
    };
    await save(cancelled);
    return cancelled;
}

async function writeCancelled(
    jobId: string,
    userId: string,
    organizationId: string | null
): Promise<void> {
    const previous = await getExportJob(jobId);
    await save({
        jobId,
        userId,
        organizationId,
        ...previous,
        status: 'cancelled',
        progress: stampedProgress(
            {...previous?.progress, currentPhase: 'cancelled'},
            previous?.progress
        )
    });
}

function sameExportOwner(job: ExportJob, owner: ExportJobOwner): boolean {
    return (
        job.userId === owner.userId &&
        job.organizationId === owner.organizationId
    );
}

export async function isExportCancelled(jobId: string): Promise<boolean> {
    return (
        (await isCancelMarked(jobId)) ||
        (await getExportJob(jobId))?.status === 'cancelled'
    );
}

function isTerminalStatus(status: ExportJobStatus): boolean {
    return status === 'ready' || status === 'failed' || status === 'cancelled';
}

// A job never moves backwards, so a stage cannot undo a finer row update.
function normalizeProgress(
    progress: ExportProgress,
    previousPercent?: number
): ExportProgress {
    if (typeof progress.percent !== 'number') return progress;
    const bounded = Math.max(0, Math.min(100, progress.percent));
    const percent =
        typeof previousPercent === 'number'
            ? Math.max(bounded, previousPercent)
            : bounded;
    return {...progress, percent};
}

/**
 * The single stamp for progress. Every write that touches the progress record
 * goes through here, so a heartbeat that restates the same position still
 * proves the job is alive, and the timestamp can never go backwards even if
 * the clock does.
 */
function stampedProgress(
    progress: ExportProgress,
    previous?: ExportProgress
): ExportProgress {
    const stamped = normalizeProgress(progress, previous?.percent);
    const now = new Date().toISOString();
    const last = previous?.lastActivityAt;
    return {
        ...stamped,
        lastActivityAt: last !== undefined && last > now ? last : now
    };
}

function buildManifest(input: {
    artifacts?: ExportArtifacts;
    bytes: number;
    expiresAt?: string;
}): ExportManifest {
    return {
        ...input.artifacts,
        bytes: input.bytes,
        expiresAt: input.expiresAt ?? reportArtifactExpiresAt()
    };
}
