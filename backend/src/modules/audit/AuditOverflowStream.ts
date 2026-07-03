// Stream-backed DLQ for audit entries that overflow the in-memory queue.
import log4js from 'log4js';
import {tuning} from '../../config';
import type {AuditLogEntry} from '../AuditLogger';
import * as Observability from '../Observability';
import {getSharedRedis} from '../redis/RedisClients';
import {RedisStream} from '../redis/RedisStream';
import {rateLimiter} from '../redis/services';

const logger = log4js.getLogger('audit-overflow');

let stream: RedisStream | undefined;
let drainerStream: RedisStream | undefined;
let lastSaturationCheckMs = 0;

// Approximate MAXLEN (~) silently drops the oldest un-acked entries once the
// backlog hits the cap, so probe XLEN (O(1), time-throttled) and surface
// saturation as a loud counter + warn instead of losing audit rows silently.
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
        'audit overflow DLQ saturated depth=%d cap=%d — approximate ' +
            'MAXLEN may trim oldest un-drained audit entries; raise ' +
            'FM_AUDIT_OVERFLOW_MAXLEN or restore Postgres throughput',
        depth,
        tuning.audit.overflowMaxlen
    );
}

export function resetSaturationStateForTests(): void {
    lastSaturationCheckMs = 0;
}

// In-flight spill tracker. fire-and-forget callers add their promise here so
// shutdown can wait for all pending stream writes to land before Redis quits.
const inFlight = new Set<Promise<void>>();

function getStream(): RedisStream {
    if (!stream) {
        const {cmd} = getSharedRedis();
        stream = new RedisStream(cmd, tuning.audit.overflowStreamKey);
    }
    return stream;
}

function getDrainerStream(): RedisStream {
    if (!drainerStream) {
        const {auditBlocking} = getSharedRedis();
        drainerStream = new RedisStream(
            auditBlocking,
            tuning.audit.overflowStreamKey
        );
    }
    return drainerStream;
}

export async function spillAuditEntry(entry: AuditLogEntry): Promise<void> {
    const work = (async () => {
        try {
            const id = await getStream().append(
                {entry: JSON.stringify(entry)},
                {
                    maxlen: tuning.audit.overflowMaxlen,
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
            }
        } catch (err) {
            // Stream itself is down — last-resort loud log.
            Observability.incrementCounter('audit_overflow_spill_errors');
            logger.error('audit spill failed: %s', err);
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
