// Single guard for the WS-send-after-close race. Every WS write path routes
// through here so the readyState check + drop counter live in one place.
import log4js from 'log4js';
import type {WebSocket} from 'ws';
import type {Sendable} from '../../../types';
import * as Observability from '../../Observability';

const logger = log4js.getLogger('safe-socket-send');

const WS_OPEN = 1;

export class SocketNotOpenError extends Error {
    constructor() {
        super('socket not open');
        this.name = 'SocketNotOpenError';
    }
}

export function isSocketNotOpenError(error: unknown): boolean {
    return error instanceof SocketNotOpenError;
}

// Test fakes (Sendable) have no readyState — treat as always-open.
function isOpen(socket: Sendable | WebSocket): boolean {
    return !('readyState' in socket) || socket.readyState === WS_OPEN;
}

export interface SafeSendResult {
    sent: boolean;
    reason?: 'not-open' | 'throw';
}

// Send a payload, counting and logging drops instead of throwing.
export function safeSocketSend(
    socket: Sendable | WebSocket,
    payload: string
): SafeSendResult {
    if (!isOpen(socket)) {
        Observability.incrementCounter('ws_send_dropped_closed');
        return {sent: false, reason: 'not-open'};
    }
    try {
        socket.send(payload);
        return {sent: true};
    } catch (err) {
        Observability.incrementCounter('ws_send_dropped_closed');
        logger.debug('socket.send dropped: %s', err);
        return {sent: false, reason: 'throw'};
    }
}

// Strict variant — throws on closed socket so callers can abort batches and
// leave un-sent entries in PEL for the next session.
export function strictSocketSend(socket: WebSocket, payload: string): void {
    if (socket.readyState !== WS_OPEN) {
        Observability.incrementCounter('ws_send_dropped_closed');
        throw new SocketNotOpenError();
    }
    socket.send(payload);
}

// Bounded poll for WS to reach OPEN. Polling (not listeners) keeps
// ConnectionContext the sole owner of the socket close lifecycle.
export async function waitForSocketOpen(
    socket: WebSocket,
    timeoutMs: number,
    pollIntervalMs: number
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const state = socket.readyState;
        if (state === WS_OPEN) return true;
        if (state !== 0 /* CONNECTING */) return false;
        await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
    }
    return socket.readyState === WS_OPEN;
}
