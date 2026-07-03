// L2 effective-permissions cache interface.
// RedisAuthzCache (production) and InMemoryAuthzCache (test-only) implement this.

import type {
    CachedEffectiveShape,
    EffectiveShape,
    InvalidationHandler
} from './types';

export interface AuthzCache {
    getEffective(
        userId: string,
        tenantId: string
    ): Promise<CachedEffectiveShape | null>;

    setEffective(
        userId: string,
        tenantId: string,
        version: number,
        shape: EffectiveShape,
        rolesHash: string,
        ttlSeconds?: number
    ): Promise<void>;

    // Version counter — single source of truth in Redis. Postgres
    // organizations.authz_version is durable shadow only.
    getVersion(tenantId: string): Promise<number>;

    // Set the version atomically iff the key is missing, returning the
    // value present after the call. Used to seed the counter from the
    // durable shadow on Redis flush so stale L2 entries are invalidated.
    seedVersionIfMissing(tenantId: string, version: number): Promise<number>;

    // Atomic INCR + PUBLISH; returns new version.
    invalidate(tenantId: string): Promise<number>;

    // Pub/sub for cross-instance L1 invalidation. Returns unsubscribe.
    subscribeInvalidations(handler: InvalidationHandler): Promise<() => void>;

    ping(): Promise<boolean>;

    close(): Promise<void>;
}
