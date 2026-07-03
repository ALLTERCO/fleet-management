// One front door for generating report files. Report.Generate runs the report
// in the background and returns a jobId; this starts it and polls
// Report.GetReport until the file is ready, then returns the owner-bound file
// reference (plus the optional HTML twin for energy reports).

interface RpcClient {
    sendRPC<T>(target: string, method: string, params: unknown): Promise<T>;
}

interface ReportJob {
    jobId: string;
}

// Live progress snapshot. Report.Progress sends this over WS; Report.GetReport
// returns the same durable shape for polling/reconnect fallback.
export interface ReportProgress {
    jobId?: string;
    estimatedRows?: number;
    rowsWritten?: number;
    bytesWritten?: number;
    currentPhase?: string;
    percent?: number;
}

interface ReportStatus {
    status: 'pending' | 'ready' | 'failed' | 'cancelled';
    downloadUrl: string | null;
    htmlUrl: string | null;
    progress: ReportProgress | null;
    error: string | null;
}

export interface ReportFileRef {
    file: string;
    name: string;
    htmlFile?: string;
}

// Thrown when a job ends in `cancelled` — a user action, not a failure, so
// callers can skip the error toast.
export class ReportCancelledError extends Error {
    constructor() {
        super('Report cancelled');
        this.name = 'ReportCancelledError';
    }
}

export class ReportPollAbortedError extends Error {
    constructor() {
        super('Report polling aborted');
        this.name = 'ReportPollAbortedError';
    }
}

export interface GenerateOptions {
    /** Receives the jobId as soon as the job is created (wire up Cancel). */
    onStart?: (jobId: string) => void;
    /** Called with each poll's progress snapshot. */
    onProgress?: (progress: ReportProgress) => void;
    /** Stops polling when the owning view unmounts or starts another job. */
    signal?: AbortSignal;
}

const POLL_INTERVAL_MS = 1000;
// Backend bounds a raw export at FM_EXPORT_STATEMENT_TIMEOUT_MS (10m default);
// give the poll a margin over that before giving up so a stuck job can't spin
// the client forever.
const POLL_DEADLINE_MS = 15 * 60 * 1000;

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new ReportPollAbortedError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                window.clearTimeout(timer);
                reject(new ReportPollAbortedError());
            },
            {once: true}
        );
    });
}

function fileFromUrl(url: string): string {
    return url.split('/').pop() ?? url;
}

function toFileRef(job: ReportStatus, name: string): ReportFileRef {
    return {
        file: job.downloadUrl ? fileFromUrl(job.downloadUrl) : '',
        name,
        htmlFile: job.htmlUrl ? fileFromUrl(job.htmlUrl) : undefined
    };
}

export async function pollUntilReady(
    ws: RpcClient,
    jobId: string,
    name: string,
    onProgress?: (progress: ReportProgress) => void,
    signal?: AbortSignal
): Promise<ReportFileRef> {
    const deadline = performance.now() + POLL_DEADLINE_MS;
    while (performance.now() < deadline) {
        throwIfAborted(signal);
        const job = await ws.sendRPC<ReportStatus>(
            'FLEET_MANAGER',
            'report.getreport',
            {jobId}
        );
        throwIfAborted(signal);
        if (job.progress) onProgress?.({...job.progress, jobId});
        if (job.status === 'ready') return toFileRef(job, name);
        if (job.status === 'cancelled') throw new ReportCancelledError();
        if (job.status === 'failed') {
            throw new Error(job.error ?? 'Report generation failed');
        }
        await sleep(POLL_INTERVAL_MS, signal);
    }
    throw new Error('Report timed out — try a shorter range or coarser bucket');
}

export async function generateReportFile(
    ws: RpcClient,
    params: Record<string, unknown>,
    name: string,
    opts?: GenerateOptions
): Promise<ReportFileRef> {
    throwIfAborted(opts?.signal);
    const {jobId} = await ws.sendRPC<ReportJob>(
        'FLEET_MANAGER',
        'report.generate',
        params
    );
    throwIfAborted(opts?.signal);
    opts?.onStart?.(jobId);
    return pollUntilReady(ws, jobId, name, opts?.onProgress, opts?.signal);
}

// Cancel a running job. The in-flight poll observes `cancelled` on its next
// tick and rejects with ReportCancelledError.
export async function cancelReport(
    ws: RpcClient,
    jobId: string
): Promise<void> {
    await ws.sendRPC('FLEET_MANAGER', 'report.cancel', {jobId});
}
