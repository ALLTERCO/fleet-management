// Shared ioredis clients. Confined import — other modules use the typed wrappers.
//
// Connection roles are kept separate on purpose:
//   - cmd      request-path commands, cache, gates (fast, non-blocking)
//   - sub      pub/sub subscriber (cannot run normal commands)
//   - *Blocking one per XREADGROUP BLOCK loop, so a blocking read never
//              queues ahead of request-path commands on a shared connection.
import {Redis, type RedisOptions} from 'ioredis';
import log4js from 'log4js';
import {tuning} from '../../config';

const logger = log4js.getLogger('redis-clients');

export interface RedisClientsOptions {
    url: string;
}

export interface RedisClientTuning {
    commandTimeoutMs: number;
    connectTimeoutMs: number;
    subBackoffMaxMs: number;
}

export function buildRedisBaseOptions(
    settings: RedisClientTuning
): RedisOptions {
    const options: RedisOptions = {
        lazyConnect: false,
        enableReadyCheck: false,
        connectTimeout: settings.connectTimeoutMs,
        retryStrategy: (times) =>
            Math.min(times * 200, settings.subBackoffMaxMs)
    };
    if (settings.commandTimeoutMs > 0) {
        options.commandTimeout = settings.commandTimeoutMs;
    }
    return options;
}

// Options for a dedicated blocking connection. Two rules that differ from the
// request path:
//   - maxRetriesPerRequest: null — a reconnect must resend the blocked read.
//   - NO commandTimeout — a timeout shorter than the BLOCK window would abort a
//     healthy blocking read (em-sync blocks 2s; a 1s timeout would kill it).
export function buildBlockingRedisOptions(
    settings: RedisClientTuning
): RedisOptions {
    const {commandTimeout: _drop, ...base} = buildRedisBaseOptions(settings);
    return {...base, maxRetriesPerRequest: null};
}

export class RedisClients {
    readonly cmd: Redis;
    readonly sub: Redis;
    readonly statusBlocking: Redis;
    readonly snapshotBlocking: Redis;
    readonly deviceEventBlocking: Redis;
    readonly auditBlocking: Redis;
    readonly emSyncBlocking: Redis;
    readonly #url: string;

    constructor(options: RedisClientsOptions) {
        this.#url = options.url;
        const baseOpts = buildRedisBaseOptions(tuning.redis);
        const blockOpts = buildBlockingRedisOptions(tuning.redis);
        this.cmd = new Redis(this.#url, {
            ...baseOpts,
            maxRetriesPerRequest: tuning.redis.cmdRetriesMax
        });
        this.sub = new Redis(this.#url, {
            ...baseOpts,
            // Pub/Sub commands ignore retries; subscribe must not throw mid-reconnect.
            maxRetriesPerRequest: null
        });
        // One dedicated connection per always-on blocking drainer.
        this.statusBlocking = this.#makeBlocking(blockOpts, 'status');
        this.snapshotBlocking = this.#makeBlocking(blockOpts, 'snapshot');
        this.deviceEventBlocking = this.#makeBlocking(
            blockOpts,
            'device-event'
        );
        this.auditBlocking = this.#makeBlocking(blockOpts, 'audit');
        this.emSyncBlocking = this.#makeBlocking(blockOpts, 'em-sync');
        this.cmd.on('error', (err) => logger.warn('cmd error: %s', err));
        this.sub.on('error', (err) => logger.warn('sub error: %s', err));
        this.cmd.on('reconnecting', () => logger.info('cmd reconnecting'));
        this.sub.on('reconnecting', () => logger.info('sub reconnecting'));
    }

    #makeBlocking(opts: RedisOptions, label: string): Redis {
        const client = new Redis(this.#url, opts);
        client.on('error', (err) =>
            logger.warn('%s-blocking error: %s', label, err)
        );
        client.on('reconnecting', () =>
            logger.info('%s-blocking reconnecting', label)
        );
        return client;
    }

    async disconnect(): Promise<void> {
        await Promise.allSettled([
            this.cmd.quit(),
            this.sub.quit(),
            this.statusBlocking.quit(),
            this.snapshotBlocking.quit(),
            this.deviceEventBlocking.quit(),
            this.auditBlocking.quit(),
            this.emSyncBlocking.quit()
        ]);
    }
}

let shared: RedisClients | undefined;

export function initSharedRedis(opts: RedisClientsOptions): RedisClients {
    if (shared) return shared;
    if (!opts.url) {
        throw new Error(
            'initSharedRedis: empty URL. Set FM_REDIS_URL or FM_REDIS_DISABLED=true.'
        );
    }
    shared = new RedisClients(opts);
    return shared;
}

export function getSharedRedis(): RedisClients {
    if (!shared) {
        throw new Error(
            'RedisClients not initialised — call initSharedRedis()'
        );
    }
    return shared;
}

export function resetSharedRedisForTests(): void {
    shared = undefined;
}

// Quit every client if initialised; keeps callers off getSharedRedis().
export async function shutdownSharedRedis(): Promise<void> {
    if (!shared) return;
    await shared.disconnect();
    shared = undefined;
}

// Test-only — inject fake clients without touching ioredis. A single `blocking`
// fake stands in for every per-drainer blocking client.
export function setSharedRedisForTests(
    cmd: unknown,
    sub: unknown,
    blocking: unknown = cmd
): void {
    shared = {
        cmd,
        sub,
        statusBlocking: blocking,
        snapshotBlocking: blocking,
        deviceEventBlocking: blocking,
        auditBlocking: blocking,
        emSyncBlocking: blocking,
        disconnect: async () => {}
    } as unknown as RedisClients;
}
