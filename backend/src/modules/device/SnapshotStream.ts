import log4js from 'log4js';
import {tuning} from '../../config';
import type {ShellyDeviceExternal} from '../../types';
import * as Observability from '../Observability';
import type {RedisStream} from '../redis/RedisStream';
import {rateLimiter} from '../redis/services';
import {blockingStream, commandStream} from '../redis/streamClients';

const logger = log4js.getLogger('device-snapshot-stream');
export const DEVICE_SNAPSHOT_SCHEMA = 'device-snapshot-v1';

let stream: RedisStream | undefined;
let drainerStream: RedisStream | undefined;
let lastSaturationCheckMs = 0;

export interface DeviceSnapshotEntry {
    externalId: string;
    jdoc: ShellyDeviceExternal;
    organizationId?: string;
}

function getStream(): RedisStream {
    if (!stream) {
        stream = commandStream(tuning.deviceSnapshot.streamKey);
    }
    return stream;
}

function getDrainerStream(): RedisStream {
    if (!drainerStream) {
        drainerStream = blockingStream(
            'snapshot',
            tuning.deviceSnapshot.streamKey
        );
    }
    return drainerStream;
}

function snapshotFields(entry: DeviceSnapshotEntry): Record<string, string> {
    const fields: Record<string, string> = {
        schema: DEVICE_SNAPSHOT_SCHEMA,
        externalId: entry.externalId,
        jdoc: JSON.stringify(entry.jdoc),
        createdAt: new Date().toISOString()
    };
    if (entry.organizationId) fields.organizationId = entry.organizationId;
    return fields;
}

async function observeSaturation(s: RedisStream): Promise<void> {
    const interval = tuning.deviceSnapshot.streamSaturationCheckMs;
    if (interval <= 0) return;
    const now = Date.now();
    if (now - lastSaturationCheckMs < interval) return;
    lastSaturationCheckMs = now;
    let depth: number;
    try {
        depth = await s.length();
    } catch (err) {
        logger.debug('device snapshot stream saturation probe failed: %s', err);
        return;
    }
    if (depth < tuning.deviceSnapshot.streamMaxlen) return;
    Observability.incrementCounter('device_snapshot_stream_saturated');
    logger.warn(
        'device snapshot stream saturated depth=%d cap=%d — raise FM_DEVICE_SNAPSHOT_STREAM_MAXLEN or restore drainer throughput',
        depth,
        tuning.deviceSnapshot.streamMaxlen
    );
}

async function appendWithTimeout(
    s: RedisStream,
    fields: Record<string, string>
): Promise<string | null> {
    const timeoutMs = tuning.ingest.xaddTimeoutMs;
    const append = s.append(fields, {
        maxlen: tuning.deviceSnapshot.streamMaxlen,
        ttlMs: tuning.deviceSnapshot.streamTtlMs,
        rateCheck: tuning.redis.rateLimitEnabled
            ? () =>
                  rateLimiter.consume(
                      `xadd:${tuning.deviceSnapshot.streamKey}`,
                      tuning.redis.rateLimitCapacity,
                      tuning.redis.rateLimitRefillPerSec
                  )
            : undefined,
        rateLabel: 'device_snapshot'
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
                                `device snapshot stream XADD timed out after ${timeoutMs}ms`
                            )
                        ),
                    timeoutMs
                );
            })
        ]);
    } catch (err) {
        append.catch((lateErr) =>
            logger.warn(
                'late device snapshot stream append failed: %s',
                lateErr
            )
        );
        throw err;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function appendDeviceSnapshot(
    entry: DeviceSnapshotEntry
): Promise<void> {
    const s = getStream();
    const id = await appendWithTimeout(s, snapshotFields(entry));
    if (id === null) {
        Observability.incrementCounter('device_snapshot_stream_degraded');
        return;
    }
    Observability.incrementCounter('device_snapshot_stream_appends');
    await observeSaturation(s);
}

export async function appendDeviceSnapshotBestEffort(
    entry: DeviceSnapshotEntry
): Promise<void> {
    try {
        await appendDeviceSnapshot(entry);
    } catch (err) {
        Observability.incrementCounter('device_snapshot_stream_append_errors');
        logger.error('device snapshot stream append failed: %s', err);
    }
}

export function getDeviceSnapshotStream(): RedisStream {
    return getStream();
}

export function getDeviceSnapshotDrainerStream(): RedisStream {
    return getDrainerStream();
}

export function resetSaturationStateForTests(): void {
    lastSaturationCheckMs = 0;
}

export function resetForTests(): void {
    stream = undefined;
    drainerStream = undefined;
}
