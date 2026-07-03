import type {IncomingMessage} from 'node:http';
import log4js from 'log4js';
import type WebSocket from 'ws';
import {tuning} from '../../../../config';
import type CommandSender from '../../../../model/CommandSender';
import type {user_t} from '../../../../types';
import * as Observability from '../../../Observability';
import {getUserFromToken} from '../../../user';
import {ConnectionContext} from '../ConnectionContext';
import {CLOSE_AUTH_FAILED} from '../closeCodes';
import type MessageHandler from '../MessageHandler';
import AbstractWebsocketHandler, {
    type WebSocketExt
} from './AbstractWebsocketHandler';
import {resolveClientSourceIp} from './shellyProxyTrust';

const logger = log4js.getLogger('client-ws');

export default class ClientWebsocketHandler extends AbstractWebsocketHandler {
    #messageHandler: MessageHandler;

    constructor(handler: MessageHandler) {
        super({noServer: true}, tuning.ws.clientHeartbeatMs);
        this.#messageHandler = handler;
    }

    protected override async _handleWebsocket(
        socket: WebSocketExt,
        request: IncomingMessage
    ) {
        const msgQueue: WebSocket.RawData[] = [];

        const token = request.headers.token
            ? String(request.headers.token)
            : '';
        if (!token) {
            socket.close(CLOSE_AUTH_FAILED, 'Unauthorized');
            return;
        }
        let user: user_t;

        // Set up message listener FIRST to capture messages during token validation
        socket.on('message', async (data) => {
            if (user === undefined) {
                if (msgQueue.length >= tuning.ws.authQueueMax) {
                    logger.warn(
                        'Auth queue full (%d), dropping message',
                        tuning.ws.authQueueMax
                    );
                    Observability.incrementCounter('ws_auth_queue_drops');
                    return;
                }
                msgQueue.push(data);
                return;
            }

            const ctx = ConnectionContext.forSocket(socket);
            if (ctx) {
                let fresh: CommandSender | null;
                try {
                    fresh = await ctx.ensureFreshSender();
                } catch (err) {
                    // Same posture as the handshake: an auth-refresh error
                    // closes this socket, it must not escape the listener.
                    logger.error('token refresh failed, closing WS: %s', err);
                    socket.close(CLOSE_AUTH_FAILED, 'Token refresh failed');
                    return;
                }
                if (fresh === null) {
                    socket.close(CLOSE_AUTH_FAILED, 'Token invalidated');
                    return;
                }
            }
            Observability.recordWsMessage('client:message');
            this.#messageHandler.handleMessageRaw(
                socket,
                data,
                ctx?.user ?? user
            );
        });

        try {
            // getUserFromToken has a rejected-token cache: tokens that recently
            // failed introspection are fast-rejected without hitting Zitadel.
            // This stops stale browser tabs from hammering the introspect endpoint.
            const newUser = await getUserFromToken(token);
            if (!newUser) {
                logger.error('Cannot get user from token, closing WS (4401)');
                socket.close(CLOSE_AUTH_FAILED, 'Unauthorized');
                return;
            }
            Observability.setWsClientCount(this._server.clients.size);
            Observability.incrementCounter('ws_connections');
            const sourceIp = resolveClientSourceIp(
                request,
                tuning.ws.clientTrustedProxyCidrs
            );
            // Register ctx BEFORE flipping `user` so the message-handler
            // closure can never see a defined user without a matching ctx
            // (otherwise System.Subscribe and other ws-only RPCs race the
            // ctx registration and reject with "telemetry_channel unavailable").
            const ctx = await ConnectionContext.fromAuthenticatedSocket(
                socket,
                newUser,
                sourceIp,
                token
            );
            user = newUser;
            // Cleanup runs through the shared lifecycle owner.
            ctx.onClose(() => {
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
            socket.close(CLOSE_AUTH_FAILED, 'Unauthorized');
            msgQueue.length = 0;
        }
    }
}
