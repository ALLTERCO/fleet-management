// Stream-backed DLQ for audit entries that overflow the in-memory queue.
import log4js from 'log4js';
import {tuning} from '../../config';
import type {AuditLogEntry} from '../AuditLogger';
import * as Observability from '../Observability';
import {isRedisWriteBackpressureError} from '../redis/commandBackpressure';
import type {RedisStream} from '../redis/RedisStream';
import {rateLimiter} from '../redis/services';
import {blockingStream, commandStream} from '../redis/streamClients';

const logger = log4js.getLogger('audit-overflow');

let stream: RedisStream | undefined;
let drainerStream: RedisStream | undefined;
let lastSaturationCheckMs = 0;

// Accepted audit entries are never trimmed. At the configured capacity, a new
// spill is rejected loudly while every older accepted entry remains intact.
async function observeSaturation(s: RedisStream): Promise<void> {
    const interval = tuning.audit.overflowSaturationCheckMs;
    if (interval <= 0) return;
    const now = Date.now();
    if (now - lastSaturationCheckMs < interval) return;
    lastSaturationCheckMs = now;
    // Self-contained: a probe failure must not be miscounted as a spill error
    // by the caller's catch (the spill already succeeded).
    let depth: number;
    try {
        depth = await s.length();
    } catch (err) {
        logger.debug('audit overflow saturation probe failed: %s', err);
        return;
    }
    if (depth < tuning.audit.overflowMaxlen) return;
    Observability.incrementCounter('audit_overflow_saturated');
    logger.warn(
        'audit overflow DLQ saturated depth=%d cap=%d — new spills are ' +
            'rejected without trimming accepted audit entries; restore ' +
            'Postgres throughput',
        depth,
        tuning.audit.overflowMaxlen
    );
}

export function resetSaturationStateForTests(): void {
    lastSaturationCheckMs = 0;
}

// In-flight spill tracker. fire-and-forget callers add their promise here so
// shutdown can wait for all pending stream writes to land before Redis quits.
const inFlight = new Set<Promise<boolean>>();

function getStream(): RedisStream {
    if (!stream) {
        stream = commandStream('audit', tuning.audit.overflowStreamKey);
    }
    return stream;
}

function getDrainerStream(): RedisStream {
    if (!drainerStream) {
        drainerStream = blockingStream('audit', tuning.audit.overflowStreamKey);
    }
    return drainerStream;
}

// Resolves true once the entry is in the stream; never rejects.
export async function spillAuditEntry(entry: AuditLogEntry): Promise<boolean> {
    const work = (async (): Promise<boolean> => {
        try {
            const id = await getStream().appendIfBelowCap(
                {entry: JSON.stringify(entry)},
                {
                    cap: tuning.audit.overflowMaxlen,
                    ttlMs: tuning.audit.overflowTtlMs,
                    rateCheck: tuning.redis.rateLimitEnabled
                        ? () =>
                              rateLimiter.consume(
                                  `xadd:${tuning.audit.overflowStreamKey}`,
                                  tuning.redis.rateLimitCapacity,
                                  tuning.redis.rateLimitRefillPerSec
                              )
                        : undefined,
                    rateLabel: 'audit-overflow'
                }
            );
            if (id !== null) {
                Observability.incrementCounter('audit_overflow_spilled');
                await observeSaturation(getStream());
                return true;
            }
            const atCapacity =
                (await getStream().length()) >= tuning.audit.overflowMaxlen;
            if (atCapacity) {
                Observability.incrementCounter(
                    'audit_overflow_capacity_rejected_total'
                );
            }
            await observeSaturation(getStream());
            throw new Error(
                atCapacity
                    ? `audit overflow stream at capacity (${tuning.audit.overflowMaxlen})`
                    : 'audit overflow stream append was rate-limited'
            );
        } catch (err) {
            // Stream itself is down — last-resort loud log.
            Observability.incrementCounter('audit_overflow_spill_errors');
            if (isRedisWriteBackpressureError(err)) return false;
            logger.error('audit spill failed: %s', err);
            return false;
        }
    })();
    inFlight.add(work);
    work.finally(() => inFlight.delete(work));
    return work;
}

// Awaited at shutdown so fire-and-forget spillers don't lose entries when
// Redis disconnects. Bounded by Promise.allSettled (errors already handled).
export async function awaitInflightSpills(): Promise<void> {
    if (inFlight.size === 0) return;
    await Promise.allSettled([...inFlight]);
}

export function getOverflowStream(): RedisStream {
    return getStream();
}

export function getOverflowDrainerStream(): RedisStream {
    return getDrainerStream();
}

export function resetForTests(): void {
    stream = undefined;
    drainerStream = undefined;
}
