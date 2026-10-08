// Redis push buffer in front of Postgres for pushed meter records: the push
// handler enqueues here, the drainer batches to PG. History pulls never come
// here; they write to PG directly. The buffer is bounded in bytes, so a burst
// of pushes cannot fill Redis; a refused push is filled by the next pull.
// Pushes close together share one Redis call (see emSyncPushBatch).

import log4js from 'log4js';
// Import tuning directly (not the ../../config barrel): the barrel pulls in
// websocketAppender -> ShellyEvents -> ... -> ShellyEmHandler -> here, which
// formed an import cycle. The direct path keeps this module acyclic.
import {tuning} from '../../config/tuning';
import * as Observability from '../Observability';
import {isRedisWriteBackpressureError} from '../redis/commandBackpressure';
import type {
    ByteBudgetGroup,
    ByteBudgetGroupOptions,
    ByteLedgerKeys,
    RedisStream
} from '../redis/RedisStream';
import {rateLimiter} from '../redis/services';
import {blockingStream, commandStream} from '../redis/streamClients';
import type {EmSyncBlock} from './emSyncCoalescer';
import {EmSyncPushBatcher} from './emSyncPushBatch';
import {
    type EmSyncRecordPush,
    encodeEmSyncRecordPush,
    parseEmSyncKeyset
} from './emSyncRecordEntry';

const logger = log4js.getLogger('em-sync-stream');

const STREAM_KEY = tuning.energy.emSyncStreamKey;
const BYTE_LEDGER: ByteLedgerKeys = {
    ledgerKey: `${STREAM_KEY}:ledger`,
    bytesKey: `${STREAM_KEY}:bytes`,
    sharedKey: `${STREAM_KEY}:keysets`
};
const MAXLEN = tuning.energy.emSyncStreamMaxlen;
const MAX_BYTES = tuning.energy.emSyncStreamMaxBytes;
const TTL_MS = tuning.energy.emSyncStreamTtlMs;
const SATURATION_CHECK_MS = tuning.energy.emSyncSaturationCheckMs;
const HEALTH_LABEL = 'em-sync-buffer';

let stream: RedisStream | undefined;
let drainerStream: RedisStream | undefined;
let pushBatcher: EmSyncPushBatcher | undefined;
let lastSaturationCheckMs = 0;
let lastHealthCheckMs = 0;

export interface EmSyncBufferPressure {
    bytes: number;
    depth: number;
    oldestAgeMs: number | null;
}

export type EmSyncPullPauseReason = 'bytes' | 'age';

export interface EmSyncPullPauseLimits {
    pauseBytes: number;
    maxAgeMs: number;
}

function getStream(): RedisStream {
    if (!stream) {
        stream = commandStream('em-sync', STREAM_KEY, {
            byteLedger: BYTE_LEDGER
        });
    }
    return stream;
}

function getDrainerStream(): RedisStream {
    if (!drainerStream) {
        drainerStream = blockingStream('em-sync', STREAM_KEY, {
            byteLedger: BYTE_LEDGER
        });
    }
    return drainerStream;
}

// The producer uses a lossless hard cap: at capacity the append is refused
// and nothing already buffered is trimmed.
export function isEmSyncSaturated(used: number, cap: number): boolean {
    return cap > 0 && used >= cap;
}

// Bytes at which history pulls give the database to the push drainer.
export function emSyncPullPauseBytes(
    maxBytes = MAX_BYTES,
    highWaterPct = tuning.energy.emSyncCatchupHighWaterPct
): number {
    return Math.floor((maxBytes * highWaterPct) / 100);
}

const DEFAULT_PAUSE_LIMITS: EmSyncPullPauseLimits = {
    pauseBytes: emSyncPullPauseBytes(),
    maxAgeMs: tuning.energy.emSyncPullPauseAgeMs
};

// Fresh data first: pulls wait while pushes queue up in bytes or in age.
export function emSyncPullPauseReason(
    pressure: EmSyncBufferPressure,
    limits: EmSyncPullPauseLimits = DEFAULT_PAUSE_LIMITS
): EmSyncPullPauseReason | null {
    if (pressure.bytes >= limits.pauseBytes) return 'bytes';
    if ((pressure.oldestAgeMs ?? 0) >= limits.maxAgeMs) return 'age';
    return null;
}

export async function readEmSyncBufferPressure(): Promise<EmSyncBufferPressure> {
    const s = getStream();
    const [bytes, depth, oldestAgeMs] = await Promise.all([
        s.accountedBytes(),
        s.length(),
        s.oldestAgeMs()
    ]);
    return {bytes, depth, oldestAgeMs};
}

// Key lists the given record entries refer to. A missing or malformed one is
// left out, so its entries cannot be expanded and count as poison.
export async function readEmSyncKeysets(
    ids: readonly string[]
): Promise<Map<string, string[]>> {
    const keysets = new Map<string, string[]>();
    if (ids.length === 0) return keysets;
    const values = await getDrainerStream().sharedValues(ids);
    ids.forEach((id, i) => {
        const keys = parseEmSyncKeyset(values[i] ?? null);
        if (keys) keysets.set(id, keys);
    });
    return keysets;
}

async function observeSaturation(s: RedisStream): Promise<void> {
    if (SATURATION_CHECK_MS <= 0) return;
    const now = Date.now();
    if (now - lastSaturationCheckMs < SATURATION_CHECK_MS) return;
    lastSaturationCheckMs = now;
    let bytes: number;
    try {
        bytes = await s.accountedBytes();
    } catch (err) {
        logger.debug('em-sync saturation probe failed: %s', err);
        return;
    }
    if (!isEmSyncSaturated(bytes, emSyncPullPauseBytes())) return;
    Observability.incrementCounter('em_sync_buffer_saturated');
    logger.warn(
        'em-sync push buffer high bytes=%d budget=%d: history pulls pause; restore drainer/Postgres throughput',
        bytes,
        MAX_BYTES
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
        const [pressure, pending] = await Promise.all([
            readEmSyncBufferPressure(),
            s.pendingSummary(group)
        ]);
        Observability.setLabeledGauge(
            'stream_length',
            {stream: HEALTH_LABEL},
            pressure.depth
        );
        Observability.setLabeledGauge(
            'stream_oldest_age_ms',
            {stream: HEALTH_LABEL},
            pressure.oldestAgeMs ?? 0
        );
        Observability.setLabeledGauge(
            'stream_pending_entries',
            {stream: HEALTH_LABEL},
            pending.count
        );
        Observability.setGauge('em_sync_buffer_bytes', pressure.bytes);
    } catch (err) {
        logger.debug('em-sync health probe failed: %s', err);
    }
}

function isValidEmSyncCursor(cursor: EmSyncBlock['cursor']): boolean {
    return (
        Number.isSafeInteger(cursor.device) &&
        cursor.device > 0 &&
        Number.isSafeInteger(cursor.channel) &&
        cursor.channel >= 0 &&
        Number.isSafeInteger(cursor.created) &&
        cursor.created >= 0
    );
}

function getPushBatcher(): EmSyncPushBatcher {
    if (!pushBatcher) {
        pushBatcher = new EmSyncPushBatcher({
            lingerMs: tuning.energy.emSyncPushBatchMs,
            maxEntries: tuning.energy.emSyncPushBatchMaxEntries,
            append: appendWithinBudget
        });
    }
    return pushBatcher;
}

// One entry per record; the push is admitted whole or refused whole.
export async function enqueueEmSyncRecords(
    push: EmSyncRecordPush
): Promise<boolean> {
    const encoded = encodeEmSyncRecordPush(push);
    if (encoded.entries.length === 0) return true;
    return getPushBatcher().add({
        entries: encoded.entries,
        shared: {field: encoded.keyset.id, value: encoded.keyset.value}
    });
}

// A block of rows: a rejected block queued again on purpose.
export async function enqueueEmSyncBlock(block: EmSyncBlock): Promise<boolean> {
    if (!isValidEmSyncCursor(block.cursor)) {
        Observability.incrementCounter('em_sync_buffer_invalid_cursors');
        logger.error(
            'em-sync buffer rejected invalid cursor device=%s channel=%s created=%s',
            block.cursor.device,
            block.cursor.channel,
            block.cursor.created
        );
        return false;
    }
    const [stored] = await appendWithinBudget([
        {entries: [{block: JSON.stringify(block)}]}
    ]);
    return stored;
}

// One Redis call; per group, true only when every entry of it was stored.
async function appendWithinBudget(
    groups: ByteBudgetGroup[]
): Promise<boolean[]> {
    const s = getStream();
    try {
        const results = await s.appendGroupsWithinByteBudget(
            groups,
            budgetOptions()
        );
        const stored = results.filter((ids) => ids !== null).length;
        Observability.incrementCounter('em_sync_push_batches');
        Observability.incrementCounter('em_sync_buffer_enqueued', stored);
        Observability.incrementCounter(
            'em_sync_buffer_capacity_rejected',
            groups.length - stored
        );
        await observeSaturation(s);
        await observeEmSyncStreamHealth('em-sync-drainer');
        return results.map((ids) => ids !== null);
    } catch (err) {
        Observability.incrementCounter('em_sync_buffer_enqueue_errors');
        if (!isRedisWriteBackpressureError(err)) {
            logger.error('em-sync buffer enqueue failed: %s', err);
        }
        return groups.map(() => false);
    }
}

function budgetOptions(): ByteBudgetGroupOptions {
    return {
        budgetBytes: MAX_BYTES,
        cap: MAXLEN,
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
    };
}

export function getEmSyncStream(): RedisStream {
    return getStream();
}

export function getEmSyncDrainerStream(): RedisStream {
    return getDrainerStream();
}
