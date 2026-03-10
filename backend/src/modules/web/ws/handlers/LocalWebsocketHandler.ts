import log4js from 'log4js';
import type {WebComponentConfig} from '../../../../model/component/WebComponent';
import type {user_t} from '../../../../types';
import {NODE_RED_USER, getNodeRedServiceUser} from '../../../user';
import type MessageHandler from '../MessageHandler';
import AbstractWebsocketHandler, {
    type WebSocketExt
} from './AbstractWebsocketHandler';

const logger = log4js.getLogger('local-ws');

export default class LocalWebsocketHandler extends AbstractWebsocketHandler {
    #messageHandler: MessageHandler;
    #serviceUser: user_t = NODE_RED_USER;

    constructor(handler: MessageHandler, config: Required<WebComponentConfig>) {
        super({host: '127.0.0.1', port: config.port + 1});
        this.#messageHandler = handler;

        // Initialize service user asynchronously
        this.#initServiceUser();
    }

    async #initServiceUser() {
        try {
            this.#serviceUser = await getNodeRedServiceUser();
        } catch (error) {
            logger.warn(
                'Failed to get Node-RED service user, using default: %s',
                error
            );
        }
    }

    protected override _handleWebsocket(socket: WebSocketExt) {
        socket.on('message', (data) => {
            this.#messageHandler.handleMessageRaw(
                socket,
                data,
                this.#serviceUser
            );
        });
    }
}
