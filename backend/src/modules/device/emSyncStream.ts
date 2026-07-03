// Redis-stream buffer in front of Postgres for em-sync writes: the meter-pull
// loop enqueues here, the drainer batches to PG. Mirrors the status overflow
// stream; the idempotent sink makes an at-least-once replay safe.

import log4js from 'log4js';
// Import tuning directly (not the ../../config barrel): the barrel pulls in
// websocketAppender -> ShellyEvents -> ... -> ShellyEmHandler -> here, which
// formed an import cycle. The direct path keeps this module acyclic.
import {tuning} from '../../config/tuning';
import * as Observability from '../Observability';
import {getSharedRedis} from '../redis/RedisClients';
import {RedisStream} from '../redis/RedisStream';
import {rateLimiter} from '../redis/services';
import type {EmSyncBlock} from './emSyncCoalescer';

const logger = log4js.getLogger('em-sync-stream');

const STREAM_KEY = tuning.energy.emSyncStreamKey;
const MAXLEN = tuning.energy.emSyncStreamMaxlen;
const TTL_MS = tuning.energy.emSyncStreamTtlMs;
const SATURATION_CHECK_MS = tuning.energy.emSyncSaturationCheckMs;
const HEALTH_LABEL = 'em-sync-buffer';

let stream: RedisStream | undefined;
let drainerStream: RedisStream | undefined;
let lastSaturationCheckMs = 0;
let lastHealthCheckMs = 0;

function getStream(): RedisStream {
    if (!stream) {
        const {cmd} = getSharedRedis();
        stream = new RedisStream(cmd, STREAM_KEY);
    }
    return stream;
}

function getDrainerStream(): RedisStream {
    if (!drainerStream) {
        const {emSyncBlocking} = getSharedRedis();
        drainerStream = new RedisStream(emSyncBlocking, STREAM_KEY);
    }
    return drainerStream;
}

// At the cap, MAXLEN trims un-drained entries — depth==cap means the drainer is
// behind and data is at risk.
export function isEmSyncSaturated(depth: number, maxlen: number): boolean {
    return maxlen > 0 && depth >= maxlen;
}

async function observeSaturation(s: RedisStream): Promise<void> {
    if (SATURATION_CHECK_MS <= 0) return;
    const now = Date.now();
    if (now - lastSaturationCheckMs < SATURATION_CHECK_MS) return;
    lastSaturationCheckMs = now;
    let depth: number;
    try {
        depth = await s.length();
    } catch (err) {
        logger.debug('em-sync saturation probe failed: %s', err);
        return;
    }
    if (!isEmSyncSaturated(depth, MAXLEN)) return;
    Observability.incrementCounter('em_sync_buffer_saturated');
    logger.warn(
        'em-sync buffer saturated depth=%d cap=%d — drainer behind or Postgres slow; raise FM_EMSYNC_STREAM_MAXLEN or restore throughput',
        depth,
        MAXLEN
    );
}

export async function observeEmSyncStreamHealth(
    group: string,
    minIntervalMs = SATURATION_CHECK_MS
): Promise<void> {
    const now = Date.now();
    if (minIntervalMs > 0 && now - lastHealthCheckMs < minIntervalMs) return;
    lastHealthCheckMs = now;
    const s = getStream();
    try {
        const [depth, oldestAgeMs, pending] = await Promise.all([
            s.length(),
            s.oldestAgeMs(),
            s.pendingSummary(group)
        ]);
        Observability.setLabeledGauge(
            'stream_length',
            {stream: HEALTH_LABEL},
            depth
        );
        Observability.setLabeledGauge(
            'stream_oldest_age_ms',
            {stream: HEALTH_LABEL},
            oldestAgeMs ?? 0
        );
        Observability.setLabeledGauge(
            'stream_pending_entries',
            {stream: HEALTH_LABEL},
            pending.count
        );
    } catch (err) {
        logger.debug('em-sync health probe failed: %s', err);
    }
}

// Returns true when the block is durably buffered. false means rate-limited or
// an enqueue error — the caller leaves its bookmark unadvanced so the block is
// re-pulled next pass (the rollup dedups the replay).
export async function enqueueEmSyncBlock(block: EmSyncBlock): Promise<boolean> {
    const s = getStream();
    try {
        const id = await s.append(
            {block: JSON.stringify(block)},
            {
                maxlen: MAXLEN,
                ttlMs: TTL_MS,
                rateCheck: tuning.redis.rateLimitEnabled
                    ? () =>
                          rateLimiter.consume(
                              `xadd:${STREAM_KEY}`,
                              tuning.redis.rateLimitCapacity,
                              tuning.redis.rateLimitRefillPerSec
                          )
                    : undefined,
                rateLabel: 'em-sync-buffer'
            }
        );
        if (id !== null) {
            Observability.incrementCounter('em_sync_buffer_enqueued');
            await observeSaturation(s);
            await observeEmSyncStreamHealth('em-sync-drainer');
            return true;
        }
        return false;
    } catch (err) {
        Observability.incrementCounter('em_sync_buffer_enqueue_errors');
        logger.error('em-sync buffer enqueue failed: %s', err);
        return false;
    }
}

export function getEmSyncStream(): RedisStream {
    return getStream();
}

export function getEmSyncDrainerStream(): RedisStream {
    return getDrainerStream();
}
