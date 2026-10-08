import log4js from 'log4js';
import {tuning} from '../../config';
import * as Observability from '../Observability';
import type {RedisStream} from '../redis/RedisStream';
import {rateLimiter} from '../redis/services';
import {blockingStream, commandStream} from '../redis/streamClients';
import type {EventRow, NumericRow} from '../sensorCapture';

const logger = log4js.getLogger('sensor-capture-stream');
export const SENSOR_CAPTURE_STREAM_SCHEMA = 'sensor-capture-v1';
export const SENSOR_CAPTURE_STREAM_SCHEMA_V2 = 'sensor-capture-v2';

let stream: RedisStream | undefined;
let drainerStream: RedisStream | undefined;
let lastSaturationCheckMs = 0;

export interface SensorCaptureBatch {
    numeric: NumericRow[];
    events: EventRow[];
}

export interface IdentifiedSensorCaptureBatch extends SensorCaptureBatch {
    batchId: string;
}

function getStream(): RedisStream {
    if (!stream) {
        stream = commandStream(
            'sensor-capture',
            tuning.sensorCapture.streamKey
        );
    }
    return stream;
}

function getDrainerStream(): RedisStream {
    if (!drainerStream) {
        drainerStream = blockingStream(
            'sensor-capture',
            tuning.sensorCapture.streamKey
        );
    }
    return drainerStream;
}

async function observeSaturation(current: RedisStream): Promise<void> {
    const interval = tuning.sensorCapture.streamSaturationCheckMs;
    if (interval <= 0) return;
    const now = Date.now();
    if (now - lastSaturationCheckMs < interval) return;
    lastSaturationCheckMs = now;
    let depth: number;
    try {
        depth = await current.length();
    } catch (error) {
        logger.debug(
            'sensor-capture saturation probe failed after append: %s',
            error instanceof Error ? error.message : String(error)
        );
        return;
    }
    Observability.setLabeledGauge(
        'stream_length',
        {stream: 'sensor-capture'},
        depth
    );
    if (depth < tuning.sensorCapture.streamMaxlen) return;
    Observability.incrementCounter('sensor_capture_stream_saturated');
    logger.error(
        'sensor-capture stream saturated depth=%d cap=%d — accepted history remains queued; restore drainer throughput',
        depth,
        tuning.sensorCapture.streamMaxlen
    );
}

export async function appendSensorCaptureBatch(
    batch: IdentifiedSensorCaptureBatch
): Promise<void> {
    if (batch.numeric.length === 0 && batch.events.length === 0) return;
    const current = getStream();
    const id = await current.appendIfBelowCap(
        {
            schema: SENSOR_CAPTURE_STREAM_SCHEMA_V2,
            batchId: batch.batchId,
            numeric: JSON.stringify(batch.numeric),
            events: JSON.stringify(batch.events),
            createdAt: new Date().toISOString()
        },
        {
            cap: tuning.sensorCapture.streamMaxlen,
            ttlMs: tuning.sensorCapture.streamTtlMs,
            rateCheck: tuning.redis.rateLimitEnabled
                ? () =>
                      rateLimiter.consume(
                          `xadd:${tuning.sensorCapture.streamKey}`,
                          tuning.redis.rateLimitCapacity,
                          tuning.redis.rateLimitRefillPerSec
                      )
                : undefined,
            rateLabel: 'sensor_capture'
        }
    );
    if (id === null) {
        Observability.incrementCounter(
            'sensor_capture_stream_capacity_rejected_total'
        );
        throw new Error(
            `sensor-capture stream at capacity (${tuning.sensorCapture.streamMaxlen})`
        );
    }
    Observability.incrementCounter('sensor_capture_stream_appends');
    Observability.incrementCounter(
        'sensor_capture_rows_accepted_total',
        batch.numeric.length + batch.events.length
    );
    await observeSaturation(current);
}

export function getSensorCaptureDrainerStream(): RedisStream {
    return getDrainerStream();
}

export function resetSensorCaptureStreamForTests(): void {
    stream = undefined;
    drainerStream = undefined;
    lastSaturationCheckMs = 0;
}
