/**
 * Starts the PDF drawing pass on a worker thread and relays its progress.
 *
 * One worker per render rather than a pool: a report draws its document once,
 * at the very end of the artifact pipeline, and only when PDF output was asked
 * for. A per-job thread matches that lifecycle exactly, needs no boot-order
 * wiring in app.ts, and leaves nothing running between reports. How many may
 * run at once is enforced here, by the semaphore below.
 */

import fsSync from 'node:fs';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {getLogger} from 'log4js';
import {tuning} from '../../config';
import type {
    PdfRenderInput,
    PdfRenderOptions,
    PdfRenderProgress,
    PdfRenderRunner
} from './pdfArtifact';
import {ReportCancelledError} from './reportJobContext';

const logger = getLogger('pdfRenderHost');

// A render this far past its performance budget is stuck, not slow. Killing it
// fails the job cleanly instead of holding a thread and its temp file forever.
const RENDER_TIMEOUT_FACTOR = 10;
const RENDER_TIMEOUT_FLOOR_MS = 60_000;

// The longest a caller may go without hearing anything while a render is still
// running. A single pathologically slow row cannot emit from inside itself, so
// the last known position is restated from out here.
const PROGRESS_HEARTBEAT_MS = 2_000;

type WorkerMessage =
    | ({type: 'progress'} & PdfRenderProgress)
    | {type: 'done'; bytes: number}
    | {type: 'failed'; message: string};

export function pdfRenderTimeoutMs(): number {
    return Math.max(
        RENDER_TIMEOUT_FLOOR_MS,
        tuning.report.pdfRenderBudgetMs * RENDER_TIMEOUT_FACTOR
    );
}

/**
 * FIFO admission to the render slots.
 *
 * A released slot is handed straight to the next waiter without the count ever
 * dipping. Decrementing first and letting the waiter re-increment leaves a gap
 * in which a newcomer takes the slot that was already promised, and the limit
 * is briefly exceeded.
 */
export class RenderSlots {
    private readonly limit: number;
    private inUse = 0;
    private readonly waiting: Array<{
        resolve: () => void;
        reject: (error: Error) => void;
    }> = [];

    constructor(limit: number) {
        this.limit = limit;
    }

    get active(): number {
        return this.inUse;
    }

    get queued(): number {
        return this.waiting.length;
    }

    async acquire(waitCancelled?: () => Promise<boolean>): Promise<() => void> {
        if (this.inUse < this.limit) {
            this.inUse += 1;
        } else {
            await this.waitForSlot(waitCancelled);
        }
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const next = this.waiting.shift();
            // Ownership transfers; the slot is never briefly free.
            if (next) {
                next.resolve();
                return;
            }
            this.inUse -= 1;
        };
    }

    private waitForSlot(waitCancelled?: () => Promise<boolean>): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let poll: NodeJS.Timeout | undefined;
            const entry = {
                resolve: () => {
                    if (poll) clearInterval(poll);
                    resolve();
                },
                reject: (error: Error) => {
                    if (poll) clearInterval(poll);
                    reject(error);
                }
            };
            this.waiting.push(entry);
            if (!waitCancelled) return;
            poll = setInterval(() => {
                void waitCancelled()
                    .then((stop) => {
                        if (!stop) return;
                        const index = this.waiting.indexOf(entry);
                        // Gone from the queue means a slot was already handed
                        // over; the dequeue check refuses it instead.
                        if (index < 0) return;
                        this.waiting.splice(index, 1);
                        entry.reject(new ReportCancelledError());
                    })
                    .catch(() => undefined);
            }, tuning.report.cancelPollMs);
            poll.unref();
        });
    }
}

const slots = new RenderSlots(tuning.report.pdfRenderConcurrency);

let rendersStarted = 0;

/** How many render workers have been spawned. Ops and tests read it to tell a
 *  refused render from one that ran. */
export function pdfRendersStarted(): number {
    return rendersStarted;
}

/** Test/ops view of how many renders hold a slot right now. */
export function activePdfRenders(): number {
    return slots.active;
}

async function cancelRequested(options: PdfRenderOptions): Promise<boolean> {
    if (!options.shouldCancel) return false;
    try {
        return await options.shouldCancel();
    } catch {
        // An unreadable marker is not a cancellation; the render continues.
        return false;
    }
}

export const renderPdfInWorker: PdfRenderRunner = async (
    input: PdfRenderInput,
    options: PdfRenderOptions = {}
) => {
    // Cancelled before queueing: never take a slot from a live render.
    if (await cancelRequested(options)) throw new ReportCancelledError();
    const release = await slots.acquire(
        options.shouldCancel ? () => cancelRequested(options) : undefined
    );
    try {
        // Checked again at dequeue: a job cancelled while it waited must not
        // spawn a worker just because a slot finally came free.
        if (await cancelRequested(options)) throw new ReportCancelledError();
        return await runRenderWorker(input, options);
    } finally {
        release();
    }
};

function runRenderWorker(
    input: PdfRenderInput,
    options: PdfRenderOptions
): Promise<{bytes: number}> {
    return new Promise<{bytes: number}>((resolve, reject) => {
        const {entry, execArgv} = workerEntry();
        rendersStarted += 1;
        const worker = new Worker(entry, {
            workerData: input,
            ...(execArgv ? {execArgv} : {})
        });
        let settled = false;
        let latest: PdfRenderProgress = {drawnRows: 0, totalRows: 0};
        const timers: NodeJS.Timeout[] = [];
        const settle = (outcome: () => void): void => {
            if (settled) return;
            settled = true;
            for (const timer of timers) clearInterval(timer);
            void worker.terminate().catch(() => undefined);
            outcome();
        };

        const timeoutMs = pdfRenderTimeoutMs();
        timers.push(
            setTimeout(() => {
                logger.warn(
                    'PDF render worker exceeded %dms for %s — terminating',
                    timeoutMs,
                    input.filename
                );
                settle(() =>
                    reject(
                        new Error(`PDF render timed out after ${timeoutMs}ms`)
                    )
                );
            }, timeoutMs)
        );

        if (options.onHeartbeat) {
            const beat = options.onHeartbeat;
            timers.push(
                setInterval(
                    () => beat(latest),
                    options.heartbeatMs ?? PROGRESS_HEARTBEAT_MS
                )
            );
        }

        if (options.shouldCancel) {
            const cancelled = options.shouldCancel;
            timers.push(
                setInterval(() => {
                    void cancelled()
                        .then((stop) => {
                            if (!stop) return;
                            logger.info(
                                'PDF render cancelled for %s — terminating worker',
                                input.filename
                            );
                            settle(() => reject(new ReportCancelledError()));
                        })
                        .catch(() => undefined);
                }, tuning.report.cancelPollMs)
            );
        }

        // No timer here may be the reason the process stays alive.
        for (const timer of timers) timer.unref();

        worker.on('message', (message: WorkerMessage) => {
            if (message.type === 'progress') {
                latest = {
                    drawnRows: message.drawnRows,
                    totalRows: message.totalRows
                };
                options.onProgress?.(latest);
                return;
            }
            if (message.type === 'done') {
                settle(() => resolve({bytes: message.bytes}));
                return;
            }
            settle(() => reject(new Error(message.message)));
        });
        worker.on('error', (error) => settle(() => reject(error)));
        worker.on('exit', (code) =>
            settle(() =>
                reject(new Error(`PDF render worker exited with code ${code}`))
            )
        );
    });
}

// The built image runs the compiled entry; a tsx dev or test process only has
// the TypeScript one beside it and needs the loader passed through.
function workerEntry(): {entry: string; execArgv?: string[]} {
    const compiled = path.join(__dirname, 'pdfRenderWorker.js');
    if (fsSync.existsSync(compiled)) return {entry: compiled};
    return {
        entry: path.join(__dirname, 'pdfRenderWorker.ts'),
        execArgv: ['--import', 'tsx']
    };
}
