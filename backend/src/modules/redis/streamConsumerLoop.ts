// Generic consumer loop used by every Stream drainer.
import log4js from 'log4js';
import {sleep} from '../util/sleep';
import type {RedisStream, StreamEntry} from './RedisStream';

const logger = log4js.getLogger('stream-consumer');

export interface ConsumerLoopOptions {
    stream: RedisStream;
    group: string;
    consumer: string;
    count: number;
    blockMs: number;
    /** Process a batch. Throw to keep entries un-acked (retry on next read). */
    onBatch: (entries: StreamEntry[]) => Promise<void>;
    /** Optional gate — return false to pause reads until next tick. */
    pauseUntil?: () => boolean;
    /** ms to wait after onBatch throws before next read. */
    errorBackoffMs?: number;
}

export interface ConsumerLoopHandle {
    stop(): void;
    /** Promise resolves when the loop exits cleanly. */
    done: Promise<void>;
}

export function runConsumer(opts: ConsumerLoopOptions): ConsumerLoopHandle {
    let stopped = false;
    const errorBackoff = opts.errorBackoffMs ?? 1_000;

    const done = (async () => {
        await opts.stream.ensureGroup(opts.group);
        while (!stopped) {
            if (opts.pauseUntil?.() === false) {
                await sleep(50);
                continue;
            }
            let entries: StreamEntry[] = [];
            try {
                entries = await opts.stream.readGroup({
                    group: opts.group,
                    consumer: opts.consumer,
                    count: opts.count,
                    blockMs: opts.blockMs
                });
            } catch (err) {
                logger.warn(
                    'readGroup failed key=%s: %s — backing off',
                    opts.stream.key,
                    err
                );
                await sleep(errorBackoff);
                continue;
            }
            if (entries.length === 0) {
                // Yield the event loop. Real Redis blocks per BLOCK ms;
                // an in-memory fake returns immediately, so without a yield
                // we'd hot-spin. Sleep ~10 ms when nothing arrived.
                await sleep(10);
                continue;
            }
            try {
                await opts.onBatch(entries);
                await opts.stream.ack(
                    opts.group,
                    entries.map((e) => e.id)
                );
            } catch (err) {
                logger.warn(
                    'onBatch failed key=%s entries=%d: %s — retrying',
                    opts.stream.key,
                    entries.length,
                    err
                );
                await sleep(errorBackoff);
            }
        }
    })();

    return {
        stop() {
            stopped = true;
        },
        done
    };
}
