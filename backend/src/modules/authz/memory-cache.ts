// InMemoryAuthzCache — test-only implementation of AuthzCache.
// Single-process, no network. Use RedisAuthzCache in production.

import log4js from 'log4js';
import type {AuthzCache} from './cache';
import type {
    CachedEffectiveShape,
    EffectiveShape,
    InvalidationHandler
} from './types';

const logger = log4js.getLogger('authz-memory-cache');

interface MemoryShapeEntry extends CachedEffectiveShape {
    expiresAt?: number;
}

export class InMemoryAuthzCache implements AuthzCache {
    readonly #shapes = new Map<string, MemoryShapeEntry>();
    readonly #versions = new Map<string, number>();
    readonly #handlers = new Set<InvalidationHandler>();

    async getEffective(
        userId: string,
        tenantId: string
    ): Promise<CachedEffectiveShape | null> {
        const key = this.#key(tenantId, userId);
        const entry = this.#shapes.get(key);
        if (!entry) return null;
        if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
            this.#shapes.delete(key);
            return null;
        }
        return entry;
    }

    async setEffective(
        userId: string,
        tenantId: string,
        version: number,
        shape: EffectiveShape,
        rolesHash: string,
        ttlSeconds?: number
    ): Promise<void> {
        this.#shapes.set(this.#key(tenantId, userId), {
            version,
            shape,
            cachedAt: Date.now(),
            rolesHash,
            expiresAt:
                ttlSeconds === undefined
                    ? undefined
                    : Date.now() + ttlSeconds * 1000
        });
    }

    async getVersion(tenantId: string): Promise<number> {
        return this.#versions.get(tenantId) ?? 0;
    }

    async seedVersionIfMissing(
        tenantId: string,
        version: number
    ): Promise<number> {
        const existing = this.#versions.get(tenantId);
        if (existing !== undefined) return existing;
        this.#versions.set(tenantId, version);
        return version;
    }

    async invalidate(tenantId: string): Promise<number> {
        const v = (this.#versions.get(tenantId) ?? 0) + 1;
        this.#versions.set(tenantId, v);
        this.#notifyInvalidationHandlers(tenantId, v);
        return v;
    }

    async subscribeInvalidations(
        handler: InvalidationHandler
    ): Promise<() => void> {
        this.#handlers.add(handler);
        return () => {
            this.#handlers.delete(handler);
        };
    }

    async ping(): Promise<boolean> {
        return true;
    }

    async close(): Promise<void> {
        this.#shapes.clear();
        this.#versions.clear();
        this.#handlers.clear();
    }

    #key(tenantId: string, userId: string): string {
        return `${tenantId}:${userId}`;
    }

    #notifyInvalidationHandlers(tenantId: string, version: number): void {
        for (const handler of this.#handlers) {
            try {
                handler(tenantId, version);
            } catch (error) {
                logger.warn('invalidation handler threw: %s', error);
            }
        }
    }
}
