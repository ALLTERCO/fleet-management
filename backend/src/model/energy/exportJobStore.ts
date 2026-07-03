/**
 * Redis-backed status record for background report jobs.
 *
 * Report.Generate returns a jobId immediately and runs the report in the
 * background; Report.GetReport reads the record here to report progress and
 * hand back the download URL once ready. Records live in the generic `kv` store
 * (Redis in prod, in-memory in OSS) with a 24h TTL to match the file's
 * owner-bind lifetime.
 */

import {kv} from '../../modules/redis/services';
import {
    reportArtifactExpiresAt,
    reportArtifactTtlSec
} from '../report/reportRetention';

export type ExportJobStatus = 'pending' | 'ready' | 'failed' | 'cancelled';

export interface ExportArtifacts {
    dataCsvGz?: string;
    summaryHtml?: string;
}

export interface ExportManifest extends ExportArtifacts {
    expiresAt: string;
    bytes: number;
}

export interface ExportProgress {
    estimatedRows?: number;
    rowsWritten?: number;
    bytesWritten?: number;
    currentPhase?: string;
    percent?: number;
}

export interface ExportJob {
    jobId: string;
    userId: string;
    status: ExportJobStatus;
    downloadUrl?: string;
    htmlUrl?: string;
    artifacts?: ExportArtifacts;
    manifest?: ExportManifest;
    progress?: ExportProgress;
    bytes?: number;
    expiresAt?: string;
    error?: string;
}

export interface ExportJobOwner {
    jobId: string;
    userId: string;
}

export interface ExportJobSuccess extends ExportJobOwner {
    downloadUrl: string;
    bytes: number;
    htmlUrl?: string;
    artifacts?: ExportArtifacts;
    manifest?: ExportManifest;
}

export interface ExportJobFailure extends ExportJobOwner {
    error: string;
}

function jobKey(jobId: string): string {
    return `export:job:${jobId}`;
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

export async function createExportJob(owner: ExportJobOwner): Promise<void> {
    await save({
        ...owner,
        status: 'pending',
        expiresAt: reportArtifactExpiresAt(),
        progress: {currentPhase: 'queued'}
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
        progress: {
            ...previous?.progress,
            rowsWritten: previous?.progress?.rowsWritten,
            bytesWritten: result.bytes,
            currentPhase: 'ready',
            percent: 100
        }
    });
    if (await isCancelMarked(result.jobId)) {
        await writeCancelled(result.jobId, result.userId);
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
        progress: {...previous?.progress, currentPhase: 'failed'}
    });
    return true;
}

export async function getExportJob(jobId: string): Promise<ExportJob | null> {
    const raw = await kv.get(jobKey(jobId));
    return raw ? (JSON.parse(raw) as ExportJob) : null;
}

export async function updateExportProgress(
    owner: ExportJobOwner,
    progress: ExportProgress
): Promise<void> {
    const previous = await getExportJob(owner.jobId);
    if (!previous || previous.userId !== owner.userId) return;
    if (isTerminalStatus(previous.status)) return;
    await save({
        ...previous,
        progress: normalizeProgress({...previous.progress, ...progress})
    });
}

export async function cancelExportJob(
    owner: ExportJobOwner
): Promise<ExportJob | null> {
    const previous = await getExportJob(owner.jobId);
    if (!previous || previous.userId !== owner.userId) return null;
    if (previous.status === 'ready' || previous.status === 'failed') {
        return previous;
    }
    // Marker first: a concurrent markExportReady that already passed its initial
    // read still sees this on its post-write re-check and rolls back to cancelled.
    await kv.set(cancelMarkerKey(owner.jobId), '1', reportArtifactTtlSec());
    const cancelled = {
        ...previous,
        status: 'cancelled' as const,
        progress: {...previous.progress, currentPhase: 'cancelled'}
    };
    await save(cancelled);
    return cancelled;
}

async function writeCancelled(jobId: string, userId: string): Promise<void> {
    const previous = await getExportJob(jobId);
    await save({
        jobId,
        userId,
        ...previous,
        status: 'cancelled',
        progress: {...previous?.progress, currentPhase: 'cancelled'}
    });
}

export async function isExportCancelled(jobId: string): Promise<boolean> {
    return (await getExportJob(jobId))?.status === 'cancelled';
}

function isTerminalStatus(status: ExportJobStatus): boolean {
    return status === 'ready' || status === 'failed' || status === 'cancelled';
}

function normalizeProgress(progress: ExportProgress): ExportProgress {
    const percent =
        typeof progress.percent === 'number'
            ? Math.max(0, Math.min(100, progress.percent))
            : undefined;
    return {...progress, ...(percent === undefined ? {} : {percent})};
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
