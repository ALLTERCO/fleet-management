// Bounded-concurrency fan-out. Each task gets an AbortSignal.timeout so
// a slow target cannot pin the pool. Tasks are snapshotted so mid-run
// caller-side mutation does not affect the run. With failFast, the
// helper stops pulling NEW tasks on the first rejection and throws it;
// in-flight tasks still finish (or hit perTaskTimeoutMs) before return.

import {assertValidTimeoutMs, withTimeout} from './withTimeout';

export interface RunBoundedParallelOptions<T, R> {
    readonly tasks: readonly T[];
    /** Receives the task and a signal that aborts at perTaskTimeoutMs. */
    readonly run: (task: T, signal: AbortSignal) => Promise<R>;
    /** Max tasks running at once. Capped at tasks.length. */
    readonly concurrency: number;
    /** Hard deadline per task. */
    readonly perTaskTimeoutMs: number;
    /** Used for labeling the TimeoutError thrown on per-task timeout. */
    readonly label: string;
    /** Throw the first rejection without waiting for the remainder. */
    readonly failFast?: boolean;
}

interface ValidatedRun<T, R> {
    readonly tasks: readonly T[];
    readonly run: (task: T, signal: AbortSignal) => Promise<R>;
    readonly workerCount: number;
    readonly perTaskTimeoutMs: number;
    readonly label: string;
    readonly failFast: boolean;
}

export async function runBoundedParallel<T, R>(
    opts: RunBoundedParallelOptions<T, R>
): Promise<PromiseSettledResult<R>[]> {
    if (opts.tasks.length === 0) return [];
    const ctx = validateAndFreeze(opts);
    const results: PromiseSettledResult<R>[] = new Array(ctx.tasks.length);
    let nextIndex = 0;
    let firstRejection: PromiseRejectedResult | undefined;

    async function worker(): Promise<void> {
        while (true) {
            if (ctx.failFast && firstRejection) return;
            const i = nextIndex++;
            if (i >= ctx.tasks.length) return;
            const result = await settledRun(ctx, i);
            results[i] = result;
            if (result.status === 'rejected' && !firstRejection) {
                firstRejection = result;
            }
        }
    }

    const workers: Promise<void>[] = [];
    for (let w = 0; w < ctx.workerCount; w++) workers.push(worker());
    await Promise.all(workers);
    if (ctx.failFast && firstRejection) throw firstRejection.reason;
    return results;
}

function validateAndFreeze<T, R>(
    opts: RunBoundedParallelOptions<T, R>
): ValidatedRun<T, R> {
    assertValidConcurrency(opts.concurrency, opts.label);
    assertValidTimeoutMs(opts.perTaskTimeoutMs, opts.label);
    // Snapshot so mid-run array mutation cannot affect the run.
    const tasks = Object.freeze(opts.tasks.slice());
    const workerCount = Math.min(Math.floor(opts.concurrency), tasks.length);
    return {
        tasks,
        run: opts.run,
        workerCount,
        perTaskTimeoutMs: opts.perTaskTimeoutMs,
        label: opts.label,
        failFast: opts.failFast === true
    };
}

function assertValidConcurrency(value: number, label: string): void {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new RangeError(
            `${label}: concurrency must be a finite integer (got ${value})`
        );
    }
    if (value < 1) {
        throw new RangeError(
            `${label}: concurrency must be ≥ 1 (got ${value})`
        );
    }
}

function runTaskAt<T, R>(ctx: ValidatedRun<T, R>, index: number): Promise<R> {
    return withTimeout(
        (signal) => ctx.run(ctx.tasks[index], signal),
        ctx.perTaskTimeoutMs,
        `${ctx.label}[${index}]`
    );
}

async function settledRun<T, R>(
    ctx: ValidatedRun<T, R>,
    index: number
): Promise<PromiseSettledResult<R>> {
    try {
        const value = await runTaskAt(ctx, index);
        return {status: 'fulfilled', value};
    } catch (reason) {
        return {status: 'rejected', reason};
    }
}
