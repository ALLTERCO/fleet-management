// Single status Redis Stream API. The old "overflow" names are compatibility
// wrappers; normal Redis-first status writes use this same path.
import log4js from 'log4js';
import {tuning} from '../../config';
import * as Observability from '../Observability';
import {isRedisWriteBackpressureError} from '../redis/commandBackpressure';
import type {RedisStream} from '../redis/RedisStream';
import {rateLimiter} from '../redis/services';
import {blockingStream, commandStream} from '../redis/streamClients';
import type {StatusBatch, StatusSourceDevice} from './batchCoalescer';

const logger = log4js.getLogger('status-stream');
const SCHEMA = 'status-batch-v2';

let stream: RedisStream | undefined;
let drainerStream: RedisStream | undefined;
let lastSaturationCheckMs = 0;
let lastPressure: StatusPressure = 'normal';

export type StatusPressure = 'normal' | 'warning' | 'critical' | 'full';

export function statusPressure(depth: number, maxlen: number): StatusPressure {
    if (maxlen <= 0) return 'normal';
    const percent = (depth / maxlen) * 100;
    if (percent >= 100) return 'full';
    if (percent >= 85) return 'critical';
    if (percent >= 70) return 'warning';
    return 'normal';
}

function recordPressure(depth: number, trimmed: number): void {
    const maxlen = tuning.status.streamMaxlen;
    const percent = maxlen > 0 ? (depth / maxlen) * 100 : 0;
    const pressure = statusPressure(depth, maxlen);
    Observability.setGauge('status_stream_fill_percent', percent);
    Observability.setGauge(
        'status_stream_warning',
        pressure === 'normal' ? 0 : 1
    );
    Observability.setGauge(
        'status_stream_critical',
        pressure === 'critical' || pressure === 'full' ? 1 : 0
    );
    Observability.setGauge('status_stream_full', pressure === 'full' ? 1 : 0);
    Observability.setLabeledGauge(
        'stream_length',
        {stream: 'status-telemetry'},
        depth
    );
    if (trimmed > 0) {
        Observability.incrementCounter(
            'status_stream_trimmed_entries_total',
            trimmed
        );
        Observability.incrementCounter('status_stream_trim_events_total');
    }
    if (pressure === lastPressure) return;
    lastPressure = pressure;
    const message =
        'status telemetry pressure=%s depth=%d cap=%d fill=%d%% trimmed=%d';
    const args: [StatusPressure, number, number, number, number] = [
        pressure,
        depth,
        maxlen,
        Math.floor(percent),
        trimmed
    ];
    if (pressure === 'critical' || pressure === 'full') {
        logger.error(message, ...args);
    } else if (pressure === 'warning') {
        logger.warn(message, ...args);
    } else {
        logger.info(message, ...args);
    }
}

export interface AppendStatusBatchInput {
    batch: StatusBatch;
    organizationIds?: readonly string[];
    sourceDevices?: readonly StatusSourceDevice[];
}

function getStream(): RedisStream {
    if (!stream) {
        stream = commandStream('status', tuning.status.streamKey);
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
        sourceDevices: JSON.stringify(input.sourceDevices ?? []),
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

async function appendTracked(
    s: RedisStream,
    fields: Record<string, string>
): Promise<string | null> {
    // The Redis script is atomic but not cancellable. Await its authoritative
    // result so a late commit is never reported as a failure. RedisStream's
    // pending-command guard bounds queued writes during Redis pressure.
    const result = await s.appendAndCountTrim(fields, {
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
    if (result) recordPressure(result.length, result.trimmed);
    return result?.id ?? null;
}

export async function appendStatusBatch(
    input: AppendStatusBatchInput
): Promise<void> {
    const s = getStream();
    const id = await appendTracked(s, statusStreamFields(input));
    // Returning here reported success for a batch that was never written, so
    // the caller acknowledged it and never re-queued. Throw, like the sensor
    // and device-event streams, and let the caller decide to retry or spill.
    if (id === null) {
        Observability.incrementCounter('status_stream_degraded');
        throw new Error('status stream refused the append; batch not stored');
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
        if (isRedisWriteBackpressureError(err)) return;
        logger.error('status stream append failed: %s', err);
    }
}

export async function appendStatusFieldsBestEffort(
    fields: Record<string, string>
): Promise<void> {
    const s = getStream();
    try {
        const id = await appendTracked(s, fields);
        if (id !== null) {
            Observability.incrementCounter('status_overflow_spilled');
            await observeSaturation(s);
        }
    } catch (err) {
        Observability.incrementCounter('status_overflow_spill_errors');
        if (isRedisWriteBackpressureError(err)) return;
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
    lastPressure = 'normal';
}

export function resetForTests(): void {
    stream = undefined;
    drainerStream = undefined;
}
