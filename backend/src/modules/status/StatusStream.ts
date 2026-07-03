// Single status Redis Stream API. The old "overflow" names are compatibility
// wrappers; normal Redis-first status writes use this same path.
import log4js from 'log4js';
import {tuning} from '../../config';
import * as Observability from '../Observability';
import type {RedisStream} from '../redis/RedisStream';
import {rateLimiter} from '../redis/services';
import {blockingStream, commandStream} from '../redis/streamClients';
import type {StatusBatch} from './batchCoalescer';

const logger = log4js.getLogger('status-stream');
const SCHEMA = 'status-batch-v1';

let stream: RedisStream | undefined;
let drainerStream: RedisStream | undefined;
let lastSaturationCheckMs = 0;

export interface AppendStatusBatchInput {
    batch: StatusBatch;
    organizationIds?: readonly string[];
}

function getStream(): RedisStream {
    if (!stream) {
        stream = commandStream(tuning.status.streamKey);
    }
    return stream;
}

function getDrainerStream(): RedisStream {
    if (!drainerStream) {
        drainerStream = blockingStream('status', tuning.status.streamKey);
    }
    return drainerStream;
}

function statusStreamFields(
    input: AppendStatusBatchInput
): Record<string, string> {
    const fields: Record<string, string> = {
        schema: SCHEMA,
        batch: JSON.stringify(input.batch),
        createdAt: new Date().toISOString()
    };
    if (input.organizationIds && input.organizationIds.length > 0) {
        fields.organizationIds = JSON.stringify([...input.organizationIds]);
    }
    return fields;
}

async function observeSaturation(s: RedisStream): Promise<void> {
    const interval = tuning.status.streamSaturationCheckMs;
    if (interval <= 0) return;
    const now = Date.now();
    if (now - lastSaturationCheckMs < interval) return;
    lastSaturationCheckMs = now;
    let depth: number;
    try {
        depth = await s.length();
    } catch (err) {
        logger.debug('status stream saturation probe failed: %s', err);
        return;
    }
    if (depth < tuning.status.streamMaxlen) return;
    Observability.incrementCounter('status_overflow_saturated');
    logger.warn(
        'status stream saturated depth=%d cap=%d — approximate MAXLEN may trim un-drained entries; raise FM_STATUS_STREAM_MAXLEN or restore drainer throughput',
        depth,
        tuning.status.streamMaxlen
    );
}

async function appendWithTimeout(
    s: RedisStream,
    fields: Record<string, string>
): Promise<string | null> {
    const timeoutMs = tuning.ingest.xaddTimeoutMs;
    const append = s.append(fields, {
        maxlen: tuning.status.streamMaxlen,
        ttlMs: tuning.status.streamTtlMs,
        rateCheck: tuning.redis.rateLimitEnabled
            ? () =>
                  rateLimiter.consume(
                      `xadd:${tuning.status.streamKey}`,
                      tuning.redis.rateLimitCapacity,
                      tuning.redis.rateLimitRefillPerSec
                  )
            : undefined,
        rateLabel: 'status'
    });
    if (timeoutMs <= 0) return append;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            append,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                `status stream XADD timed out after ${timeoutMs}ms`
                            )
                        ),
                    timeoutMs
                );
            })
        ]);
    } catch (err) {
        append.catch((lateErr) =>
            logger.warn('late status stream append failed: %s', lateErr)
        );
        throw err;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function appendStatusBatch(
    input: AppendStatusBatchInput
): Promise<void> {
    const s = getStream();
    const id = await appendWithTimeout(s, statusStreamFields(input));
    if (id === null) {
        Observability.incrementCounter('status_stream_degraded');
        return;
    }
    Observability.incrementCounter('status_stream_appends');
    await observeSaturation(s);
}

export async function appendStatusBatchBestEffort(
    input: AppendStatusBatchInput
): Promise<void> {
    try {
        await appendStatusBatch(input);
    } catch (err) {
        Observability.incrementCounter('status_stream_append_errors');
        logger.error('status stream append failed: %s', err);
    }
}

export async function appendStatusFieldsBestEffort(
    fields: Record<string, string>
): Promise<void> {
    const s = getStream();
    try {
        const id = await appendWithTimeout(s, fields);
        if (id !== null) {
            Observability.incrementCounter('status_overflow_spilled');
            await observeSaturation(s);
        }
    } catch (err) {
        Observability.incrementCounter('status_overflow_spill_errors');
        logger.error('status spill failed: %s', err);
    }
}

export function getStatusStream(): RedisStream {
    return getStream();
}

export function getStatusDrainerStream(): RedisStream {
    return getDrainerStream();
}

export function resetSaturationStateForTests(): void {
    lastSaturationCheckMs = 0;
}

export function resetForTests(): void {
    stream = undefined;
    drainerStream = undefined;
}
