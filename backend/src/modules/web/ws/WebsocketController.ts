import type * as http from 'node:http';
import {parse} from 'node:url';
import {getLogger} from 'log4js';

const logger = getLogger('ws-upgrade');

import type {Duplex} from 'node:stream';
import {handleDeviceProxyWsUpgrade} from '../routes/device-proxy';
import {handleWsTransportUpgrade} from '../ws-transport-proxy';
import type ClientWebsocketHandler from './handlers/ClientWebsocketHandler';
import type ShellyWebsocketHandler from './handlers/ShellyWebsocketHandler';

function destroySocket(
    socket: Duplex,
    httpTextStatus: '401 Unauthorized' | '403 Forbidden'
) {
    logger.debug('destroying websocket reason:[%s]', httpTextStatus);
    socket.write(`HTTP/1.1 ${httpTextStatus}\r\n\r\n`);
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
                logger.debug('destroying bad socket');
                socket.destroy();
                return;
            }
            const {pathname} = parse(request.url);

            if (pathname == null) {
                logger.debug('destroying bad socket');
                socket.destroy();
                return;
            }

            if (pathname.startsWith('/node-red')) return;

            // handle without authentication
            if (pathname === '/shelly') {
                this.#shellyHandler.handleUpgrade(request, socket, head);
                return;
            }

            // Extract authentication
            const protocol = request.headers['sec-websocket-protocol'];
            let auth: string | undefined;

            if (typeof protocol === 'string' && protocol.length > 0) {
                auth = `Bearer ${protocol}`;
            } else {
                const authorization = request.headers.authorization;
                if (
                    typeof authorization === 'string' &&
                    authorization.length > 0
                ) {
                    auth = authorization;
                }
            }
            let token: string | undefined;

            if (typeof auth === 'string' && auth.length > 0) {
                token = auth.split(' ').at(-1)!;
            }

            logger.info('websocket token:[%s]', token);

            if (pathname === '/') {
                request.headers.token = token;
                this.#clientHandler.handleUpgrade(request, socket, head);
                return;
            }

            // WS Transport Proxy: /api/device-proxy/{shellyID}/ws-transport
            // Raw WS-to-WS relay — browser and device both connect here, FM pipes frames
            if (
                pathname.startsWith('/api/device-proxy/') &&
                pathname.endsWith('/ws-transport')
            ) {
                logger.info('ws-transport WS upgrade: path=[%s]', pathname);
                handleWsTransportUpgrade(request, socket, head);
                return;
            }

            // Device proxy WebSocket: /api/device-proxy/{shellyID}/rpc
            // Used by Shelly GUI (firmware 1.8.0+) to communicate with device via FM proxy
            if (
                pathname.startsWith('/api/device-proxy/') &&
                pathname.endsWith('/rpc')
            ) {
                logger.info('device-proxy WS upgrade: path=[%s]', pathname);
                handleDeviceProxyWsUpgrade(request, socket, head);
                return;
            }

            socket.destroy();
        });
    }
}
