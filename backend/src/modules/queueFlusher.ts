// Generic periodic flusher for any (queue, flush-fn) pair. Owns the
// "drain → flush → retry-on-failure → drop-on-overflow" loop that
// em_stats and lifetime_counters both need, so neither has to repeat
// the retry/drop/observability scaffolding.

import * as log4js from 'log4js';
import * as Observability from './Observability';

export interface FlushableQueue<TBatch> {
    size(): number;
    drain(): TBatch;
    prepend(batch: TBatch): void;
}

export interface QueueFlusherSpec<TBatch> {
    // Counter prefixes + log-line origin. Emits:
    // <name>_flushes, <name>_flushes_skipped, <name>_flush_errors,
    // <name>_data_dropped; DB timing recorded as <name>_flush.
    name: string;
    queue: FlushableQueue<TBatch>;
    flush: (batch: TBatch) => Promise<void>;
    batchSize: (batch: TBatch) => number;
    intervalMs: number;
    // Cap during retry — overflow drops the batch with telemetry
    // rather than letting a wedged PG grow memory unbounded.
    retryMax: number;
    // First flush always logs INFO. With this set, every Nth flush
    // after that logs again; counters always increment.
    logEveryNthFlush?: number;
}

// Stable configuration for a single flusher — passed to every
// internal helper so they don't each take (spec, logger) as a pair.
interface FlusherCtx<TBatch> {
    spec: QueueFlusherSpec<TBatch>;
    logger: log4js.Logger;
}

// Per-tick state — the drained batch + the monotonic sequence number
// that's used for "log every Nth" decisions.
interface FlushAttempt<TBatch> {
    ctx: FlusherCtx<TBatch>;
    batch: TBatch;
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
        logger: log4js.getLogger(`${spec.name}-flusher`)
    };
    let flushSeq = 0;
    let inFlight: Promise<void> = Promise.resolve();
    const flush = (): Promise<void> => {
        const next = inFlight.then(() => tick(ctx, ++flushSeq));
        inFlight = next.catch(() => undefined);
        return next;
    };
    const timer = setInterval(() => {
        void flush();
    }, spec.intervalMs);
    timer.unref?.();
    return {
        flushNow: flush,
        async stop() {
            clearInterval(timer);
            await flush();
        }
    };
}

async function tick<TBatch>(
    ctx: FlusherCtx<TBatch>,
    seq: number
): Promise<void> {
    if (ctx.spec.queue.size() === 0) return;
    if (Observability.isDbWritesDisabled()) {
        ctx.spec.queue.drain();
        Observability.incrementCounter(`${ctx.spec.name}_flushes_skipped`);
        return;
    }
    const batch = ctx.spec.queue.drain();
    Observability.incrementCounter(`${ctx.spec.name}_flushes`);
    await tryFlushOrRetry({ctx, batch, seq});
}

async function tryFlushOrRetry<TBatch>(
    attempt: FlushAttempt<TBatch>
): Promise<void> {
    try {
        await timedFlush(attempt);
    } catch (e) {
        handleFlushFailure(attempt, e);
    }
}

async function timedFlush<TBatch>(
    attempt: FlushAttempt<TBatch>
): Promise<void> {
    const {ctx, batch, seq} = attempt;
    const size = ctx.spec.batchSize(batch);
    if (shouldLogFlush(ctx.spec, seq)) {
        ctx.logger.info('flushing %d rows', size);
    }
    const start = performance.now();
    await ctx.spec.flush(batch);
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

function handleFlushFailure<TBatch>(
    attempt: FlushAttempt<TBatch>,
    error: unknown
): void {
    const {ctx, batch} = attempt;
    Observability.incrementCounter(`${ctx.spec.name}_flush_errors`);
    ctx.logger.error('flush failed: %s', error);
    const size = ctx.spec.batchSize(batch);
    if (size + ctx.spec.queue.size() <= ctx.spec.retryMax) {
        ctx.spec.queue.prepend(batch);
        return;
    }
    Observability.incrementCounter(`${ctx.spec.name}_data_dropped`);
    ctx.logger.warn(
        'queue overflow after flush error — dropped %d entries',
        size
    );
}
