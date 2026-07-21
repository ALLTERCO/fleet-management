// Per-session Redis Stream — replaces PerClientOutbox for WS event delivery.
import type {Redis} from 'ioredis';
import log4js from 'log4js';
import {tuning} from '../../../config';
import * as Observability from '../../Observability';
import {RedisStream} from '../../redis/RedisStream';
import {rateLimiter} from '../../redis/services';

const logger = log4js.getLogger('session-event-stream');

export interface SessionEventStreamOptions {
    userId: string;
    connectionId: string;
    client: Redis;
    readerClient?: Redis;
}

export class SessionEventStream {
    readonly #client: Redis;
    readonly #stream: RedisStream;
    readonly #readerStream: RedisStream;
    readonly #group: string;
    readonly #consumer: string;
    readonly #key: string;
    readonly #rateCheck: (() => Promise<boolean>) | undefined;
    #destroyed = false;

    constructor(opts: SessionEventStreamOptions) {
        this.#client = opts.client;
        this.#key = `${tuning.ws.streamPrefix}:${opts.userId}:${opts.connectionId}`;
        this.#stream = new RedisStream(opts.client, this.#key);
        this.#readerStream = new RedisStream(
            opts.readerClient ?? opts.client,
            this.#key
        );
        this.#group = `g:${opts.connectionId}`;
        this.#consumer = `c:${opts.connectionId}`;
        this.#rateCheck = tuning.redis.rateLimitEnabled
            ? () =>
                  rateLimiter.consume(
                      `xadd:${this.#key}`,
                      tuning.redis.rateLimitCapacity,
                      tuning.redis.rateLimitRefillPerSec
                  )
            : undefined;
    }

    get key(): string {
        return this.#key;
    }

    get group(): string {
        return this.#group;
    }

    get consumer(): string {
        return this.#consumer;
    }

    get stream(): RedisStream {
        return this.#readerStream;
    }

    async ensureGroup(startId = '$'): Promise<void> {
        // First attach starts at live tail; resume can start after last seen id.
        await this.#stream.ensureGroup(this.#group, startId);
    }

    /** Sole owner of the stream TTL: armed at attach, slid by the sender's
     *  periodic heartbeat, re-armed at close. append() never refreshes it.
     *  No-op once dropped, so a late heartbeat can't resurrect a deleted key. */
    async touch(): Promise<void> {
        if (this.#destroyed) return;
        await this.#stream.touch(tuning.ws.streamTtlMs);
    }

    /** True iff the stream key currently exists in Redis. */
    async keyExists(): Promise<boolean> {
        try {
            const n = await this.#client.exists(this.#key);
            return n > 0;
        } catch (err) {
            logger.warn('exists check failed key=%s: %s', this.#key, err);
            return false;
        }
    }

    /** True iff lastSeenStreamId is older than the oldest entry — caller
     *  must trigger RESYNC because Redis trimmed the entries in between. */
    async streamIdIsStale(lastSeenStreamId: string): Promise<boolean> {
        const oldestId = await this.#stream.oldestId();
        if (oldestId === null) return false; // empty stream is fine
        return streamIdLessThan(lastSeenStreamId, oldestId);
    }

    async append(kind: string, payload: string): Promise<void> {
        if (this.#destroyed) return;
        try {
            // No ttlMs here on purpose: the periodic touch() owns the TTL,
            // so the hot append path stays a single XADD round trip.
            const id = await this.#stream.append(
                {kind, payload},
                {
                    maxlen: tuning.ws.streamMaxlen,
                    rateCheck: this.#rateCheck,
                    rateLabel: 'ws'
                }
            );
            if (id !== null) {
                Observability.incrementLabeledCounter('event_xadd_total', {
                    kind
                });
            }
        } catch (err) {
            logger.warn(
                'append failed key=%s kind=%s: %s',
                this.#key,
                kind,
                err
            );
        }
    }

    async drop(): Promise<void> {
        this.#destroyed = true;
        try {
            await this.#stream.delete();
        } catch (err) {
            logger.warn('drop failed key=%s: %s', this.#key, err);
        }
    }
}

function streamIdLessThan(left: string, right: string): boolean {
    const [leftMs, leftSeq] = splitStreamId(left);
    const [rightMs, rightSeq] = splitStreamId(right);
    if (leftMs !== rightMs) return leftMs < rightMs;
    return leftSeq < rightSeq;
}

function splitStreamId(streamId: string): [number, number] {
    const [ms, seq] = streamId.split('-').map(Number);
    return [Number.isFinite(ms) ? ms : -1, Number.isFinite(seq) ? seq : -1];
}
