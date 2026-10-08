// Generic periodic flusher for any (queue, flush-fn) pair. Owns the
// "drain → flush → retry with backoff → spill when over budget → drop only
// by age" loop that em_stats and lifetime_counters both need, so neither
// has to repeat the retry/spill/observability scaffolding.

import * as log4js from 'log4js';
import * as Observability from './Observability';
import type {CounterName} from './observability/counters';

export interface FlushableQueue<TBatch> {
    size(): number;
    drain(): TBatch;
    prepend(batch: TBatch): void;
    // Timed ticks take only rows that can no longer change; drain() takes all.
    drainSettled?(): TBatch;
}

export interface QueueFlusherSpec<TBatch> {
    // Log-line origin and DB timing prefix.
    name: string;
    counters: {
        flushes: CounterName;
        flushesSkipped: CounterName;
        flushErrors: CounterName;
        dataDropped: CounterName;
    };
    queue: FlushableQueue<TBatch>;
    // Adds the rows a source owes every tick (a periodic stamp), before the
    // queue is read, so they flush even when nothing else arrived.
    beforeTick?: () => void;
    flush: (batch: TBatch) => Promise<void>;
    // Saves a batch as parts, each its own write, so no single write holds a
    // connection for the whole batch. A failure keeps only unwritten parts.
    split?: (batch: TBatch) => TBatch[];
    batchSize: (batch: TBatch) => number;
    intervalMs: number;
    // Rows held in memory during retry. Over this the failed batch goes to
    // `spill`; without a spill it is dropped with telemetry, so a wedged PG
    // cannot grow memory unbounded.
    retryMax: number;
    // Durable store for a batch that no longer fits in memory.
    spill?: (batch: TBatch) => Promise<void>;
    // Rows held longer than this are dropped, counted and logged as an error.
    maxAgeMs?: number;
    // Longest wait between attempts after repeated failures.
    retryBackoffMaxMs?: number;
    // Clock seam for tests.
    now?: () => number;
    // First flush always logs INFO. With this set, every Nth flush
    // after that logs again; counters always increment.
    logEveryNthFlush?: number;
}

// Stable configuration for a single flusher — passed to every
// internal helper so they don't each take (spec, logger) as a pair.
interface FlusherCtx<TBatch> {
    spec: QueueFlusherSpec<TBatch>;
    logger: log4js.Logger;
    retry: RetryState;
}

// Failure bookkeeping between ticks: how long the oldest held rows have
// waited and when the database may be tried again.
interface RetryState {
    failures: number;
    heldSinceMs: number | undefined;
    nextAttemptMs: number;
}

// Per-tick state — the drained batch in parts + the monotonic sequence
// number that's used for "log every Nth" decisions. `written` counts the
// parts already committed, so a failure handles only the rest.
interface FlushAttempt<TBatch> {
    ctx: FlusherCtx<TBatch>;
    parts: TBatch[];
    written: number;
    seq: number;
}

export interface QueueFlusherHandle {
    // Flushes the current batch without stopping the periodic worker.
    flushNow(): Promise<void>;
    // Stops the timer and flushes any remaining batch once, so a graceful
    // shutdown doesn't drop buffered rows.
    stop(): Promise<void>;
}

export function createQueueFlusher<TBatch>(
    spec: QueueFlusherSpec<TBatch>
): QueueFlusherHandle {
    const ctx: FlusherCtx<TBatch> = {
        spec,
        logger: log4js.getLogger(`${spec.name}-flusher`),
        retry: {failures: 0, heldSinceMs: undefined, nextAttemptMs: 0}
    };
    let flushSeq = 0;
    let inFlight: Promise<void> = Promise.resolve();
    // An explicit flush (shutdown, tests) ignores the retry backoff; only the
    // timer waits.
    const flush = (force: boolean): Promise<void> => {
        const next = inFlight.then(() => tick(ctx, ++flushSeq, force));
        inFlight = next.catch(() => undefined);
        return next;
    };
    const timer = setInterval(() => {
        void flush(false);
    }, spec.intervalMs);
    timer.unref?.();
    return {
        flushNow: () => flush(true),
        async stop() {
            clearInterval(timer);
            await flush(true);
        }
    };
}

async function tick<TBatch>(
    ctx: FlusherCtx<TBatch>,
    seq: number,
    force: boolean
): Promise<void> {
    ctx.spec.beforeTick?.();
    if (ctx.spec.queue.size() === 0) return;
    // Hold the queue until writes re-enable, as the audit and device-event
    // flushers do. Draining here destroyed the batch while the counter name
    // said "skipped", so a paused deployment lost energy silently.
    if (Observability.isDbWritesDisabled()) {
        Observability.incrementCounter(ctx.spec.counters.flushesSkipped);
        return;
    }
    if (!force && nowMs(ctx) < ctx.retry.nextAttemptMs) return;
    const batch = drainFor(ctx.spec.queue, force);
    if (ctx.spec.batchSize(batch) === 0) return;
    Observability.incrementCounter(ctx.spec.counters.flushes);
    const parts = ctx.spec.split?.(batch) ?? [batch];
    await tryFlushOrRetry({ctx, parts, written: 0, seq});
}

async function tryFlushOrRetry<TBatch>(
    attempt: FlushAttempt<TBatch>
): Promise<void> {
    try {
        await timedFlush(attempt);
        attempt.ctx.retry.failures = 0;
        attempt.ctx.retry.heldSinceMs = undefined;
    } catch (e) {
        await handleFlushFailure(attempt, e);
    }
}

function drainFor<TBatch>(
    queue: FlushableQueue<TBatch>,
    force: boolean
): TBatch {
    if (force || !queue.drainSettled) return queue.drain();
    return queue.drainSettled();
}

function nowMs<TBatch>(ctx: FlusherCtx<TBatch>): number {
    return ctx.spec.now?.() ?? Date.now();
}

// Exponential backoff with jitter, capped, so a database that comes back is
// not hit by every buffer at once.
function scheduleRetry<TBatch>(ctx: FlusherCtx<TBatch>): void {
    const {retry, spec} = ctx;
    retry.failures += 1;
    retry.heldSinceMs ??= nowMs(ctx);
    const cap = spec.retryBackoffMaxMs ?? spec.intervalMs;
    const wait = Math.min(cap, spec.intervalMs * 2 ** (retry.failures - 1));
    retry.nextAttemptMs = nowMs(ctx) + wait * (0.5 + Math.random() * 0.5);
}

function heldTooLong<TBatch>(ctx: FlusherCtx<TBatch>): boolean {
    const {maxAgeMs} = ctx.spec;
    const since = ctx.retry.heldSinceMs;
    return (
        maxAgeMs !== undefined &&
        since !== undefined &&
        nowMs(ctx) - since > maxAgeMs
    );
}

function rowsIn<TBatch>(ctx: FlusherCtx<TBatch>, parts: TBatch[]): number {
    return parts.reduce((sum, part) => sum + ctx.spec.batchSize(part), 0);
}

// Puts parts back ahead of newer rows, keeping their order.
function prependParts<TBatch>(ctx: FlusherCtx<TBatch>, parts: TBatch[]): void {
    for (let i = parts.length - 1; i >= 0; i--) {
        ctx.spec.queue.prepend(parts[i]);
    }
}

function dropBatch<TBatch>(
    ctx: FlusherCtx<TBatch>,
    parts: TBatch[],
    reason: string
): void {
    const size = rowsIn(ctx, parts);
    Observability.incrementCounter(ctx.spec.counters.dataDropped, size);
    ctx.logger.error('dropped %d rows: %s', size, reason);
    ctx.retry.heldSinceMs = undefined;
}

async function spillOrKeep<TBatch>(
    ctx: FlusherCtx<TBatch>,
    parts: TBatch[]
): Promise<void> {
    const {spill} = ctx.spec;
    if (!spill) {
        dropBatch(ctx, parts, 'over the memory budget and no durable store');
        return;
    }
    const kept: TBatch[] = [];
    for (const part of parts) {
        try {
            await spill(part);
        } catch (err) {
            ctx.logger.error(
                'durable store refused %d rows, keeping them in memory: %s',
                ctx.spec.batchSize(part),
                err
            );
            kept.push(part);
        }
    }
    if (kept.length === 0) ctx.retry.heldSinceMs = undefined;
    prependParts(ctx, kept);
}

async function timedFlush<TBatch>(
    attempt: FlushAttempt<TBatch>
): Promise<void> {
    const {ctx, parts, seq} = attempt;
    if (shouldLogFlush(ctx.spec, seq)) {
        ctx.logger.info(
            'flushing %d rows in %d parts',
            rowsIn(ctx, parts),
            parts.length
        );
    }
    const start = performance.now();
    for (const part of parts.slice(attempt.written)) {
        await ctx.spec.flush(part);
        attempt.written++;
    }
    Observability.recordDbTiming(
        `${ctx.spec.name}_flush`,
        performance.now() - start
    );
}

function shouldLogFlush<TBatch>(
    spec: QueueFlusherSpec<TBatch>,
    seq: number
): boolean {
    const every = spec.logEveryNthFlush;
    if (every === undefined) return true;
    return seq % every === 1;
}

async function handleFlushFailure<TBatch>(
    attempt: FlushAttempt<TBatch>,
    error: unknown
): Promise<void> {
    const {ctx} = attempt;
    const unwritten = attempt.parts.slice(attempt.written);
    Observability.incrementCounter(ctx.spec.counters.flushErrors);
    ctx.logger.error(
        'flush failed after %d of %d parts: %s',
        attempt.written,
        attempt.parts.length,
        error
    );
    scheduleRetry(ctx);
    if (heldTooLong(ctx)) {
        dropBatch(ctx, unwritten, `held longer than ${ctx.spec.maxAgeMs} ms`);
        return;
    }
    if (rowsIn(ctx, unwritten) + ctx.spec.queue.size() <= ctx.spec.retryMax) {
        prependParts(ctx, unwritten);
        return;
    }
    await spillOrKeep(ctx, unwritten);
}
