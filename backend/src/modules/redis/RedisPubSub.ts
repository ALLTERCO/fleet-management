// Typed wrapper over ioredis PUBLISH/SUBSCRIBE/PSUBSCRIBE.
import type {Redis} from 'ioredis';
import log4js from 'log4js';
import * as Observability from '../Observability';
import {getSharedRedis} from './RedisClients';

const logger = log4js.getLogger('redis-pubsub');

// Maps "fm:org:org-123" → "org" so counters have bounded cardinality.
function channelCategory(channel: string): string {
    const parts = channel.split(':');
    return parts[1] ?? channel;
}

export type MessageHandler = (channel: string, payload: string) => void;
export type PatternHandler = (
    pattern: string,
    channel: string,
    payload: string
) => void;

export class RedisPubSub {
    readonly #cmd: Redis;
    readonly #sub: Redis;
    readonly #channelHandlers = new Map<string, Set<MessageHandler>>();
    readonly #patternHandlers = new Map<string, Set<PatternHandler>>();
    #wired = false;
    #messageDispatcher: ((channel: string, message: string) => void) | null =
        null;
    #patternDispatcher:
        | ((pattern: string, channel: string, message: string) => void)
        | null = null;

    constructor(cmd: Redis, sub: Redis) {
        this.#cmd = cmd;
        this.#sub = sub;
    }

    /**
     * Detach the message/pmessage listeners so the sub client can be
     * cleanly closed at shutdown without leaving callbacks pinned.
     */
    unwire(): void {
        if (!this.#wired) return;
        if (this.#messageDispatcher) {
            this.#sub.off('message', this.#messageDispatcher);
            this.#messageDispatcher = null;
        }
        if (this.#patternDispatcher) {
            this.#sub.off('pmessage', this.#patternDispatcher);
            this.#patternDispatcher = null;
        }
        this.#wired = false;
    }

    async publish(channel: string, payload: string): Promise<void> {
        try {
            await this.#cmd.publish(channel, payload);
            // Bound cardinality: label by category (segment 2), not the raw
            // channel (which may include an orgId tail and grow unbounded).
            Observability.incrementLabeledCounter('pubsub_published_total', {
                category: channelCategory(channel)
            });
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('publish failed channel=%s: %s', channel, err);
            throw err;
        }
    }

    async subscribe(channel: string, handler: MessageHandler): Promise<void> {
        this.#wireDispatchOnce();
        const handlers = this.#channelHandlers.get(channel) ?? new Set();
        handlers.add(handler);
        this.#channelHandlers.set(channel, handlers);
        if (handlers.size === 1) {
            try {
                await this.#sub.subscribe(channel);
            } catch (err) {
                Observability.incrementCounter('redis_sub_errors_total');
                logger.warn('subscribe failed channel=%s: %s', channel, err);
                throw err;
            }
        }
    }

    async psubscribe(pattern: string, handler: PatternHandler): Promise<void> {
        this.#wireDispatchOnce();
        const handlers = this.#patternHandlers.get(pattern) ?? new Set();
        handlers.add(handler);
        this.#patternHandlers.set(pattern, handlers);
        if (handlers.size === 1) {
            try {
                await this.#sub.psubscribe(pattern);
            } catch (err) {
                Observability.incrementCounter('redis_sub_errors_total');
                logger.warn('psubscribe failed pattern=%s: %s', pattern, err);
                throw err;
            }
        }
    }

    async unsubscribe(channel: string, handler: MessageHandler): Promise<void> {
        const handlers = this.#channelHandlers.get(channel);
        if (!handlers) return;
        handlers.delete(handler);
        if (handlers.size === 0) {
            this.#channelHandlers.delete(channel);
            try {
                await this.#sub.unsubscribe(channel);
            } catch (err) {
                logger.warn('unsubscribe failed channel=%s: %s', channel, err);
            }
        }
    }

    #wireDispatchOnce(): void {
        if (this.#wired) return;
        this.#wired = true;
        this.#messageDispatcher = (channel: string, message: string) => {
            Observability.incrementLabeledCounter('pubsub_received_total', {
                category: channelCategory(channel)
            });
            const handlers = this.#channelHandlers.get(channel);
            if (!handlers) return;
            for (const handler of handlers) {
                try {
                    handler(channel, message);
                } catch (err) {
                    Observability.incrementLabeledCounter(
                        'pubsub_handler_errors_total',
                        {category: channelCategory(channel)}
                    );
                    logger.warn('handler threw channel=%s: %s', channel, err);
                }
            }
        };
        this.#patternDispatcher = (
            pattern: string,
            channel: string,
            message: string
        ) => {
            Observability.incrementLabeledCounter('pubsub_received_total', {
                category: channelCategory(channel)
            });
            const handlers = this.#patternHandlers.get(pattern);
            if (!handlers) return;
            for (const handler of handlers) {
                try {
                    handler(pattern, channel, message);
                } catch (err) {
                    Observability.incrementLabeledCounter(
                        'pubsub_handler_errors_total',
                        {category: channelCategory(channel)}
                    );
                    logger.warn(
                        'pattern handler threw pattern=%s: %s',
                        pattern,
                        err
                    );
                }
            }
        };
        this.#sub.on('message', this.#messageDispatcher);
        this.#sub.on('pmessage', this.#patternDispatcher);
    }
}

let shared: RedisPubSub | undefined;

// Process singleton — one dispatcher on the shared sub client.
export function getSharedPubSub(): RedisPubSub {
    if (!shared) {
        const {cmd, sub} = getSharedRedis();
        shared = new RedisPubSub(cmd, sub);
    }
    return shared;
}

export function resetSharedPubSubForTests(): void {
    shared = undefined;
}
