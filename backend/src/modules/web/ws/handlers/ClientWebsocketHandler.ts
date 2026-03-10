import type {IncomingMessage} from 'node:http';
import log4js from 'log4js';
import WebSocket from 'ws';
import type {user_t} from '../../../../types';
import * as Observability from '../../../Observability';
import {getUserFromToken} from '../../../user';
import type MessageHandler from '../MessageHandler';
import AbstractWebsocketHandler, {
    type WebSocketExt
} from './AbstractWebsocketHandler';

const logger = log4js.getLogger('client-ws');
const MAX_AUTH_QUEUE = 25;

export default class ClientWebsocketHandler extends AbstractWebsocketHandler {
    #messageHandler: MessageHandler;

    constructor(handler: MessageHandler) {
        super();
        this.#messageHandler = handler;
    }

    protected override async _handleWebsocket(
        socket: WebSocketExt,
        request: IncomingMessage
    ) {
        const msgQueue: WebSocket.RawData[] = [];

        const token = String(request.headers.token);
        let user: user_t;

        // Set up message listener FIRST to capture messages during token validation
        socket.on('message', async (data) => {
            if (user === undefined) {
                if (msgQueue.length >= MAX_AUTH_QUEUE) {
                    logger.warn(
                        'Auth queue full (%d), dropping message',
                        MAX_AUTH_QUEUE
                    );
                    Observability.incrementCounter('ws_auth_queue_drops');
                    return;
                }
                msgQueue.push(data);
                return;
            }

            Observability.recordWsMessage('client:message');
            this.#messageHandler.handleMessageRaw(socket, data, user);
        });

        try {
            const newUser = await getUserFromToken(token);
            if (!newUser) {
                logger.error('Cannot get user from token, terminating WS');
                socket.terminate();
                return;
            }
            user = newUser;
            Observability.setWsClientCount(this._server.clients.size);
            Observability.incrementCounter('ws_connections');
            socket.on('close', () => {
                Observability.setWsClientCount(this._server.clients.size);
                Observability.incrementCounter('ws_disconnections');
            });
            // Process any messages that arrived during token validation
            for (const msg of msgQueue) {
                this.#messageHandler.handleMessageRaw(socket, msg, user);
            }
            msgQueue.length = 0;
        } catch (error) {
            logger.error('Client WS auth error: %s', error);
            socket.terminate();
            msgQueue.length = 0;
        }
    }

    notifyAll(msg: string) {
        for (const client of this._server.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(msg);
            }
        }
    }
}
