// Lazy-init singleton holding resolver dependencies (Redis cache + Postgres DB).
// Heavy modules (db.ts, redis-cache.ts) load via dynamic import at init time so
// importing the runtime accessors does not pull in Postgres or ioredis at
// module-load — keeps callers (CommandSender) import-light.

import log4js from 'log4js';

import {envInt} from '../../config/envReader';
import {stripUrlUserinfo} from '../../config/redact';
import {bumpOrganizationAccessVersion} from '../organizationCacheVersions';
import {registerAuthzTenantCacheInvalidator} from './invalidation';
import {
    __setAuthzRuntimeForTests,
    type AuthzRuntime,
    setAuthzRuntime,
    tryGetAuthzRuntime
} from './runtimeHandle';

export type {AuthzRuntime};
export {__setAuthzRuntimeForTests, tryGetAuthzRuntime};

const logger = log4js.getLogger('authz-runtime');

const INIT_RETRY_INTERVAL_MS = envInt('FM_AUTHZ_INIT_RETRY_MS', 30_000, 1000);

export interface AuthzRuntimeStatus {
    initialized: boolean;
    redis: boolean;
    l1Size: number;
}

let initRetryTimer: ReturnType<typeof setInterval> | null = null;

registerAuthzTenantCacheInvalidator(invalidateAuthzTenantCache);

// Idempotent. Self-heals on Redis recovery; rebuilds shapes on live sessions.
export async function initAuthzRuntime(): Promise<void> {
    if (tryGetAuthzRuntime()) return;
    try {
        const [
            {loadAuthzConfig},
            {RedisAuthzCache},
            {InMemoryAuthzCache},
            {initSharedRedis, getSharedRedis},
            {tuning},
            {PostgresResolverDb},
            {L1AuthzCache}
        ] = await Promise.all([
            import('./config.js'),
            import('./redis-cache.js'),
            import('./memory-cache.js'),
            import('../redis/RedisClients.js'),
            import('../../config/index.js'),
            import('./db.js'),
            import('./l1-cache.js')
        ]);
        const cfg = loadAuthzConfig();
        let cache: import('./cache').AuthzCache;
        if (tuning.redis.disabled) {
            // Boot-time selection — null-equivalent adapter; same
            // interface, Postgres source-of-truth lookups every time.
            cache = new InMemoryAuthzCache();
        } else {
            // Idempotent — app.ts boot also calls this.
            initSharedRedis({url: tuning.redis.url});
            const redisCache = new RedisAuthzCache(cfg, getSharedRedis());
            if (!(await redisCache.ping())) {
                await redisCache.close();
                throw new Error('redis ping failed');
            }
            cache = redisCache;
        }
        const db = new PostgresResolverDb();
        const l1 = new L1AuthzCache(cfg);
        await l1.wireInvalidation(cache);
        const unsubscribeWsInvalidation = await cache.subscribeInvalidations(
            (tenantId) => {
                // Mirror invalidateAuthzTenant's local-process side effects on
                // every peer instance so the shared group cache + sender shapes
                // drop on the same hop as L1/L2.
                bumpOrganizationAccessVersion(tenantId);
                void import('../web/ws/ConnectionContext.js')
                    .then(({ConnectionContext}) => {
                        ConnectionContext.invalidateTenant(tenantId);
                    })
                    .catch((err) => {
                        logger.warn('ws authz invalidation failed: %s', err);
                    });
            }
        );
        setAuthzRuntime({cache, db, l1, unsubscribeWsInvalidation});
        const {registerModule} = await import('../Observability.js');
        registerModule('authz', {
            stats: () => ({
                initialized: true,
                l1Size: l1.size()
            }),
            topology: {
                role: 'service',
                cluster: 'security',
                upstreams: ['auth'],
                downstreams: ['commander'],
                label: 'Authz',
                description: 'Authorization runtime + L1 cache',
                route: '/monitoring/services'
            }
        });
        logger.info(
            'authz runtime initialised (redis=%s)',
            stripUrlUserinfo(cfg.redisUrl)
        );
        if (initRetryTimer) {
            clearInterval(initRetryTimer);
            initRetryTimer = null;
        }
        // Recover live sessions whose shape was null during the outage.
        try {
            const {ConnectionContext} = await import(
                '../web/ws/ConnectionContext.js'
            );
            const count = ConnectionContext.rebuildAllShapes();
            if (count > 0) {
                logger.info(
                    'authz runtime: triggered shape rebuild on %d live sessions',
                    count
                );
            }
        } catch (err) {
            logger.warn('post-init shape rebuild failed: %s', err);
        }
    } catch (err) {
        logger.warn('authz runtime init failed: %s', err);
        if (!initRetryTimer) {
            initRetryTimer = setInterval(() => {
                if (tryGetAuthzRuntime()) {
                    if (initRetryTimer) clearInterval(initRetryTimer);
                    initRetryTimer = null;
                    return;
                }
                void initAuthzRuntime();
            }, INIT_RETRY_INTERVAL_MS);
        }
    }
}

export async function getAuthzRuntimeStatus(): Promise<AuthzRuntimeStatus> {
    const rt = tryGetAuthzRuntime();
    if (!rt) return {initialized: false, redis: false, l1Size: 0};
    return {
        initialized: true,
        redis: await rt.cache.ping(),
        l1Size: rt.l1.size()
    };
}

export async function invalidateAuthzTenant(tenantId: string): Promise<void> {
    // Advance the access version so filteredDeviceCache + #orgDeviceIds drop
    // on the same hop as a persona/assignment/role mutation.
    bumpOrganizationAccessVersion(tenantId);
    await invalidateAuthzTenantCache(tenantId);
}

async function invalidateAuthzTenantCache(tenantId: string): Promise<void> {
    const rt = tryGetAuthzRuntime();
    if (!rt) {
        logger.error(
            'authz runtime missing — invalidation skipped for tenant=%s; permission changes will not propagate until init succeeds',
            tenantId
        );
        return;
    }
    try {
        rt.l1.invalidateTenant(tenantId);
        await rt.cache.invalidate(tenantId);
    } catch (err) {
        logger.warn('authz invalidation failed tenant=%s: %s', tenantId, err);
    }
}

export async function shutdownAuthzRuntime(): Promise<void> {
    if (initRetryTimer) {
        clearInterval(initRetryTimer);
        initRetryTimer = null;
    }
    const rt = tryGetAuthzRuntime();
    if (!rt) return;
    try {
        rt.l1.close();
        rt.unsubscribeWsInvalidation();
        await rt.cache.close();
    } catch (err) {
        logger.warn('authz runtime shutdown error: %s', err);
    }
    setAuthzRuntime(null);
}
