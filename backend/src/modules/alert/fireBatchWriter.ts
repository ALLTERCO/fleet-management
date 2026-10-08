// One writer for alert fires: fires that arrive within one tick commit in one
// transaction instead of one transaction each.
//
// Order per alert key: a batch holds at most one fire per key, and a key in a
// running batch waits for it. Two fires of one alert therefore commit in
// order, in separate transactions, and the second sees the first's row.

import * as log4js from 'log4js';
import {describeError} from '../errorDescription';
import {isDatabaseUnavailableError} from '../util/postgresErrorClass';

const logger = log4js.getLogger('AlertFireWriter');

/** What the writer reports; the metrics live outside the batching logic. */
export interface FireBatchObserver {
    batchFinished(
        rows: number,
        seconds: number,
        outcome: 'committed' | 'failed'
    ): void;
    splitRetried(): void;
    waited(seconds: number): void;
}

export interface FireBatchWriterOptions<T, R> {
    /** Most fires in one transaction. */
    readonly maxRows: number;
    /** Longest a fire waits for others before its batch is due. */
    readonly tickMs: number;
    /** Most batches committing at once; a second runs only for an overdue batch. */
    readonly maxFlushes: number;
    /** Writes the fires in one transaction; one result per fire, in order. */
    readonly commit: (items: readonly T[]) => Promise<readonly R[]>;
    readonly observer: FireBatchObserver;
}

interface QueuedFire<T, R> {
    readonly key: string;
    readonly item: T;
    readonly enqueuedAtMs: number;
    // Set by the tick timer, not by comparing clocks: a clock that stands
    // still or steps back must not hold a fire forever.
    due: boolean;
    resolve(result: R): void;
    reject(error: unknown): void;
}

type Attempt<R> =
    | {committed: true; results: readonly R[]}
    | {committed: false; error: unknown};

function noop(): void {}

function secondsSince(startMs: number): number {
    return Math.max(0, Date.now() - startMs) / 1000;
}

export class FireBatchWriter<T, R> {
    readonly #options: FireBatchWriterOptions<T, R>;
    #queue: QueuedFire<T, R>[] = [];
    readonly #busyKeys = new Set<string>();
    // The last fire written per key; it settles after every earlier one.
    readonly #lastByKey = new Map<string, Promise<void>>();
    #inFlight = 0;
    #timer: ReturnType<typeof setTimeout> | undefined;
    #draining = false;
    #idleWaiters: Array<() => void> = [];

    constructor(options: FireBatchWriterOptions<T, R>) {
        this.#options = options;
    }

    /** Resolves once the fire is committed; rejects with its own error. */
    write(key: string, item: T): Promise<R> {
        const result = new Promise<R>((resolve, reject) => {
            this.#queue.push({
                key,
                item,
                enqueuedAtMs: Date.now(),
                due: false,
                resolve,
                reject
            });
        });
        this.#trackKey(key, result);
        this.#pump();
        return result;
    }

    /** Resolves once every fire written so far for this key is done. */
    settled(key: string): Promise<void> {
        return this.#lastByKey.get(key) ?? Promise.resolve();
    }

    /** Commits everything queued now, without waiting for the tick. */
    async drain(): Promise<void> {
        this.#draining = true;
        const idle = new Promise<void>((resolve) => {
            this.#idleWaiters.push(resolve);
        });
        this.#pump();
        await idle;
    }

    depth(): number {
        return this.#queue.length;
    }

    flushesInFlight(): number {
        return this.#inFlight;
    }

    #trackKey(key: string, result: Promise<R>): void {
        const done = result.then(noop, noop);
        this.#lastByKey.set(key, done);
        void done.then(() => {
            if (this.#lastByKey.get(key) === done) this.#lastByKey.delete(key);
        });
    }

    #pump(): void {
        while (this.#inFlight < this.#options.maxFlushes) {
            const batch = this.#takeDueBatch();
            if (batch.length === 0) break;
            void this.#flush(batch);
        }
        this.#armTimer();
        this.#notifyIdle();
    }

    #takeDueBatch(): QueuedFire<T, R>[] {
        const batch = this.#eligibleFires();
        if (batch.length === 0 || !this.#isDue(batch)) return [];
        const taken = new Set(batch);
        this.#queue = this.#queue.filter((fire) => !taken.has(fire));
        return batch;
    }

    // Oldest first, one per key, none whose key is in a running batch.
    #eligibleFires(): QueuedFire<T, R>[] {
        const keys = new Set<string>();
        const batch: QueuedFire<T, R>[] = [];
        for (const fire of this.#queue) {
            if (batch.length >= this.#options.maxRows) break;
            if (this.#busyKeys.has(fire.key) || keys.has(fire.key)) continue;
            keys.add(fire.key);
            batch.push(fire);
        }
        return batch;
    }

    #isDue(batch: readonly QueuedFire<T, R>[]): boolean {
        return (
            this.#draining ||
            batch.length >= this.#options.maxRows ||
            batch[0].due
        );
    }

    // One tick runs from the first fire that is not yet due; when it ends,
    // everything queued is due.
    #armTimer(): void {
        if (this.#timer !== undefined) return;
        if (this.#queue.every((fire) => fire.due)) return;
        this.#timer = setTimeout(() => {
            this.#timer = undefined;
            for (const fire of this.#queue) fire.due = true;
            this.#pump();
        }, this.#options.tickMs);
    }

    #notifyIdle(): void {
        if (this.#queue.length > 0 || this.#inFlight > 0) return;
        this.#draining = false;
        const waiters = this.#idleWaiters;
        this.#idleWaiters = [];
        for (const resolve of waiters) resolve();
    }

    async #flush(batch: readonly QueuedFire<T, R>[]): Promise<void> {
        this.#inFlight += 1;
        for (const fire of batch) {
            this.#busyKeys.add(fire.key);
            this.#options.observer.waited(secondsSince(fire.enqueuedAtMs));
        }
        try {
            await this.#commitOrSplit(batch);
        } finally {
            for (const fire of batch) this.#busyKeys.delete(fire.key);
            this.#inFlight -= 1;
            this.#pump();
        }
    }

    async #commitOrSplit(batch: readonly QueuedFire<T, R>[]): Promise<void> {
        const startedMs = Date.now();
        const attempt = await this.#attempt(batch);
        this.#options.observer.batchFinished(
            batch.length,
            secondsSince(startedMs),
            attempt.committed ? 'committed' : 'failed'
        );
        if (attempt.committed) {
            batch.forEach((fire, index) => {
                fire.resolve(attempt.results[index]);
            });
            return;
        }
        await this.#retryOrReject(batch, attempt.error);
    }

    async #attempt(batch: readonly QueuedFire<T, R>[]): Promise<Attempt<R>> {
        try {
            const results = await this.#options.commit(
                batch.map((fire) => fire.item)
            );
            if (results.length !== batch.length) {
                throw new Error(
                    `alert fire batch returned ${results.length} results for ${batch.length} fires`
                );
            }
            return {committed: true, results};
        } catch (error) {
            return {committed: false, error};
        }
    }

    // The failed transaction does not say which fire broke it, so halve the
    // batch until that fire stands alone. An unreachable database fails every
    // half the same way, so that error goes straight back to the callers.
    async #retryOrReject(
        batch: readonly QueuedFire<T, R>[],
        error: unknown
    ): Promise<void> {
        if (batch.length === 1 || isDatabaseUnavailableError(error)) {
            for (const fire of batch) fire.reject(error);
            return;
        }
        this.#options.observer.splitRetried();
        logger.warn(
            'alert fire batch of %d failed, retrying in halves: %s',
            batch.length,
            describeError(error)
        );
        const middle = Math.ceil(batch.length / 2);
        await this.#commitOrSplit(batch.slice(0, middle));
        await this.#commitOrSplit(batch.slice(middle));
    }
}
