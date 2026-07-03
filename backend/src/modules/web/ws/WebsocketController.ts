import type * as http from 'node:http';
import type {Duplex} from 'node:stream';
import {getLogger} from 'log4js';
import {DEV_MODE, tuning} from '../../../config';
import {isNodeRedPath} from '../authToken';
import {isViteHmrUpgrade, proxyViteHmrUpgrade} from '../viteDevProxy';
import type ClientWebsocketHandler from './handlers/ClientWebsocketHandler';
import type ShellyWebsocketHandler from './handlers/ShellyWebsocketHandler';

const logger = getLogger('ws-upgrade');

/** Extract bearer token from sec-websocket-protocol or authorization header */
function extractToken(request: http.IncomingMessage): string | undefined {
    // Browser WebSocket API can't set custom headers.
    // Token is sent via sec-websocket-protocol instead.
    const protocol = request.headers['sec-websocket-protocol'];
    if (typeof protocol === 'string' && protocol.length > 0) {
        return protocol;
    }

    // Fallback: standard Authorization header (non-browser clients)
    const authorization = request.headers.authorization;
    if (typeof authorization === 'string') {
        const bearer = authorization.split(' ').at(-1);
        if (bearer && bearer.length > 0) return bearer;
    }

    return undefined;
}

/** Reject WebSocket upgrade with proper HTTP response before handshake completes */
function rejectUpgrade(
    socket: Duplex,
    status: '401 Unauthorized' | '403 Forbidden'
) {
    logger.debug('rejecting websocket upgrade: %s', status);
    socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
    socket.destroy();
}

export default class WebsocketController {
    #server: http.Server;
    #shellyHandler: ShellyWebsocketHandler;
    #clientHandler: ClientWebsocketHandler;

    constructor(
        server: http.Server,
        shellyHandler: ShellyWebsocketHandler,
        clientHandler: ClientWebsocketHandler
    ) {
        this.#server = server;
        this.#shellyHandler = shellyHandler;
        this.#clientHandler = clientHandler;
        this.#handleUpgrades();
    }

    #handleUpgrades() {
        this.#server.on('upgrade', (request, socket, head) => {
            if (request.url === undefined) {
                logger.debug('destroying socket: missing url');
                socket.destroy();
                return;
            }
            const {pathname} = new URL(request.url, 'http://localhost');

            if (tuning.nodeRed.enabled && isNodeRedPath(pathname)) {
                return;
            }

            // /shelly — device WS endpoint. Open by construction: Shelly device
            // firmware has no field for outbound auth headers, so any shared-secret
            // gate here would either lock out the whole fleet or authenticate
            // nothing real. The waiting-room (§WaitingRoom module) admits each
            // device individually before any RPC privilege is granted. Real
            // per-device authentication needs per-device credentials (e.g. unique
            // certificate uploaded at install) — planned as future hardening.
            if (pathname === '/shelly') {
                this.#shellyHandler.handleUpgrade(request, socket, head);
                return;
            }

            // Dev: Vite's HMR socket shares '/' with the client WS; tell them
            // apart by subprotocol and forward HMR to the Vite dev server.
            if (DEV_MODE && pathname === '/' && isViteHmrUpgrade(request)) {
                proxyViteHmrUpgrade(request, socket, head);
                return;
            }

            // All other paths require authentication
            const token = extractToken(request);
            logger.debug('websocket auth attempt, token present: %s', !!token);

            // Authenticated client WebSocket.
            if (pathname === '/') {
                if (!token) {
                    rejectUpgrade(socket, '401 Unauthorized');
                    return;
                }
                request.headers.token = token;
                this.#clientHandler.handleUpgrade(request, socket, head);
                return;
            }

            logger.debug('destroying socket: unknown path %s', pathname);
            socket.destroy();
        });
    }
}
