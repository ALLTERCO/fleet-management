import log4js from 'log4js';
import {tuning} from '../../config';
import * as Observability from '../Observability';
import {isRedisWriteBackpressureError} from '../redis/commandBackpressure';
import type {RedisStream} from '../redis/RedisStream';
import {rateLimiter} from '../redis/services';
import {blockingStream, commandStream} from '../redis/streamClients';
import type {DeviceEventEntry} from './deviceEventRow';

const logger = log4js.getLogger('device-event-stream');
export const DEVICE_EVENT_STREAM_SCHEMA = 'device-event-v1';

let stream: RedisStream | undefined;
let drainerStream: RedisStream | undefined;
let lastSaturationCheckMs = 0;

function getStream(): RedisStream {
    if (!stream) {
        stream = commandStream('device-event', tuning.deviceEvents.streamKey);
    }
    return stream;
}

function getDrainerStream(): RedisStream {
    if (!drainerStream) {
        drainerStream = blockingStream(
            'device-event',
            tuning.deviceEvents.streamKey
        );
    }
    return drainerStream;
}

function eventFields(
    entries: readonly DeviceEventEntry[]
): Record<string, string> {
    return {
        schema: DEVICE_EVENT_STREAM_SCHEMA,
        entries: JSON.stringify(entries),
        createdAt: new Date().toISOString()
    };
}

async function observeSaturation(s: RedisStream): Promise<void> {
    const interval = tuning.deviceEvents.streamSaturationCheckMs;
    if (interval <= 0) return;
    const now = Date.now();
    if (now - lastSaturationCheckMs < interval) return;
    lastSaturationCheckMs = now;
    let depth: number;
    try {
        depth = await s.length();
    } catch (err) {
        logger.debug('device-event stream saturation probe failed: %s', err);
        return;
    }
    if (depth < tuning.deviceEvents.streamMaxlen) return;
    Observability.incrementCounter('device_event_stream_saturated');
    logger.warn(
        'device-event stream saturated depth=%d cap=%d — new event batches are rejected without trimming accepted events; restore drainer throughput',
        depth,
        tuning.deviceEvents.streamMaxlen
    );
}

async function appendEntries(
    s: RedisStream,
    fields: Record<string, string>
): Promise<string | null> {
    // Do not wrap an uncancellable Redis write in a local timeout. Once EVAL
    // is sent, a timeout cannot tell whether Redis committed it; reporting a
    // failure would make a retry either lose or duplicate durable events.
    // RedisStream's pending-command guard bounds memory while the command
    // remains the single authoritative result.
    return s.appendIfBelowCap(fields, {
        cap: tuning.deviceEvents.streamMaxlen,
        ttlMs: tuning.deviceEvents.streamTtlMs,
        rateCheck: tuning.redis.rateLimitEnabled
            ? () =>
                  rateLimiter.consume(
                      `xadd:${tuning.deviceEvents.streamKey}`,
                      tuning.redis.rateLimitCapacity,
                      tuning.redis.rateLimitRefillPerSec
                  )
            : undefined,
        rateLabel: 'device_event'
    });
}

export async function appendDeviceEventEntries(
    entries: readonly DeviceEventEntry[]
): Promise<void> {
    if (entries.length === 0) return;
    const s = getStream();
    const id = await appendEntries(s, eventFields(entries));
    if (id === null) {
        Observability.incrementCounter('device_event_stream_degraded');
        const atCapacity =
            (await s.length()) >= tuning.deviceEvents.streamMaxlen;
        if (atCapacity) {
            Observability.incrementCounter(
                'device_event_stream_capacity_rejected_total'
            );
        }
        throw new Error(
            atCapacity
                ? `device-event stream at capacity (${tuning.deviceEvents.streamMaxlen})`
                : 'device-event stream append was rate-limited'
        );
    }
    Observability.incrementCounter('device_event_stream_appends');
    await observeSaturation(s);
}

export async function appendDeviceEventEntriesBestEffort(
    entries: readonly DeviceEventEntry[]
): Promise<void> {
    try {
        await appendDeviceEventEntries(entries);
    } catch (err) {
        Observability.incrementCounter('device_event_stream_append_errors');
        if (isRedisWriteBackpressureError(err)) return;
        logger.error('device-event stream append failed: %s', err);
    }
}

export function getDeviceEventStream(): RedisStream {
    return getStream();
}

export function getDeviceEventDrainerStream(): RedisStream {
    return getDrainerStream();
}

export function resetSaturationStateForTests(): void {
    lastSaturationCheckMs = 0;
}

export function resetForTests(): void {
    stream = undefined;
    drainerStream = undefined;
}
