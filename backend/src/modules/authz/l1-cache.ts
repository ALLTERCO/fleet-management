// In-process LRU cache of authz decisions.

import type {AuthzCache} from './cache';
import type {AuthzConfig} from './config';

interface L1Entry {
    decision: boolean;
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

    get(
        tenantId: string,
        userId: string,
        action: string,
        resourceType: string,
        resourceId: string | number,
        contextKey: string
    ): boolean | undefined {
        const key = this.#key(
            tenantId,
            userId,
            action,
            resourceType,
            resourceId,
            contextKey
        );
        const entry = this.#map.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt < Date.now()) {
            this.#map.delete(key);
            return undefined;
        }
        // Re-insert to refresh LRU order.
        this.#map.delete(key);
        this.#map.set(key, entry);
        return entry.decision;
    }

    set(
        tenantId: string,
        userId: string,
        action: string,
        resourceType: string,
        resourceId: string | number,
        decision: boolean,
        contextKey: string
    ): void {
        const key = this.#key(
            tenantId,
            userId,
            action,
            resourceType,
            resourceId,
            contextKey
        );
        if (this.#map.size >= this.#maxEntries && !this.#map.has(key)) {
            // Map iteration order = insertion → first key is oldest. O(1) eviction.
            const firstKey = this.#map.keys().next().value;
            if (firstKey !== undefined) this.#map.delete(firstKey);
        }
        this.#map.set(key, {
            decision,
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

    #key(
        tenantId: string,
        userId: string,
        action: string,
        resourceType: string,
        resourceId: string | number,
        contextKey: string
    ): string {
        return `${tenantId}|${userId}|${action}|${resourceType}|${resourceId}|${contextKey}`;
    }
}
