import {getLogger} from 'log4js';
import * as Observability from '../Observability';
import type {PendingEntry, PendingEvictionReason} from './types';

const logger = getLogger('waiting-room');

interface Node {
    key: string;
    prev?: Node;
    next?: Node;
}

export interface BoundedPendingMapOptions {
    max: number;
    ttlMs: number;
    sweepMs: number;
    onEvict?: (shellyID: string, reason: PendingEvictionReason) => void;
    now?: () => number;
}

export class BoundedPendingMap {
    private readonly max: number;
    private readonly ttlMs: number;
    private readonly onEvict?: (
        shellyID: string,
        reason: PendingEvictionReason
    ) => void;
    private readonly now: () => number;
    private readonly entries = new Map<string, PendingEntry>();
    private readonly nodes = new Map<string, Node>();
    private head?: Node;
    private tail?: Node;
    private sweepTimer?: ReturnType<typeof setInterval>;

    constructor(opts: BoundedPendingMapOptions) {
        this.max = Math.max(1, opts.max);
        this.ttlMs = Math.max(1, opts.ttlMs);
        this.onEvict = opts.onEvict;
        this.now = opts.now ?? Date.now;

        if (opts.sweepMs > 0) {
            this.sweepTimer = setInterval(
                () => this.sweepExpired(),
                opts.sweepMs
            );
            this.sweepTimer.unref?.();
        }
    }

    set(shellyID: string, entry: PendingEntry): void {
        const existing = this.entries.get(shellyID);
        const now = this.now();
        const nextEntry = {
            ...entry,
            touchedAt: now
        };

        if (existing) {
            // Replace semantics match AWS IoT / Azure IoT, but the previous
            // entry's onEvict must run so the old socket gets closed cleanly,
            // and observers are notified.
            try {
                existing.onEvict();
            } catch (err) {
                // Must not throw through set, but never vanish either.
                logEvictFailure(shellyID, 'duplicate', err);
            }
            this.onEvict?.(shellyID, 'duplicate');
            this.entries.set(shellyID, nextEntry);
            this.touch(shellyID);
            return;
        }

        while (this.entries.size >= this.max) {
            const oldest = this.head?.key;
            if (!oldest) break;
            this.evict(oldest, 'lru');
        }

        this.entries.set(shellyID, nextEntry);
        this.append(shellyID);
    }

    get(shellyID: string): PendingEntry | undefined {
        const entry = this.entries.get(shellyID);
        if (!entry) return undefined;
        if (this.isExpired(entry)) {
            this.evict(shellyID, 'ttl');
            return undefined;
        }
        entry.touchedAt = this.now();
        this.touch(shellyID);
        return entry;
    }

    delete(shellyID: string): boolean {
        const existed = this.entries.delete(shellyID);
        if (existed) this.unlink(shellyID);
        return existed;
    }

    take(shellyID: string): PendingEntry | undefined {
        const entry = this.entries.get(shellyID);
        if (!entry) return undefined;
        this.entries.delete(shellyID);
        this.unlink(shellyID);
        return entry;
    }

    size(): number {
        return this.entries.size;
    }

    stop(): void {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = undefined;
        }
        this.entries.clear();
        this.nodes.clear();
        this.head = undefined;
        this.tail = undefined;
    }

    private sweepExpired(): void {
        const expired: string[] = [];
        for (const [key, entry] of this.entries) {
            if (this.isExpired(entry)) expired.push(key);
        }
        for (const key of expired) this.evict(key, 'ttl');
    }

    private isExpired(entry: PendingEntry): boolean {
        return this.now() - entry.touchedAt >= this.ttlMs;
    }

    private evict(shellyID: string, reason: PendingEvictionReason): void {
        const entry = this.entries.get(shellyID);
        if (!entry) return;
        this.entries.delete(shellyID);
        this.unlink(shellyID);
        try {
            // Eviction = drop from queue + close ws; do NOT rewrite device
            // config (that's the explicit-denial path).
            entry.onEvict();
        } catch (err) {
            // Must not throw through add/list/sweep, but never vanish either.
            logEvictFailure(shellyID, reason, err);
        } finally {
            this.onEvict?.(shellyID, reason);
        }
    }

    private append(key: string): void {
        const node: Node = {key};
        this.nodes.set(key, node);
        if (!this.tail) {
            this.head = node;
            this.tail = node;
            return;
        }
        node.prev = this.tail;
        this.tail.next = node;
        this.tail = node;
    }

    private touch(key: string): void {
        const node = this.nodes.get(key);
        if (!node || node === this.tail) return;
        this.unlink(key);
        this.append(key);
    }

    private unlink(key: string): void {
        const node = this.nodes.get(key);
        if (!node) return;
        if (node.prev) node.prev.next = node.next;
        if (node.next) node.next.prev = node.prev;
        if (this.head === node) this.head = node.next;
        if (this.tail === node) this.tail = node.prev;
        this.nodes.delete(key);
    }
}

function logEvictFailure(
    shellyID: string,
    reason: PendingEvictionReason | 'duplicate',
    err: unknown
): void {
    Observability.incrementCounter('waiting_room_evict_close_errors');
    logger.warn(
        'pending evict close failed %s (%s): %s',
        shellyID,
        reason,
        err
    );
}
