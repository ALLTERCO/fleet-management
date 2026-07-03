// ioredis-backed AuthzCache. Consumes the shared RedisClients runtime
// (initialised once at app boot) so authz no longer holds its own cmd/sub
// pair — net one ioredis pool for the whole process.
//
// Two clients: one for commands, one for SUBSCRIBE (Redis requires a dedicated
// subscriber). Pattern subscription routes every tenant's invalidation channel
// to one psubscribe instead of N.

import type {Redis} from 'ioredis';
import log4js from 'log4js';

import {tuning} from '../../config';
import type {AuthzCache} from './cache';
import {type AuthzConfig, authzInvalidationPattern} from './config';
import type {
    CachedEffectiveShape,
    EffectiveShape,
    InvalidationHandler
} from './types';

const logger = log4js.getLogger('authz-redis-cache');

/** Subset of RedisClients the authz cache needs. Lets callers inject a
 *  test double without depending on the concrete shared-runtime type. */
export interface AuthzRedisClients {
    readonly cmd: Redis;
    readonly sub: Redis;
}

export class RedisAuthzCache implements AuthzCache {
    readonly #cmdClient: Redis;
    readonly #subClient: Redis;
    readonly #cfg: AuthzConfig;
    readonly #handlers = new Set<InvalidationHandler>();
    #subscribed = false;
    #pmessageHandler:
        | ((p: string, channel: string, message: string) => void)
        | null = null;

    constructor(cfg: AuthzConfig, clients: AuthzRedisClients) {
        this.#cfg = cfg;
        this.#cmdClient = clients.cmd;
        this.#subClient = clients.sub;
        // Error logging is owned by RedisClients — no per-cache handler.
    }

    async getEffective(
        userId: string,
        tenantId: string
    ): Promise<CachedEffectiveShape | null> {
        const raw = await this.#cmdClient.get(this.#userKey(tenantId, userId));
        if (!raw) return null;
        try {
            return JSON.parse(raw) as CachedEffectiveShape;
        } catch (err) {
            logger.warn(
                'corrupt cache entry user=%s tenant=%s: %s',
                userId,
                tenantId,
                err
            );
            return null;
        }
    }

    async setEffective(
        userId: string,
        tenantId: string,
        version: number,
        shape: EffectiveShape,
        rolesHash: string,
        ttlSeconds?: number
    ): Promise<void> {
        const ttl = ttlSeconds ?? this.#cfg.l2TtlSeconds;
        const value: CachedEffectiveShape = {
            version,
            shape,
            cachedAt: Date.now(),
            rolesHash
        };
        await this.#cmdClient.set(
            this.#userKey(tenantId, userId),
            JSON.stringify(value),
            'EX',
            ttl
        );
    }

    async getVersion(tenantId: string): Promise<number> {
        const v = await this.#cmdClient.get(this.#versionKey(tenantId));
        return v ? Number.parseInt(v, 10) : 0;
    }

    async seedVersionIfMissing(
        tenantId: string,
        version: number
    ): Promise<number> {
        const key = this.#versionKey(tenantId);
        // SET NX is atomic vs concurrent seeders. EX bounds the key so
        // deleted tenants don't leak (invalidate() rolls the TTL).
        const set = await this.#cmdClient.set(
            key,
            String(version),
            'EX',
            tuning.zitadel.authzVersionTtlSeconds,
            'NX'
        );
        if (set === 'OK') return version;
        const v = await this.#cmdClient.get(key);
        return v ? Number.parseInt(v, 10) : version;
    }

    async invalidate(tenantId: string): Promise<number> {
        const key = this.#versionKey(tenantId);
        const newV = await this.#cmdClient.incr(key);
        await this.#cmdClient.expire(
            key,
            tuning.zitadel.authzVersionTtlSeconds
        );
        await this.#cmdClient.publish(this.#channel(tenantId), String(newV));
        return newV;
    }

    async subscribeInvalidations(
        handler: InvalidationHandler
    ): Promise<() => void> {
        this.#handlers.add(handler);
        if (!this.#subscribed) {
            const pattern = authzInvalidationPattern(this.#cfg);
            await this.#subClient.psubscribe(pattern);
            this.#pmessageHandler = (_p, channel, message) => {
                const tenantId = channel.slice(
                    this.#cfg.pubsubChannelPrefix.length + 1
                );
                const version = Number.parseInt(message, 10);
                if (!Number.isFinite(version)) return;
                for (const h of this.#handlers) {
                    try {
                        h(tenantId, version);
                    } catch (err) {
                        logger.warn('invalidation handler threw: %s', err);
                    }
                }
            };
            this.#subClient.on('pmessage', this.#pmessageHandler);
            this.#subscribed = true;
            logger.info('authz pub/sub subscribed pattern=%s', pattern);
        }
        return () => {
            this.#handlers.delete(handler);
        };
    }

    async ping(): Promise<boolean> {
        try {
            const r = await this.#cmdClient.ping();
            return r === 'PONG';
        } catch (error) {
            logger.debug('redis authz cache ping failed: %s', error);
            return false;
        }
    }

    async close(): Promise<void> {
        this.#handlers.clear();
        // Shared clients are owned by RedisClients; only detach our own
        // psubscribe + listener. Disconnecting here would kill Streams too.
        if (this.#subscribed) {
            try {
                if (this.#pmessageHandler) {
                    this.#subClient.off('pmessage', this.#pmessageHandler);
                    this.#pmessageHandler = null;
                }
                await this.#subClient.punsubscribe(
                    authzInvalidationPattern(this.#cfg)
                );
            } catch (err) {
                logger.warn('punsubscribe on close failed: %s', err);
            }
            this.#subscribed = false;
        }
    }

    #userKey(tenantId: string, userId: string): string {
        return `${this.#cfg.keyPrefix}:tenant:${tenantId}:user:${userId}`;
    }

    #versionKey(tenantId: string): string {
        return `${this.#cfg.keyPrefix}:tenant:${tenantId}:v`;
    }

    #channel(tenantId: string): string {
        return `${this.#cfg.pubsubChannelPrefix}:${tenantId}`;
    }
}
