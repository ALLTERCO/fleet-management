import {tuning} from '../../config';
import {emitReportProgress} from '../../modules/EventDistributor';
import {
    type ExportProgress,
    isExportCancelled,
    updateExportProgress
} from '../energy/exportJobStore';

/**
 * The real stage boundaries of a report run, in the order they are reached.
 * A job reports where it actually is, not a percentage that sits at zero while
 * the longest step runs.
 */
export const REPORT_PHASE_ORDER = [
    'queued',
    'checking_data',
    'reading_energy',
    'streaming',
    'computing',
    'writing',
    'rendering',
    'ready'
] as const;

export type ReportPhase = (typeof REPORT_PHASE_ORDER)[number];

// One scale for every kind, so each kind's subset is always increasing.
export const REPORT_PHASE_PERCENT: Record<ReportPhase, number> = {
    queued: 0,
    checking_data: 2,
    reading_energy: 10,
    streaming: 20,
    computing: 45,
    writing: 80,
    rendering: 90,
    ready: 100
};

export class ReportCancelledError extends Error {
    constructor() {
        super('report cancelled');
        this.name = 'ReportCancelledError';
    }
}

export interface ReportJobContext {
    jobId: string;
    userId: string;
    kind: string;
    orgId: string | null;
    estimatedRows?: number;
    update(progress: ExportProgress): Promise<void>;
    throwIfCancelled(): Promise<void>;
}

export function createReportJobContext(input: {
    jobId: string;
    userId: string;
    kind: string;
    orgId: string | null;
    estimatedRows?: number;
}): ReportJobContext {
    return {
        ...input,
        update: async (progress) => {
            await updateExportProgress(
                {
                    jobId: input.jobId,
                    userId: input.userId,
                    organizationId: input.orgId
                },
                progress
            );
            emitReportProgress(input.orgId, input.userId, {
                kind: input.kind,
                jobId: input.jobId,
                phase: progress.currentPhase ?? 'progress',
                ...progress
            });
        },
        throwIfCancelled: async () => {
            if (await isExportCancelled(input.jobId)) {
                throw new ReportCancelledError();
            }
        }
    };
}

/** Move the job to a named stage. The percent belongs to the stage, not to a
 *  guess, so callers cannot drift apart on what "45%" means. */
export async function enterReportPhase(
    context: ReportJobContext | undefined,
    phase: ReportPhase,
    extra: Omit<ExportProgress, 'currentPhase' | 'percent'> = {}
): Promise<void> {
    await context?.update({
        ...extra,
        currentPhase: phase,
        percent: REPORT_PHASE_PERCENT[phase]
    });
}

/**
 * Map a stage's own 0..1 fraction into the room that stage owns on the ladder.
 * The one place fine-grained progress is turned into a percent, so no caller
 * invents a scale of its own and sends the bar backwards.
 */
export function reportPhasePercent(
    phase: ReportPhase,
    fraction: number
): number {
    const start = REPORT_PHASE_PERCENT[phase];
    const next = REPORT_PHASE_ORDER[REPORT_PHASE_ORDER.indexOf(phase) + 1];
    const end = next === undefined ? 100 : REPORT_PHASE_PERCENT[next];
    if (!Number.isFinite(fraction) || fraction <= 0) return start;
    const room = end - start;
    return Math.min(end - 1, start + Math.floor(Math.min(1, fraction) * room));
}

/** Row progress mapped into the room the writing stage owns. */
export function reportWritingPercent(
    rowsWritten: number,
    estimatedRows: number | undefined
): number {
    if (!estimatedRows || estimatedRows <= 0) {
        return REPORT_PHASE_PERCENT.writing;
    }
    return reportPhasePercent('writing', rowsWritten / estimatedRows);
}

/** The one way a report reports rows written, for every kind and artifact. */
export async function reportWritingProgress(
    context: ReportJobContext | undefined,
    written: {rowsWritten: number; bytesWritten?: number}
): Promise<void> {
    // Only send fields with a value: a spread undefined erases what is stored.
    await context?.update({
        currentPhase: 'writing',
        ...(context.estimatedRows === undefined
            ? {}
            : {estimatedRows: context.estimatedRows}),
        rowsWritten: written.rowsWritten,
        ...(written.bytesWritten === undefined
            ? {}
            : {bytesWritten: written.bytesWritten}),
        percent: reportWritingPercent(
            written.rowsWritten,
            context.estimatedRows
        )
    });
}

/**
 * Progress from the isolated document render. Drawing runs on a worker thread
 * and counts its own rows, so it owns the stage after row writing rather than
 * competing for the same room.
 *
 * The percent follows drawn rows and nothing else. Restating a position the
 * render has already reached — which is all a liveness heartbeat does — leaves
 * it exactly where it was, so nobody can be told the job moved when it did not.
 */
export async function reportRenderProgress(
    context: ReportJobContext | undefined,
    drawn: {drawnRows: number; totalRows: number}
): Promise<void> {
    await context?.update({
        currentPhase: 'rendering',
        rowsWritten: drawn.drawnRows,
        percent: reportPhasePercent(
            'rendering',
            drawn.totalRows > 0 ? drawn.drawnRows / drawn.totalRows : 0
        )
    });
}

/**
 * The hooks a report job hands an artifact writer: real forward progress, a
 * liveness beat that restates position without moving the bar, and the job's
 * own cancel marker. Defined once so every report kind behaves identically.
 */
export function reportArtifactHooks(context: ReportJobContext | undefined): {
    onProgress: (drawn: {drawnRows: number; totalRows: number}) => void;
    onHeartbeat: (last: {drawnRows: number; totalRows: number}) => void;
    shouldCancel: () => Promise<boolean>;
} {
    return {
        onProgress: (drawn) => void reportRenderProgress(context, drawn),
        onHeartbeat: (last) => void reportRenderProgress(context, last),
        shouldCancel: async () =>
            context !== undefined && (await isExportCancelled(context.jobId))
    };
}

export interface ReportCancelPoller {
    throwIfCancelled(): Promise<void>;
}

/**
 * Cooperative cancel for a hot loop. The marker is re-read at most once per
 * FM_REPORT_CANCEL_POLL_MS, so a chunk boundary costs nothing most of the time
 * while a Report.Cancel still lands within one poll interval.
 */
export function createReportCancelPoller(
    context: ReportJobContext | undefined
): ReportCancelPoller {
    let nextCheckAt = 0;
    return {
        throwIfCancelled: async () => {
            if (!context) return;
            const now = Date.now();
            if (now < nextCheckAt) return;
            nextCheckAt = now + tuning.report.cancelPollMs;
            await context.throwIfCancelled();
        }
    };
}

export function isReportCancelledError(error: unknown): boolean {
    return error instanceof ReportCancelledError;
}
