import {randomUUID} from 'node:crypto';
import log4js from 'log4js';
import {tuning} from '../../config';
import {mergeStatusObjects} from '../../model/statusMerge';
import type {TripPath} from '../eventReplay';
import * as Observability from '../Observability';
import {getInstanceId} from './instanceId';
import type {
    BulkAcceptJobRecord,
    BulkAcceptJobStorePort,
    DeviceIngestPort,
    DeviceSignal,
    DeviceSignalsPort,
    DeviceTrustCachePort,
    DeviceTrustSignal,
    DeviceTrustSignalsPort,
    EventReplayCachePort,
    EventReplayResult,
    IngressAuditPort,
    KvStorePort,
    LeadershipFactory,
    LeadershipOptions,
    LeadershipPort,
    OrgSignal,
    OrgSignalsPort,
    RateLimitBucketSpec,
    RateLimiterConsumeOpts,
    RateLimiterMultiConsumeResult,
    SessionSignal,
    SessionSignalsPort,
    WaitingEntry,
    WaitingStorePort
} from './ports';
import {RATE_LIMITER_TTL_MS} from './ports';
import {
    eventReplayCacheKey,
    getLane,
    isHistoricalWindow,
    laneIndexFor
} from './ports.shared';
import {getSharedRedis} from './RedisClients';
import {getSharedPubSub} from './RedisPubSub';
import {waitingEntryTtlMs, wakeupPeriodFromStatus} from './waitingTtl';

const logger = log4js.getLogger('redis-adapters');

const orgChannel = (orgId: string) =>
    `${tuning.redis.pubsubChannelPrefix}:org:${orgId}`;
const orgPattern = () => `${tuning.redis.pubsubChannelPrefix}:org:*`;
const deviceChannel = () => `${tuning.redis.pubsubChannelPrefix}:device`;
const sessionChannel = () => `${tuning.redis.pubsubChannelPrefix}:session`;
const deviceTrustChannel = () =>
    `${tuning.redis.pubsubChannelPrefix}:device-trust`;

function readSignal<T>(payload: string, category: string): T | null {
    try {
        return JSON.parse(payload) as T;
    } catch {
        Observability.incrementLabeledCounter('pubsub_poison_total', {
            category
        });
        return null;
    }
}

export const redisOrgSignals: OrgSignalsPort = {
    async publish(signal) {
        const enriched: OrgSignal = {...signal, instanceId: getInstanceId()};
        await getSharedPubSub().publish(
            orgChannel(enriched.orgId),
            JSON.stringify(enriched)
        );
    },
    async onAny(handler) {
        const self = getInstanceId();
        await getSharedPubSub().psubscribe(
            orgPattern(),
            (_pattern, _channel, payload) => {
                const signal = readSignal<OrgSignal>(payload, 'org');
                if (signal && signal.instanceId !== self) handler(signal);
            }
        );
    }
};

export const redisDeviceSignals: DeviceSignalsPort = {
    async publish(signal) {
        const enriched: DeviceSignal = {
            ...signal,
            instanceId: getInstanceId()
        };
        await getSharedPubSub().publish(
            deviceChannel(),
            JSON.stringify(enriched)
        );
    },
    async on(handler) {
        const self = getInstanceId();
        await getSharedPubSub().subscribe(
            deviceChannel(),
            (_channel, payload) => {
                const signal = readSignal<DeviceSignal>(payload, 'device');
                if (signal && signal.instanceId !== self) handler(signal);
            }
        );
    }
};

export const redisSessionSignals: SessionSignalsPort = {
    async publish(signal) {
        const enriched: SessionSignal = {
            ...signal,
            instanceId: getInstanceId()
        };
        await getSharedPubSub().publish(
            sessionChannel(),
            JSON.stringify(enriched)
        );
    },
    async on(handler) {
        const self = getInstanceId();
        await getSharedPubSub().subscribe(
            sessionChannel(),
            (_channel, payload) => {
                const signal = readSignal<SessionSignal>(payload, 'session');
                if (signal && signal.instanceId !== self) handler(signal);
            }
        );
    }
};

export const redisDeviceTrustSignals: DeviceTrustSignalsPort = {
    async publish(signal) {
        const enriched: DeviceTrustSignal = {
            ...signal,
            instanceId: getInstanceId()
        };
        await getSharedPubSub().publish(
            deviceTrustChannel(),
            JSON.stringify(enriched)
        );
    },
    async on(handler) {
        const self = getInstanceId();
        await getSharedPubSub().subscribe(
            deviceTrustChannel(),
            (_channel, payload) => {
                const signal = readSignal<DeviceTrustSignal>(
                    payload,
                    'device-trust'
                );
                if (signal && signal.instanceId !== self) handler(signal);
            }
        );
    }
};

const trustCacheKey = (key: string) =>
    `${tuning.redis.keyPrefix}:device-trust:${key}`;

export const redisDeviceTrustCache: DeviceTrustCachePort = {
    async get(key) {
        const {cmd} = getSharedRedis();
        try {
            return (await cmd.get(trustCacheKey(key))) ?? null;
        } catch (err) {
            Observability.incrementCounter('device_trust_cache_errors_total');
            logger.warn('trust cache get failed: %s', err);
            // Fall back to DB on doubt.
            return null;
        }
    },
    async set(key, value, ttlSec) {
        const {cmd} = getSharedRedis();
        try {
            await cmd.set(trustCacheKey(key), value, 'EX', ttlSec);
        } catch (err) {
            Observability.incrementCounter('device_trust_cache_errors_total');
            logger.warn('trust cache set failed: %s', err);
        }
    },
    async del(key) {
        const {cmd} = getSharedRedis();
        // Eviction failure must surface, not serve stale trust.
        await cmd.del(trustCacheKey(key));
    }
};

const APPEND_ERROR_LOG_RATE = 100;
let appendErrorCounter = 0;

export const redisDeviceIngest: DeviceIngestPort = {
    async appendFrame(shellyID, fields) {
        const index = laneIndexFor(shellyID);
        const stream = getLane(index);
        try {
            await stream.append(
                {shellyID, ...fields},
                {
                    maxlen: tuning.ingest.maxlen,
                    ttlMs: tuning.ingest.ttlMs
                }
            );
            Observability.incrementLabeledCounter(
                'device_ingest_appended_total',
                {lane: String(index)}
            );
        } catch (err) {
            Observability.incrementCounter('device_ingest_append_errors');
            if (appendErrorCounter++ % APPEND_ERROR_LOG_RATE === 0) {
                logger.error(
                    'append failed lane=%d shellyID=%s (1-in-%d sample): %s',
                    index,
                    shellyID,
                    APPEND_ERROR_LOG_RATE,
                    err
                );
            }
            throw err;
        }
    }
};

const ingressAuditKey = () => `${tuning.redis.keyPrefix}:ingress-audit`;

// Atomic FIFO drain: read the oldest up-to-N, then trim exactly those off. A
// second drainer sees only what's left, so no record flushes twice.
const INGRESS_AUDIT_DRAIN_LUA = `
local items = redis.call('LRANGE', KEYS[1], 0, ARGV[1] - 1)
if #items > 0 then redis.call('LTRIM', KEYS[1], #items, -1) end
return items
`.trim();

export const redisIngressAudit: IngressAuditPort = {
    async push(record: string, maxlen: number, ttlMs: number): Promise<void> {
        const {cmd} = getSharedRedis();
        try {
            const key = ingressAuditKey();
            await cmd.rpush(key, record);
            await cmd.ltrim(key, -maxlen, -1);
            await cmd.pexpire(key, ttlMs);
        } catch (err) {
            Observability.incrementCounter('ingress_audit_push_errors');
            logger.warn('ingress-audit push failed: %s', err);
        }
    },
    async drain(max: number): Promise<string[]> {
        const {cmd} = getSharedRedis();
        try {
            const items = (await cmd.eval(
                INGRESS_AUDIT_DRAIN_LUA,
                1,
                ingressAuditKey(),
                String(max)
            )) as string[] | null;
            return items ?? [];
        } catch (err) {
            Observability.incrementCounter('ingress_audit_drain_errors');
            logger.warn('ingress-audit drain failed: %s', err);
            return [];
        }
    },
    async size(): Promise<number> {
        const {cmd} = getSharedRedis();
        try {
            return await cmd.llen(ingressAuditKey());
        } catch {
            return 0;
        }
    }
};

export function makeRedisEventReplayCache(): EventReplayCachePort<TripPath> {
    return {
        async get(orgId, params, fetcher) {
            const key = eventReplayCacheKey(orgId, params);
            const {cmd} = getSharedRedis();
            const window = isHistoricalWindow(params.to)
                ? 'historical'
                : 'rolling';
            try {
                const cached = await cmd.get(key);
                if (cached) {
                    Observability.incrementLabeledCounter(
                        'event_replay_cache_hits_total',
                        {window}
                    );
                    return JSON.parse(cached) as EventReplayResult<TripPath>;
                }
            } catch (err) {
                logger.warn(
                    'cache read failed; falling back to live query: %s',
                    err instanceof Error ? err.message : String(err)
                );
                Observability.incrementLabeledCounter(
                    'event_replay_cache_errors_total',
                    {op: 'read'}
                );
            }
            Observability.incrementLabeledCounter(
                'event_replay_cache_misses_total',
                {window}
            );
            const result = await fetcher();
            try {
                const ttl =
                    window === 'historical'
                        ? tuning.device.eventReplayCacheHistoricalSec
                        : tuning.device.eventReplayCacheRollingSec;
                if (ttl > 0) {
                    await cmd.set(key, JSON.stringify(result), 'EX', ttl);
                }
            } catch (err) {
                logger.warn(
                    'cache write failed: %s',
                    err instanceof Error ? err.message : String(err)
                );
                Observability.incrementLabeledCounter(
                    'event_replay_cache_errors_total',
                    {op: 'write'}
                );
            }
            return result;
        }
    };
}

const RELEASE_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const RENEW_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

class RedisLeader implements LeadershipPort {
    readonly #name: string;
    readonly #key: string;
    readonly #token = randomUUID();
    readonly #onAcquire?: () => void | Promise<void>;
    readonly #onLose?: () => void | Promise<void>;
    #isLeader = false;
    #timer: ReturnType<typeof setInterval> | undefined;
    #stopped = false;

    constructor(opts: LeadershipOptions) {
        this.#name = opts.name;
        this.#key = `${tuning.redis.pubsubChannelPrefix}:leader:${opts.name}`;
        this.#onAcquire = opts.onAcquire;
        this.#onLose = opts.onLose;
    }

    isLeader(): boolean {
        return this.#isLeader;
    }

    async start(): Promise<void> {
        if (this.#timer) return;
        await this.#tryAcquire();
        this.#timer = setInterval(
            () => void this.#tick(),
            tuning.redis.leaderRenewMs
        );
        this.#timer.unref?.();
    }

    async stop(): Promise<void> {
        this.#stopped = true;
        if (this.#timer) clearInterval(this.#timer);
        this.#timer = undefined;
        if (this.#isLeader) await this.#release();
    }

    async #tryAcquire(): Promise<void> {
        const {cmd} = getSharedRedis();
        try {
            const res = await cmd.set(
                this.#key,
                this.#token,
                'PX',
                tuning.redis.leaderLeaseMs,
                'NX'
            );
            if (res === 'OK') {
                this.#isLeader = true;
                Observability.incrementLabeledCounter('leader_acquired_total', {
                    name: this.#name
                });
                logger.info('acquired leadership: %s', this.#name);
                await this.#onAcquire?.();
            }
        } catch (err) {
            Observability.incrementCounter('leader_acquire_errors');
            logger.warn('acquire failed name=%s: %s', this.#name, err);
        }
    }

    async #renew(): Promise<boolean> {
        const {cmd} = getSharedRedis();
        try {
            const res = (await cmd.eval(
                RENEW_LUA,
                1,
                this.#key,
                this.#token,
                String(tuning.redis.leaderLeaseMs)
            )) as number;
            return res === 1;
        } catch (err) {
            Observability.incrementCounter('leader_renew_errors');
            logger.warn('renew failed name=%s: %s', this.#name, err);
            return false;
        }
    }

    async #release(): Promise<void> {
        const {cmd} = getSharedRedis();
        try {
            await cmd.eval(RELEASE_LUA, 1, this.#key, this.#token);
        } catch (err) {
            logger.warn('release failed name=%s: %s', this.#name, err);
        }
        this.#isLeader = false;
    }

    async #tick(): Promise<void> {
        if (this.#stopped) return;
        if (this.#isLeader) {
            const ok = await this.#renew();
            if (!ok) {
                this.#isLeader = false;
                Observability.incrementLabeledCounter('leader_lost_total', {
                    name: this.#name
                });
                logger.warn('lost leadership: %s', this.#name);
                await this.#onLose?.();
            }
        } else {
            await this.#tryAcquire();
        }
    }
}

export const redisLeadershipFactory: LeadershipFactory = {
    create(opts) {
        return new RedisLeader(opts);
    }
};

export function makeRedisKvStore(): KvStorePort {
    return {
        async get(key) {
            return await getSharedRedis().cmd.get(key);
        },
        async set(key, value, ttlSec) {
            const cmd = getSharedRedis().cmd;
            if (ttlSec !== undefined) {
                await cmd.set(key, value, 'EX', ttlSec);
            } else {
                await cmd.set(key, value);
            }
        }
    };
}

// All-or-nothing: check every bucket, then decrement all. Denial writes
// nothing (returns 1-based denied index), so there is no refund race.
const RATE_LIMITER_MULTI_LUA = `
local n = #KEYS
local now_ms = tonumber(ARGV[n * 2 + 1])
local ttl_ms = tonumber(ARGV[n * 2 + 2])
local new_tokens = {}
for i = 1, n do
  local capacity = tonumber(ARGV[i * 2 - 1])
  local refill_per_sec = tonumber(ARGV[i * 2])
  local h = redis.call('hmget', KEYS[i], 'tokens', 'updated')
  local tokens = tonumber(h[1])
  local updated = tonumber(h[2])
  if tokens == nil then
    tokens = capacity
  else
    local delta = math.max(0, now_ms - updated) / 1000
    tokens = math.min(capacity, tokens + delta * refill_per_sec)
  end
  if tokens < 1 then return i end
  new_tokens[i] = tokens - 1
end
for i = 1, n do
  redis.call('hmset', KEYS[i], 'tokens', new_tokens[i], 'updated', now_ms)
  redis.call('pexpire', KEYS[i], ttl_ms)
end
return 0
`.trim();

const rateLimitKey = (key: string) =>
    `${tuning.redis.keyPrefix}:ratelimit:${key}`;

// Fail-open on outage so a Redis blip can't drop hot-path traffic or block a
// DLQ spill. Security caps (anti-spam) opt into failClosed:true.
export function rateLimitOutageDecision(
    opts?: RateLimiterConsumeOpts
): RateLimiterMultiConsumeResult {
    return {allowed: !opts?.failClosed};
}

export const redisRateLimiter: import('./ports').RateLimiterPort = {
    // consume is the n=1 case of consumeMany — one home for the algorithm.
    async consume(
        key: string,
        capacity: number,
        refillPerSec: number,
        opts?: RateLimiterConsumeOpts
    ): Promise<boolean> {
        const result = await redisRateLimiter.consumeMany(
            [{key, capacity, refillPerSec}],
            opts
        );
        return result.allowed;
    },
    async consumeMany(
        buckets: RateLimitBucketSpec[],
        opts?: RateLimiterConsumeOpts
    ): Promise<RateLimiterMultiConsumeResult> {
        if (buckets.length === 0) return {allowed: true};
        const {cmd} = getSharedRedis();
        const keys = buckets.map((b) => rateLimitKey(b.key));
        const args = buckets.flatMap((b) => [
            String(b.capacity),
            String(b.refillPerSec)
        ]);
        try {
            const res = (await cmd.eval(
                RATE_LIMITER_MULTI_LUA,
                keys.length,
                ...keys,
                ...args,
                String(Date.now()),
                String(RATE_LIMITER_TTL_MS)
            )) as number;
            if (res === 0) return {allowed: true};
            return {allowed: false, deniedIndex: res - 1};
        } catch (err) {
            Observability.incrementCounter('rate_limit_redis_errors_total');
            logger.warn(
                'redis rate-limit failed keys=%s: %s',
                buckets.map((b) => b.key).join(','),
                err
            );
            return rateLimitOutageDecision(opts);
        }
    }
};

// INCR + EXPIRE in one round-trip so a glitch can't leak a TTL-less key.
const INCR_WITH_EXPIRE =
    "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n";
const DECR_IF_EXISTS =
    "if redis.call('EXISTS', KEYS[1]) == 1 then return redis.call('DECR', KEYS[1]) else return -1 end";

interface ReservationCmd {
    eval(
        script: string,
        numKeys: number,
        ...args: (string | number)[]
    ): Promise<unknown>;
}

export async function reserveWith(
    cmd: ReservationCmd,
    key: string,
    capacity: number,
    ttlSec: number
): Promise<import('./ports').Reservation> {
    try {
        const newCount = Number(
            await cmd.eval(INCR_WITH_EXPIRE, 1, key, ttlSec)
        );
        if (newCount > capacity) {
            await cmd.eval(DECR_IF_EXISTS, 1, key);
            return {ok: false, reason: 'at_capacity'};
        }
        return {
            ok: true,
            release: async () => {
                try {
                    await cmd.eval(DECR_IF_EXISTS, 1, key);
                } catch (err) {
                    logger.warn(
                        'reservation release failed key=%s: %s',
                        key,
                        err
                    );
                }
            }
        };
    } catch (err) {
        Observability.incrementCounter('reservation_redis_errors_total');
        logger.warn('reservation reserve failed key=%s: %s', key, err);
        // Report the outage; the caller owns the fail-open/closed decision.
        return {ok: false, reason: 'backend_error'};
    }
}

export const redisReservation: import('./ports').ReservationPort = {
    async reserve(key, capacity, ttlSec) {
        const {cmd} = getSharedRedis();
        const fullKey = `${tuning.redis.keyPrefix}:reservation:${key}`;
        return reserveWith(cmd as ReservationCmd, fullKey, capacity, ttlSec);
    }
};

const ownershipKey = (shellyID: string) =>
    `${tuning.redis.keyPrefix}:device:${shellyID}:owner`;

export const redisDeviceOwnership: import('./ports').DeviceOwnershipPort = {
    async claim(shellyID: string, ttlMs: number): Promise<boolean> {
        const {cmd} = getSharedRedis();
        try {
            const res = await cmd.set(
                ownershipKey(shellyID),
                getInstanceId(),
                'PX',
                ttlMs,
                'NX'
            );
            return res === 'OK';
        } catch (err) {
            Observability.incrementCounter('device_ownership_errors_total');
            logger.warn('claim failed shellyID=%s: %s', shellyID, err);
            return false;
        }
    },
    async heartbeat(shellyID: string, ttlMs: number): Promise<void> {
        const {cmd} = getSharedRedis();
        try {
            // Refresh the TTL only while the token still matches.
            await cmd.eval(
                RENEW_LUA,
                1,
                ownershipKey(shellyID),
                getInstanceId(),
                String(ttlMs)
            );
        } catch (err) {
            Observability.incrementCounter('device_ownership_errors_total');
            logger.warn('heartbeat failed shellyID=%s: %s', shellyID, err);
        }
    },
    async release(shellyID: string): Promise<void> {
        const {cmd} = getSharedRedis();
        try {
            await cmd.eval(
                RELEASE_LUA,
                1,
                ownershipKey(shellyID),
                getInstanceId()
            );
        } catch (err) {
            Observability.incrementCounter('device_ownership_errors_total');
            logger.warn('release failed shellyID=%s: %s', shellyID, err);
        }
    },
    async owner(shellyID: string): Promise<string | null> {
        const {cmd} = getSharedRedis();
        try {
            const res = await cmd.get(ownershipKey(shellyID));
            return res ?? null;
        } catch (err) {
            Observability.incrementCounter('device_ownership_errors_total');
            logger.warn('owner lookup failed shellyID=%s: %s', shellyID, err);
            return null;
        }
    }
};

const exportOwnershipKey = (filename: string) =>
    `${tuning.redis.keyPrefix}:export-owner:${filename}`;

export const redisExportOwnership: import('./ports').ExportOwnershipPort = {
    // Throws on failure so the caller never returns a dead download URL.
    async set(filename: string, userId: string, ttlSec: number): Promise<void> {
        const {cmd} = getSharedRedis();
        await cmd.set(exportOwnershipKey(filename), userId, 'EX', ttlSec);
    },
    async get(filename: string): Promise<string | null> {
        const {cmd} = getSharedRedis();
        try {
            return (await cmd.get(exportOwnershipKey(filename))) ?? null;
        } catch (err) {
            logger.warn('export-owner get failed file=%s: %s', filename, err);
            return null;
        }
    }
};

const uploadTicketKey = (token: string) =>
    `${tuning.redis.keyPrefix}:upload-ticket:${token}`;

export const redisUploadTickets: import('./ports').UploadTicketPort = {
    async set(token: string, value: string, ttlSec: number): Promise<void> {
        const {cmd} = getSharedRedis();
        await cmd.set(uploadTicketKey(token), value, 'EX', ttlSec);
    },
    async consume(token: string): Promise<string | null> {
        const {cmd} = getSharedRedis();
        try {
            const result = await cmd.eval(
                "local v=redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]); end; return v",
                1,
                uploadTicketKey(token)
            );
            return typeof result === 'string' ? result : null;
        } catch (err) {
            logger.warn('upload-ticket consume failed: %s', err);
            return null;
        }
    }
};

const uploadSessionKey = (sessionId: string) =>
    `${tuning.redis.keyPrefix}:upload-session:${sessionId}`;

export const redisUploadSessions: import('./ports').UploadSessionPort = {
    async set(sessionId: string, value: string, ttlSec: number): Promise<void> {
        const {cmd} = getSharedRedis();
        await cmd.set(uploadSessionKey(sessionId), value, 'EX', ttlSec);
    },
    async get(sessionId: string): Promise<string | null> {
        const {cmd} = getSharedRedis();
        try {
            return (await cmd.get(uploadSessionKey(sessionId))) ?? null;
        } catch (err) {
            logger.warn('upload-session get failed: %s', err);
            return null;
        }
    },
    async delete(sessionId: string): Promise<void> {
        const {cmd} = getSharedRedis();
        await cmd.del(uploadSessionKey(sessionId));
    }
};

const shadowKey = (shellyID: string) =>
    `${tuning.redis.keyPrefix}:device:${shellyID}:latest`;

export const redisDeviceShadow: import('./ports').DeviceShadowPort = {
    async write(
        shellyID: string,
        fields: Record<string, string>,
        ttlMs: number
    ): Promise<void> {
        if (Object.keys(fields).length === 0) return;
        const {cmd} = getSharedRedis();
        try {
            const key = shadowKey(shellyID);
            await cmd.hset(key, fields);
            await cmd.pexpire(key, ttlMs);
        } catch (err) {
            Observability.incrementCounter('device_shadow_errors_total');
            logger.warn('shadow write failed shellyID=%s: %s', shellyID, err);
        }
    },
    async read(shellyID: string): Promise<Record<string, string> | null> {
        const {cmd} = getSharedRedis();
        try {
            const out = await cmd.hgetall(shadowKey(shellyID));
            return out && Object.keys(out).length > 0 ? out : null;
        } catch (err) {
            Observability.incrementCounter('device_shadow_errors_total');
            logger.warn('shadow read failed shellyID=%s: %s', shellyID, err);
            return null;
        }
    },
    async drop(shellyID: string): Promise<void> {
        const {cmd} = getSharedRedis();
        try {
            await cmd.del(shadowKey(shellyID));
        } catch (err) {
            Observability.incrementCounter('device_shadow_errors_total');
            logger.warn('shadow drop failed shellyID=%s: %s', shellyID, err);
        }
    }
};

// Per-org HASH (field=shellyID). The key carries a TTL refreshed on
// every write; the in-JSON expiresAt lets one quiet device expire while
// noisier siblings keep the key alive.
// Ceiling for a sleeper's extended TTL, so a device reporting a huge wakeup
// period can't pin its waiting-room entry indefinitely.
const WAITING_MAX_TTL_MS = 24 * 60 * 60 * 1000;

const waitingTtlMsFor = (entry: {wakeupPeriodSec?: number}): number =>
    waitingEntryTtlMs(
        entry.wakeupPeriodSec,
        tuning.waitingRoom.redisTtlSec * 1000,
        WAITING_MAX_TTL_MS
    );

const waitingKey = (organizationId: string) =>
    `${tuning.redis.keyPrefix}:waitingroom:${organizationId}`;

const rejectedKey = (organizationId: string, shellyID: string) =>
    `${tuning.redis.keyPrefix}:waitingroom-rejected:${organizationId}:${shellyID}`;

// Atomic HGET+HDEL: only one concurrent caller wins the field.
const WAITING_CLAIM_LUA = `
local v = redis.call('HGET', KEYS[1], ARGV[1])
if v == false then return false end
redis.call('HDEL', KEYS[1], ARGV[1])
return v
`.trim();

// Refuses a new field once the hash holds `cap`; existing fields refresh.
const WAITING_UPSERT_LUA = `
local cap = tonumber(ARGV[3])
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 and redis.call('HLEN', KEYS[1]) >= cap then
  return 0
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return 1
`.trim();

// Refresh only an existing field.
const WAITING_HEARTBEAT_LUA = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`.trim();

// Read-mutate-write that writes only if the field still exists, so a claim
// landing mid-update can't resurrect a removed entry.
async function updateExistingEntry(
    organizationId: string,
    shellyID: string,
    mutate: (entry: WaitingEntry & {expiresAt: number}) => void
): Promise<boolean> {
    const {cmd} = getSharedRedis();
    const key = waitingKey(organizationId);
    const raw = await cmd.hget(key, shellyID);
    if (!raw) return false;
    const entry = parseWaitingEntry(raw);
    if (!entry || !isLive(entry, Date.now())) return false;
    mutate(entry);
    const ttlMs = waitingTtlMsFor(entry);
    entry.lastSeenAt = Date.now();
    entry.expiresAt = entry.lastSeenAt + ttlMs;
    await cmd.eval(
        WAITING_HEARTBEAT_LUA,
        1,
        key,
        shellyID,
        JSON.stringify(entry),
        String(ttlMs)
    );
    return true;
}

function isLive(entry: WaitingEntry & {expiresAt: number}, nowMs: number) {
    return entry.expiresAt > nowMs;
}

function parseWaitingEntry(
    raw: string
): (WaitingEntry & {expiresAt: number}) | null {
    try {
        return JSON.parse(raw) as WaitingEntry & {expiresAt: number};
    } catch {
        return null;
    }
}

export const redisWaitingStorePort: WaitingStorePort = {
    async upsert(entry: WaitingEntry): Promise<boolean> {
        const {cmd} = getSharedRedis();
        const ttlMs = waitingTtlMsFor(entry);
        const stored = {...entry, expiresAt: Date.now() + ttlMs};
        const res = (await cmd.eval(
            WAITING_UPSERT_LUA,
            1,
            waitingKey(entry.organizationId),
            entry.shellyID,
            JSON.stringify(stored),
            String(tuning.waitingRoom.maxPerOrg),
            String(ttlMs)
        )) as number;
        return res === 1;
    },
    async get(
        organizationId: string,
        shellyID: string
    ): Promise<WaitingEntry | null> {
        const {cmd} = getSharedRedis();
        const raw = await cmd.hget(waitingKey(organizationId), shellyID);
        if (!raw) return null;
        const entry = parseWaitingEntry(raw);
        if (!entry || !isLive(entry, Date.now())) return null;
        const {expiresAt: _drop, ...rest} = entry;
        return rest;
    },
    async restoreClaimed(entry: WaitingEntry): Promise<void> {
        const {cmd} = getSharedRedis();
        const key = waitingKey(entry.organizationId);
        const ttlMs = waitingTtlMsFor(entry);
        const stored = {...entry, expiresAt: Date.now() + ttlMs};
        await cmd.hset(key, entry.shellyID, JSON.stringify(stored));
        await cmd.pexpire(key, ttlMs);
    },
    async isPending(
        organizationId: string,
        shellyID: string
    ): Promise<boolean> {
        const {cmd} = getSharedRedis();
        const raw = await cmd.hget(waitingKey(organizationId), shellyID);
        if (!raw) return false;
        const entry = parseWaitingEntry(raw);
        return entry !== null && isLive(entry, Date.now());
    },
    async heartbeat(organizationId: string, shellyID: string): Promise<void> {
        await updateExistingEntry(organizationId, shellyID, () => {});
    },
    async mergeStatus(
        organizationId: string,
        shellyID: string,
        status: Record<string, unknown>
    ): Promise<boolean> {
        // Deep merge: a partial enrichment (e.g. sys without device) must top
        // up the stored status, not replace sys and wipe device.model/ver.
        return updateExistingEntry(organizationId, shellyID, (entry) => {
            entry.jdoc = mergeStatusObjects(entry.jdoc, status);
            // A late status (e.g. NotifyStatus-first device) can be the first to
            // reveal the wake interval — pick it up so the TTL extends.
            entry.wakeupPeriodSec =
                wakeupPeriodFromStatus(entry.jdoc) ?? entry.wakeupPeriodSec;
        });
    },
    async listByOrg(organizationId: string): Promise<WaitingEntry[]> {
        const {cmd} = getSharedRedis();
        const map = await cmd.hgetall(waitingKey(organizationId));
        const now = Date.now();
        const out: WaitingEntry[] = [];
        for (const raw of Object.values(map)) {
            const entry = parseWaitingEntry(raw);
            if (entry && isLive(entry, now)) {
                const {expiresAt: _drop, ...rest} = entry;
                out.push(rest);
            }
        }
        return out;
    },
    async countByOrg(organizationId: string): Promise<number> {
        return (await this.listByOrg(organizationId)).length;
    },
    async claim(
        organizationId: string,
        shellyID: string
    ): Promise<WaitingEntry | null> {
        const {cmd} = getSharedRedis();
        const res = await cmd.eval(
            WAITING_CLAIM_LUA,
            1,
            waitingKey(organizationId),
            shellyID
        );
        if (typeof res !== 'string') return null;
        const entry = parseWaitingEntry(res);
        if (!entry || !isLive(entry, Date.now())) return null;
        const {expiresAt: _drop, ...rest} = entry;
        return rest;
    },
    async remove(organizationId: string, shellyID: string): Promise<void> {
        const {cmd} = getSharedRedis();
        await cmd.hdel(waitingKey(organizationId), shellyID);
    },
    async markRejected(
        organizationId: string,
        shellyID: string,
        ttlSec: number
    ): Promise<void> {
        const {cmd} = getSharedRedis();
        await cmd.set(rejectedKey(organizationId, shellyID), '1', 'EX', ttlSec);
    },
    async isRejected(
        organizationId: string,
        shellyID: string
    ): Promise<boolean> {
        const {cmd} = getSharedRedis();
        const res = await cmd.get(rejectedKey(organizationId, shellyID));
        return res !== null;
    }
};

const bulkAcceptKey = (organizationId: string, jobId: string) =>
    `${tuning.redis.keyPrefix}:bulkaccept:${organizationId}:${jobId}`;

const bulkAcceptFailedKey = (organizationId: string, jobId: string) =>
    `${bulkAcceptKey(organizationId, jobId)}:failed`;

const bulkAcceptCancelKey = (organizationId: string, jobId: string) =>
    `${tuning.redis.keyPrefix}:bulkaccept-cancel:${organizationId}:${jobId}`;

export const redisBulkAcceptJobStorePort: BulkAcceptJobStorePort = {
    async set(record: BulkAcceptJobRecord, ttlSec: number): Promise<void> {
        const {cmd} = getSharedRedis();
        const key = bulkAcceptKey(record.organizationId, record.jobId);
        const failedKey = bulkAcceptFailedKey(
            record.organizationId,
            record.jobId
        );
        await cmd
            .multi()
            .del(failedKey)
            .hset(key, {
                jobId: record.jobId,
                organizationId: record.organizationId,
                total: String(record.total),
                processed: String(record.processed),
                accepted: String(record.accepted),
                state: record.state,
                startedAt: String(record.startedAt),
                updatedAt: String(record.updatedAt)
            })
            .expire(key, ttlSec)
            .expire(failedKey, ttlSec)
            .exec();
        if (record.failed.length > 0) {
            await cmd.rpush(failedKey, ...record.failed);
            await cmd.expire(failedKey, ttlSec);
        }
    },
    async recordProgress(ref, progress, ttlSec): Promise<void> {
        const {cmd} = getSharedRedis();
        const key = bulkAcceptKey(ref.organizationId, ref.jobId);
        const failedKey = bulkAcceptFailedKey(ref.organizationId, ref.jobId);
        const tx = cmd
            .multi()
            .hincrby(key, 'processed', progress.processed)
            .hincrby(key, 'accepted', progress.accepted)
            .hset(key, 'updatedAt', String(progress.updatedAt))
            .expire(key, ttlSec);
        if (progress.failed.length > 0) {
            tx.rpush(failedKey, ...progress.failed).expire(failedKey, ttlSec);
        }
        await tx.exec();
    },
    async get(
        organizationId: string,
        jobId: string
    ): Promise<BulkAcceptJobRecord | null> {
        const {cmd} = getSharedRedis();
        const key = bulkAcceptKey(organizationId, jobId);
        const keyType = await cmd.type(key);
        if (keyType === 'none') return null;
        if (keyType === 'string') {
            const raw = await cmd.get(key);
            if (!raw) return null;
            try {
                return JSON.parse(raw) as BulkAcceptJobRecord;
            } catch {
                return null;
            }
        }
        if (keyType !== 'hash') return null;
        const [fields, failed] = await Promise.all([
            cmd.hgetall(key),
            cmd.lrange(bulkAcceptFailedKey(organizationId, jobId), 0, -1)
        ]);
        if (!fields.jobId) return null;
        return {
            jobId: fields.jobId,
            organizationId: fields.organizationId,
            total: Number(fields.total ?? 0),
            processed: Number(fields.processed ?? 0),
            accepted: Number(fields.accepted ?? 0),
            failed,
            state: fields.state as BulkAcceptJobRecord['state'],
            startedAt: Number(fields.startedAt ?? 0),
            updatedAt: Number(fields.updatedAt ?? 0)
        };
    },
    async markCancel(
        organizationId: string,
        jobId: string,
        ttlSec: number
    ): Promise<void> {
        const {cmd} = getSharedRedis();
        await cmd.set(
            bulkAcceptCancelKey(organizationId, jobId),
            '1',
            'EX',
            ttlSec
        );
    },
    async isCancelRequested(
        organizationId: string,
        jobId: string
    ): Promise<boolean> {
        const {cmd} = getSharedRedis();
        const res = await cmd.get(bulkAcceptCancelKey(organizationId, jobId));
        return res !== null;
    }
};
