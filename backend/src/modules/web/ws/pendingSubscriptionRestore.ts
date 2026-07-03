// Post-boot one-shot store: subscriber filters captured at shutdown,
// keyed by the session-stream connectionId. When a client reconnects with
// the same connectionId, sessionStreamRegistry consumes its entry and
// reapplies the filter to the new socket.

import * as Observability from '../../Observability';
import type {SubscriberFilter} from './subscriberFilter';

interface PendingEntry {
    filter: SubscriberFilter;
    expiresAt: number;
}

const pending = new Map<string, PendingEntry>();

export interface PendingFilterSeed {
    userId?: string;
    connectionId: string;
    eventTypes?: ReadonlyArray<string>;
    deviceIds?: ReadonlyArray<string>;
}

function pendingKey(userId: string | undefined, connectionId: string): string {
    return `${userId || 'anonymous'}:${connectionId}`;
}

export function loadPendingFilters(
    seeds: ReadonlyArray<PendingFilterSeed>,
    ttlMs: number,
    nowMs: number = Date.now()
): number {
    const sizeBefore = pending.size;
    const expiresAt = nowMs + ttlMs;
    for (const seed of seeds) {
        const filter = buildFilterFromSeed(seed);
        if (filter === null) continue;
        pending.set(pendingKey(seed.userId, seed.connectionId), {
            filter,
            expiresAt
        });
    }
    Observability.setGauge('session_pending_filter_restore', pending.size);
    return pending.size - sizeBefore;
}

export function consumePendingFilter(
    userId: string,
    connectionId: string,
    nowMs: number = Date.now()
): SubscriberFilter | undefined {
    const key = pendingKey(userId, connectionId);
    const entry = pending.get(key);
    if (!entry) return undefined;
    pending.delete(key);
    Observability.setGauge('session_pending_filter_restore', pending.size);
    if (entry.expiresAt < nowMs) {
        Observability.incrementCounter('session_pending_filter_expired');
        return undefined;
    }
    Observability.incrementCounter('session_pending_filter_consumed');
    return entry.filter;
}

export function sweepExpired(nowMs: number = Date.now()): number {
    let dropped = 0;
    for (const [cid, entry] of pending) {
        if (entry.expiresAt < nowMs) {
            pending.delete(cid);
            dropped++;
        }
    }
    if (dropped > 0) {
        Observability.setGauge('session_pending_filter_restore', pending.size);
        Observability.incrementCounter(
            'session_pending_filter_sweep_dropped',
            dropped
        );
    }
    return dropped;
}

export function pendingSize(): number {
    return pending.size;
}

let sweepTimer: NodeJS.Timeout | undefined;

export function startPendingFilterSweep(intervalMs: number): void {
    if (sweepTimer !== undefined) return;
    sweepTimer = setInterval(() => sweepExpired(), intervalMs);
    sweepTimer.unref();
}

export function stopPendingFilterSweep(): void {
    if (sweepTimer === undefined) return;
    clearInterval(sweepTimer);
    sweepTimer = undefined;
}

export function resetPendingForTests(): void {
    pending.clear();
    stopPendingFilterSweep();
}

function buildFilterFromSeed(seed: PendingFilterSeed): SubscriberFilter | null {
    const filter: SubscriberFilter = {};
    if (seed.eventTypes?.length) {
        filter.eventTypes = new Set(seed.eventTypes);
    }
    if (seed.deviceIds?.length) {
        filter.deviceIds = new Set(seed.deviceIds);
    }
    if (!filter.eventTypes && !filter.deviceIds) return null;
    return filter;
}
