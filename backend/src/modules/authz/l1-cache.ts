// In-process LRU cache of authz decisions.

import type {AuthzCache} from './cache';
import type {AuthzConfig} from './config';

// One decision: who did what to which resource, under which request context.
export interface L1DecisionKey {
    tenantId: string;
    userId: string;
    action: string;
    resourceType: string;
    resourceId: string | number;
    contextKey: string;
}

// A decision also depends on the resource's place, groups and tags, which the
// org access version stamps; a decision from older membership data is a miss.
export interface L1Decision {
    decision: boolean;
    accessVersion: number;
}

interface L1Entry extends L1Decision {
    expiresAt: number;
}

export class L1AuthzCache {
    readonly #map = new Map<string, L1Entry>();
    readonly #maxEntries: number;
    readonly #ttlMs: number;
    #unsubscribe?: () => void;

    constructor(cfg: AuthzConfig) {
        this.#maxEntries = cfg.l1MaxEntries;
        this.#ttlMs = cfg.l1TtlSeconds * 1000;
    }

    get(key: L1DecisionKey, accessVersion: number): boolean | undefined {
        const mapKey = this.#key(key);
        const entry = this.#map.get(mapKey);
        if (!entry) return undefined;
        if (
            entry.expiresAt < Date.now() ||
            entry.accessVersion !== accessVersion
        ) {
            this.#map.delete(mapKey);
            return undefined;
        }
        // Re-insert to refresh LRU order.
        this.#map.delete(mapKey);
        this.#map.set(mapKey, entry);
        return entry.decision;
    }

    set(key: L1DecisionKey, value: L1Decision): void {
        const mapKey = this.#key(key);
        if (this.#map.size >= this.#maxEntries && !this.#map.has(mapKey)) {
            // Map iteration order = insertion → first key is oldest. O(1) eviction.
            const firstKey = this.#map.keys().next().value;
            if (firstKey !== undefined) this.#map.delete(firstKey);
        }
        this.#map.set(mapKey, {
            ...value,
            expiresAt: Date.now() + this.#ttlMs
        });
    }

    invalidateUser(userId: string): number {
        let dropped = 0;
        for (const k of this.#map.keys()) {
            const parts = k.split('|', 2);
            if (parts[1] === userId) {
                this.#map.delete(k);
                dropped++;
            }
        }
        return dropped;
    }

    invalidateTenant(tenantId: string): number {
        let dropped = 0;
        const prefix = `${tenantId}|`;
        for (const k of this.#map.keys()) {
            if (k.startsWith(prefix)) {
                this.#map.delete(k);
                dropped++;
            }
        }
        return dropped;
    }

    async wireInvalidation(cache: AuthzCache): Promise<void> {
        this.#unsubscribe = await cache.subscribeInvalidations(
            (tenantId, _version) => {
                this.invalidateTenant(tenantId);
            }
        );
    }

    size(): number {
        return this.#map.size;
    }

    clear(): void {
        this.#map.clear();
    }

    close(): void {
        this.#unsubscribe?.();
        this.#unsubscribe = undefined;
        this.#map.clear();
    }

    #key(key: L1DecisionKey): string {
        return `${key.tenantId}|${key.userId}|${key.action}|${key.resourceType}|${key.resourceId}|${key.contextKey}`;
    }
}
