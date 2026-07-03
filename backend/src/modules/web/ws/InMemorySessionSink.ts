// Redis-less degraded mode. Writes events directly to the socket with no
// per-session stream durability. Used at boot when shared Redis isn't
// initialized (Tiny profile) or when getSharedRedis() throws.
import log4js from 'log4js';
import type {WebSocket} from 'ws';
import {tuning} from '../../../config';
import * as Observability from '../../Observability';
import {safeSocketSend} from './safeSocketSend';

const logger = log4js.getLogger('session-inmem-sink');

export interface SessionSink {
    /** Same shape as SessionEventStream.append — caller doesn't care which mode. */
    append(kind: string, payload: string): Promise<void>;
    /** No-op for the Redis-less path. */
    drop(): Promise<void>;
    readonly mode: 'redis' | 'inmemory';
}

export class InMemorySessionSink implements SessionSink {
    readonly mode = 'inmemory' as const;
    readonly #socket: WebSocket;
    readonly #clientId: string;
    #destroyed = false;

    constructor(socket: WebSocket, clientId: string) {
        this.#socket = socket;
        this.#clientId = clientId;
    }

    async append(kind: string, payload: string): Promise<void> {
        if (this.#destroyed) return;
        // Drop on slow consumer — mirrors SessionStreamSender backpressure.
        if (this.#socket.bufferedAmount > tuning.ws.senderPauseBytes) {
            Observability.incrementLabeledCounter(
                'event_inmem_send_dropped_slow',
                {kind}
            );
            Observability.recordBackpressure({
                clientId: this.#clientId,
                bufferedBytes: this.#socket.bufferedAmount,
                action: 'dropped'
            });
            logger.warn(
                'inmem send dropped kind=%s reason=slow-consumer buffered=%d',
                kind,
                this.#socket.bufferedAmount
            );
            return;
        }
        const result = safeSocketSend(this.#socket, payload);
        if (result.sent) {
            Observability.incrementLabeledCounter('event_inmem_send_total', {
                kind
            });
        } else {
            logger.warn(
                'inmem send dropped kind=%s reason=%s',
                kind,
                result.reason
            );
        }
    }

    async drop(): Promise<void> {
        this.#destroyed = true;
    }
}
