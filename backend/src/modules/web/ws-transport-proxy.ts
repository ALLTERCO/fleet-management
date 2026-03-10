/**
 * WS Transport Proxy — Experimental
 *
 * Creates a raw WebSocket relay between the browser (device GUI JS) and
 * the device firmware.  Both sides connect TO Fleet Manager; FM pairs
 * them and pipes messages bidirectionally with zero parsing.
 *
 * Expected flow:
 *   1. Browser loads device GUI iframe with ?shelly_addr pointing here
 *   2. Device GUI JS opens WS to /api/device-proxy/:shellyID/ws-transport?token=…
 *   3. Device firmware (triggered by shelly_addr) opens WS to the same path
 *   4. FM pairs the two WebSockets and pipes raw frames
 *
 * Path: /api/device-proxy/:shellyID/ws-transport
 *
 * Browser connections carry a ?token= param (authenticated).
 * Device connections arrive without a token (unauthenticated, identified by shellyID).
 */

import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import log4js from 'log4js';
import WebSocket from 'ws';
import type {user_t} from '../../types';
import * as Observability from '../Observability';
import {getUserFromToken} from '../user';
import {canExecuteOnDevice} from './utils/devicePermissions';

const logger = log4js.getLogger('ws-transport');

// ============================================================================
// State
// ============================================================================

interface PendingConnection {
    ws: WebSocket;
    role: 'browser' | 'device';
    timer: ReturnType<typeof setTimeout>;
}

interface ActiveRelay {
    browser: WebSocket;
    device: WebSocket;
}

const pending = new Map<string, PendingConnection>();
const relays = new Map<string, ActiveRelay>();

const PAIR_TIMEOUT_MS = 30_000; // 30s to wait for the other side

Observability.registerModule('wsTransport', () => ({
    pendingConnections: pending.size,
    activeRelays: relays.size
}));

// ============================================================================
// WebSocket Server (noServer mode — upgrades handled manually)
// ============================================================================

const wss = new WebSocket.Server({noServer: true});

/**
 * Entry point — called from WebsocketController on upgrade.
 */
export function handleWsTransportUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
) {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
}

// ============================================================================
// Connection handler
// ============================================================================

wss.on('connection', async (ws: WebSocket, request: IncomingMessage) => {
    // ---- Parse URL ----
    let shellyID: string;
    let token: string | undefined;

    try {
        const url = new URL(request.url || '', 'http://localhost');
        const match = url.pathname.match(
            /\/api\/device-proxy\/([^/]+)\/ws-transport/
        );
        if (!match) {
            ws.close(4000, 'Invalid path');
            return;
        }
        shellyID = decodeURIComponent(match[1]);
        token = url.searchParams.get('token') || undefined;
    } catch {
        ws.close(4000, 'Invalid URL');
        return;
    }

    // ---- Determine role ----
    // Token present → browser.  No token → device.
    let role: 'browser' | 'device';

    if (token) {
        // Authenticate browser connection
        let user: user_t | undefined;
        try {
            user = await getUserFromToken(token);
        } catch {
            // token validation failed
        }
        if (!user) {
            logger.warn('[%s] browser auth failed', shellyID);
            ws.close(4001, 'Authentication failed');
            return;
        }
        if (!canExecuteOnDevice(user, shellyID)) {
            logger.warn(
                '[%s] browser access denied for %s',
                shellyID,
                user.username
            );
            ws.close(4003, 'Access denied');
            return;
        }
        role = 'browser';
        logger.info(
            '[%s] browser connected (user: %s)',
            shellyID,
            user.username
        );
    } else {
        role = 'device';
        logger.info(
            '[%s] device connected (no token — assuming device reverse proxy)',
            shellyID
        );
    }

    // ---- Check for existing relay ----
    if (relays.has(shellyID)) {
        logger.warn(
            '[%s] relay already active, rejecting new %s connection',
            shellyID,
            role
        );
        ws.close(4008, 'Relay already active');
        return;
    }

    // ---- Pair with pending connection ----
    const other = pending.get(shellyID);

    if (other && other.role !== role) {
        // Other side is already waiting — establish relay!
        clearTimeout(other.timer);
        pending.delete(shellyID);

        const browser = role === 'browser' ? ws : other.ws;
        const device = role === 'device' ? ws : other.ws;

        startRelay(shellyID, browser, device);
    } else if (other && other.role === role) {
        // Same role connected again — replace the old one
        logger.warn(
            '[%s] duplicate %s connection, replacing previous',
            shellyID,
            role
        );
        clearTimeout(other.timer);
        other.ws.close(4009, 'Replaced by new connection');
        storePending(shellyID, ws, role);
    } else {
        // First to arrive — wait for the other side
        storePending(shellyID, ws, role);
    }
});

// ============================================================================
// Helpers
// ============================================================================

function storePending(
    shellyID: string,
    ws: WebSocket,
    role: 'browser' | 'device'
) {
    const timer = setTimeout(() => {
        logger.warn(
            '[%s] %s timed out waiting for %s side (%ds)',
            shellyID,
            role,
            role === 'browser' ? 'device' : 'browser',
            PAIR_TIMEOUT_MS / 1000
        );
        pending.delete(shellyID);
        ws.close(4010, 'Pair timeout — other side did not connect');
    }, PAIR_TIMEOUT_MS);

    pending.set(shellyID, {ws, role, timer});

    logger.info(
        '[%s] %s waiting for %s side…',
        shellyID,
        role,
        role === 'browser' ? 'device' : 'browser'
    );

    // If the WS closes before pairing, clean up
    ws.on('close', () => {
        const entry = pending.get(shellyID);
        if (entry && entry.ws === ws) {
            clearTimeout(entry.timer);
            pending.delete(shellyID);
            logger.info('[%s] %s disconnected while waiting', shellyID, role);
        }
    });
}

function startRelay(shellyID: string, browser: WebSocket, device: WebSocket) {
    logger.info(
        '[%s] === RELAY ESTABLISHED (browser <-> device) ===',
        shellyID
    );

    relays.set(shellyID, {browser, device});

    let messageCount = 0;

    // Queue any messages that arrived before pairing
    // (the WS library buffers them automatically)

    // Browser → Device
    browser.on('message', (data, isBinary) => {
        messageCount++;
        if (device.readyState === WebSocket.OPEN) {
            device.send(data, {binary: isBinary});
            if (messageCount <= 5) {
                const preview = isBinary
                    ? `[binary ${(data as Buffer).length}B]`
                    : data.toString().substring(0, 120);
                logger.debug('[%s] browser→device: %s', shellyID, preview);
            }
        }
    });

    // Device → Browser
    device.on('message', (data, isBinary) => {
        messageCount++;
        if (browser.readyState === WebSocket.OPEN) {
            browser.send(data, {binary: isBinary});
            if (messageCount <= 5) {
                const preview = isBinary
                    ? `[binary ${(data as Buffer).length}B]`
                    : data.toString().substring(0, 120);
                logger.debug('[%s] device→browser: %s', shellyID, preview);
            }
        }
    });

    // Cleanup on close
    const cleanup = (source: string) => {
        logger.info(
            '[%s] relay closed (initiated by %s), total messages: %d',
            shellyID,
            source,
            messageCount
        );
        relays.delete(shellyID);
        if (browser.readyState === WebSocket.OPEN) browser.close();
        if (device.readyState === WebSocket.OPEN) device.close();
    };

    browser.on('close', () => cleanup('browser'));
    device.on('close', () => cleanup('device'));

    browser.on('error', (err) => {
        logger.error('[%s] browser WS error: %s', shellyID, err.message);
    });
    device.on('error', (err) => {
        logger.error('[%s] device WS error: %s', shellyID, err.message);
    });
}
