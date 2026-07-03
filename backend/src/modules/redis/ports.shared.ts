// Pure helpers shared between the Redis adapter and the back-compat
// shims. Anything stateless that callers AND adapter both need lives
// here so there's exactly one implementation.

import {createHash} from 'node:crypto';
import {tuning} from '../../config';
import type {EventReplayCacheParams} from './ports';
import {getSharedRedis} from './RedisClients';
import {RedisStream} from './RedisStream';

// ── EventReplay cache helpers ───────────────────────────────────────────

export function eventReplayCacheKey(
    orgId: string,
    p: EventReplayCacheParams
): string {
    const types = p.eventTypes?.length
        ? [...p.eventTypes].sort().join(',')
        : '';
    return `${tuning.device.eventReplayCacheKeyPrefix}:${orgId}:${p.from}:${p.to}:${types}:${p.maxDevices}`;
}

export function isHistoricalWindow(
    toIso: string,
    nowMs: number = Date.now()
): boolean {
    const toMs = Date.parse(toIso);
    if (!Number.isFinite(toMs)) return false;
    return toMs < nowMs - tuning.device.eventReplayCacheImmutableLagSec * 1000;
}

// ── Device-ingest lane registry ─────────────────────────────────────────

const lanes = new Map<number, RedisStream>();

export function laneCount(): number {
    return tuning.ingest.lanes;
}

export function laneIndexFor(shellyID: string): number {
    const total = tuning.ingest.lanes;
    const digest = createHash('sha1').update(shellyID).digest();
    return digest.readUInt32BE(0) % total;
}

export function getLane(index: number): RedisStream {
    let stream = lanes.get(index);
    if (!stream) {
        const {cmd} = getSharedRedis();
        const key = `${tuning.ingest.streamPrefix}:${index}`;
        stream = new RedisStream(cmd, key);
        lanes.set(index, stream);
    }
    return stream;
}

/** Test-only — clear the lane registry between cases. */
export function resetLaneRegistryForTests(): void {
    lanes.clear();
}
