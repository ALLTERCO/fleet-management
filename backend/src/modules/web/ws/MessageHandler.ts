import log4js from 'log4js';
import type WebSocket from 'ws';
import * as Commander from '../../../modules/Commander';
import * as Observability from '../../../modules/Observability';
import RpcError from '../../../rpc/RpcError';
import type {Sendable, user_t} from '../../../types';
const logger = log4js.getLogger('message-handler');
import CommandSender from '../../../model/CommandSender';
import * as DeviceCollector from '../../../modules/DeviceCollector';
import {buildOutgoingJsonRpc} from '../../../rpc/builders';
import type {JsonRpcIncomming} from '../../../rpc/types';
import {parseIncomingJsonRpc} from '../../../rpc/types';
import {UNAUTHORIZED_USER} from '../../user';
import {canExecuteOnDevice} from '../utils/devicePermissions';

let internalCmdCount = 0;
let relayCmdCount = 0;
let parseErrors = 0;

Observability.registerModule('wsCommands', () => ({
    internalCommands: internalCmdCount,
    relayCommands: relayCmdCount,
    parseErrors
}));

export default class MessageHandler {
    /**
     * Handle one incoming messages or array of incoming messages
     * @param socket Websocket sending the command
     * @param data parsed data
     * @param user user with their permissions
     */
    handleMessageRaw(
        socket: WebSocket.WebSocket,
        data: WebSocket.RawData,
        user?: user_t
    ) {
        try {
            const parsed = JSON.parse(data.toString());
            if (typeof parsed === 'object' && Array.isArray(parsed)) {
                for (const single of parsed) {
                    this.handleIncomingMessage(socket, single, user);
                }
                return;
            }
            this.handleIncomingMessage(socket, parsed, user);
        } catch (error) {
            parseErrors++;
            logger.warn('error json parsing ws data', String(error));
            const rpcError = RpcError.InvalidRequest().getRpcError();
            socket.send(JSON.stringify(rpcError));
        }
    }

    /**
     * Handle single incoming message
     * @param socket Websocket sending the command
     * @param data parsed data
     * @param user user with their permissions
     */
    handleIncomingMessage(
        socket: Sendable | WebSocket.WebSocket,
        data: JsonRpcIncomming,
        user?: user_t
    ) {
        if (!parseIncomingJsonRpc(data)) {
            logger.warn('error parsing incoming ws data');
            const rpcError = RpcError.InvalidRequest().getRpcError();
            socket.send(JSON.stringify(rpcError));
            return;
        }

        // handle internal commands

        if (
            typeof data.dst === 'string' &&
            data.dst?.toUpperCase() === 'FLEET_MANAGER'
        ) {
            internalCmdCount++;
            this.handleInternalCommands(socket, data, user);
            return;
        }

        // relay commands to connected devices

        if (typeof data.dst !== 'undefined') {
            relayCmdCount++;
            this.#handleRelayCommands(socket, data, user);
            return;
        }

        logger.warn('unhandled ws data');
        // always respond (as per protocol)
        const rpcError = RpcError.InvalidParams().getRpcError();
        socket.send(JSON.stringify(rpcError));
    }

    /**
     * Relay one or more commands to connected devices
     * @param socket Websocket sending the command
     * @param data parsed data
     */
    #handleRelayCommands(
        socket: Sendable | WebSocket.WebSocket,
        data: JsonRpcIncomming,
        user?: user_t
    ) {
        if (typeof data.dst === 'string') {
            this.#singleRelayCommand(socket, data.dst, data, user);
        } else if (typeof data.dst === 'object' && Array.isArray(data.dst)) {
            for (const dst of data.dst)
                if (typeof dst === 'string') {
                    this.#singleRelayCommand(socket, dst, data, user);
                }
        } else {
            const rpcError = RpcError.InvalidRequest('Bad dst argument');
            socket.send(JSON.stringify(rpcError));
        }
    }

    /**
     * Relay an rpc command to connected device
     * @param socket Websocket sending the command
     * @param data parsed data
     * @param shellyID id of the receiver
     */
    #singleRelayCommand(
        socket: Sendable | WebSocket.WebSocket,
        shellyID: string,
        data: JsonRpcIncomming,
        user?: user_t
    ) {
        logger.debug(
            'MessageHandler.singleRelayCommand',
            shellyID,
            JSON.stringify(data)
        );
        const shelly = DeviceCollector.getDevice(shellyID);
        if (shelly === undefined) {
            const rpcError = RpcError.DeviceNotFound().getRpcError(data.id);
            socket.send(JSON.stringify(rpcError));
            return;
        }

        if (user && !canExecuteOnDevice(user, shellyID)) {
            const rpcError = RpcError.Server(
                'Permission denied for device'
            ).getRpcError(data.id);
            socket.send(JSON.stringify(rpcError));
            return;
        }

        const {method, params, src, id} = data;
        shelly.sendRPC(method, params, true).then(
            (resp) => {
                const result = buildOutgoingJsonRpc(id, src, resp);
                socket.send(JSON.stringify(result));
            },
            (err) => {
                logger.error(
                    'Relay RPC failed dst:[%s] method:[%s] err:[%s]',
                    shellyID,
                    method,
                    String(err)
                );
                const rpcError =
                    RpcError.Server('Device RPC failed').getRpcError(id);
                socket.send(JSON.stringify(rpcError));
            }
        );
    }

    /**
     * Handle commands targeted at the Fleet Manager itself
     * @param socket Websocket sending the command
     * @param data parsed data
     * @param user user with permissions
     */
    async handleInternalCommands(
        socket: Sendable | WebSocket.WebSocket,
        data: JsonRpcIncomming,
        user?: user_t
    ) {
        const params = data.params;

        user ??= UNAUTHORIZED_USER;

        const sender = new CommandSender(user.permissions, user.group, {
            socket: socket as WebSocket.WebSocket,
            permissionConfig: user.permissionConfig,
            username: user.username
        });

        logger.debug(
            `Received ${data.method} with ${JSON.stringify(data.params || {})} from ${user.username}:${user.group}`
        );

        try {
            const result = await Commander.exec(sender, data.method, params);
            socket.send(
                JSON.stringify(buildOutgoingJsonRpc(data.id, data.src, result))
            );
        } catch (err: any) {
            logger.error(
                'Sending error:[%s] method:[%s] params:[%s]',
                err?.message,
                data.method,
                params
            );
            socket.send(JSON.stringify(err));
        }
    }
}
