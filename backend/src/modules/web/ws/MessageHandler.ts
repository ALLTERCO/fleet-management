import log4js from 'log4js';
import type WebSocket from 'ws';
import {tuning} from '../../../config';
import type CommandSender from '../../../model/CommandSender';
import * as AuditLogger from '../../../modules/AuditLogger';
import * as Commander from '../../../modules/Commander';
import * as DeviceCollector from '../../../modules/DeviceCollector';
import * as Observability from '../../../modules/Observability';
import {buildOutgoingJsonRpc} from '../../../rpc/builders';
import RpcError from '../../../rpc/RpcError';
import type {JsonRpcIncoming} from '../../../rpc/types';
import {parseIncomingJsonRpc} from '../../../rpc/types';
import type {Sendable, user_t} from '../../../types';
import {UNAUTHORIZED_USER} from '../../user';
import {formatError} from '../../util/formatError';
import {truncateForDebugLog} from '../../util/truncateForDebugLog';
import {enforceRateLimit} from '../rateLimit';
import {canExecuteOnDevice} from '../utils/devicePermissions';
import {senderFromUser} from '../utils/senderFromRequest';
import {ConnectionContext} from './ConnectionContext';
import {auditRelay} from './relayAudit';
import {safeSocketSend} from './safeSocketSend';

const logger = log4js.getLogger('message-handler');

let internalCmdCount = 0;
let relayCmdCount = 0;
let parseErrors = 0;

Observability.registerModule('wsCommands', {
    stats: () => ({
        internalCommands: internalCmdCount,
        relayCommands: relayCmdCount,
        parseErrors
    }),
    topology: {
        role: 'source',
        cluster: 'clients',
        zone: 'command_plane',
        downstreams: ['commander', 'audit'],
        label: 'WS Commands',
        description: 'Client WebSocket command handler',
        route: '/monitoring/commands'
    }
});

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
                // maxPayload bounds bytes, not element count.
                if (parsed.length > tuning.ws.maxBatchSize) {
                    logger.warn(
                        'ws batch size %d exceeds max %d',
                        parsed.length,
                        tuning.ws.maxBatchSize
                    );
                    const rpcError = RpcError.InvalidRequest(
                        `batch size exceeds maximum ${tuning.ws.maxBatchSize}`
                    ).getRpcError();
                    safeSocketSend(socket, JSON.stringify(rpcError));
                    return;
                }
                for (const single of parsed) {
                    this.handleIncomingMessage(socket, single, user);
                }
                return;
            }
            this.handleIncomingMessage(socket, parsed, user);
        } catch (error) {
            parseErrors++;
            logger.warn('error json parsing ws data', formatError(error));
            const rpcError = RpcError.InvalidRequest().getRpcError();
            safeSocketSend(socket, JSON.stringify(rpcError));
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
        data: JsonRpcIncoming,
        user?: user_t
    ) {
        if (!parseIncomingJsonRpc(data)) {
            logger.warn('error parsing incoming ws data');
            const rpcError = RpcError.InvalidRequest().getRpcError();
            safeSocketSend(socket, JSON.stringify(rpcError));
            return;
        }

        // handle internal commands

        if (
            typeof data.dst === 'string' &&
            data.dst?.toUpperCase() === 'FLEET_MANAGER'
        ) {
            // FM-targeted RPC mirrors HTTP: rate-limit before dispatch.
            try {
                enforceRateLimit(
                    user?.username ?? '',
                    data.method,
                    user?.organizationId ?? null
                );
            } catch (err) {
                if (err instanceof RpcError) {
                    safeSocketSend(
                        socket,
                        JSON.stringify(err.getRpcError(data.id))
                    );
                    return;
                }
                throw err;
            }
            internalCmdCount++;
            // Fire-and-forget: the method handles its own awaited errors, but a
            // throw in its synchronous section would otherwise escape as an
            // unhandled rejection (logged + counted, non-fatal — see
            // handleUnhandledRejection).
            this.handleInternalCommands(socket, data, user).catch((err) => {
                logger.error(
                    'handleInternalCommands failed method:[%s]: %s',
                    data.method,
                    err?.message ?? err
                );
                safeSocketSend(
                    socket,
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: data.id,
                        src: 'FLEET_MANAGER',
                        dst: data.src,
                        error: {message: 'Internal error', code: -32000}
                    })
                );
            });
            return;
        }

        // Raw device relay — intentional, keep it. Lets clients call device RPC
        // methods FM has no typed wrapper for yet, and is the device-vs-FM debug
        // probe (works raw but fails via a wrapper => bug is ours). Do not gate
        // this to the typed component surface.
        if (typeof data.dst !== 'undefined') {
            relayCmdCount++;
            this.#handleRelayCommands(socket, data, user);
            return;
        }

        logger.warn('unhandled ws data');
        // always respond (as per protocol)
        const rpcError = RpcError.InvalidParams().getRpcError();
        safeSocketSend(socket, JSON.stringify(rpcError));
    }

    /**
     * Relay one or more commands to connected devices
     * @param socket Websocket sending the command
     * @param data parsed data
     */
    #handleRelayCommands(
        socket: Sendable | WebSocket.WebSocket,
        data: JsonRpcIncoming,
        user?: user_t
    ) {
        user ??= UNAUTHORIZED_USER;
        if (typeof data.dst === 'string') {
            void this.#singleRelayCommand(socket, data.dst, data, user);
        } else if (typeof data.dst === 'object' && Array.isArray(data.dst)) {
            const targets = data.dst.filter(
                (dst): dst is string => typeof dst === 'string'
            );
            // Bound the fan-out: an unbounded dst array amplifies into N authz
            // checks before any rate limit applies.
            if (targets.length > tuning.ws.maxBatchSize) {
                const rpcError = RpcError.InvalidRequest(
                    `relay target count exceeds maximum ${tuning.ws.maxBatchSize}`
                ).getRpcError(data.id);
                safeSocketSend(socket, JSON.stringify(rpcError));
                return;
            }
            for (const dst of targets) {
                void this.#singleRelayCommand(socket, dst, data, user);
            }
        } else {
            const rpcError =
                RpcError.InvalidRequest('Bad dst argument').getRpcError();
            safeSocketSend(socket, JSON.stringify(rpcError));
        }
    }

    /**
     * Relay an rpc command to connected device
     * @param socket Websocket sending the command
     * @param data parsed data
     * @param shellyID id of the receiver
     */
    async #singleRelayCommand(
        socket: Sendable | WebSocket.WebSocket,
        shellyID: string,
        data: JsonRpcIncoming,
        user: user_t
    ) {
        logger.debug(
            'MessageHandler.singleRelayCommand dst=%s method=%s params=%s',
            shellyID,
            data.method,
            truncateForDebugLog(
                AuditLogger.redactSensitiveParams(data.method, data.params),
                tuning.ws.debugLogMaxBytes
            )
        );
        // Throttle before the existence and permission checks so a flood of
        // denied or unknown-device relays can't amplify.
        try {
            enforceRateLimit(
                user.username,
                data.method,
                user.organizationId ?? null
            );
        } catch (err) {
            if (err instanceof RpcError) {
                safeSocketSend(
                    socket,
                    JSON.stringify(err.getRpcError(data.id))
                );
                return;
            }
            throw err;
        }
        const shelly = DeviceCollector.getDevice(shellyID);
        if (shelly === undefined) {
            const rpcError = RpcError.DeviceNotFound().getRpcError(data.id);
            safeSocketSend(socket, JSON.stringify(rpcError));
            return;
        }

        const ws = 'on' in socket ? (socket as WebSocket.WebSocket) : undefined;
        // Fail closed: every relay is permission-checked. canExecuteOnDevice
        // denies on internal error, so it never throws into this void relay.
        if (!(await canExecuteOnDevice(user, shellyID, ws))) {
            const rpcError = RpcError.Domain('PermissionDenied', {
                message: 'Permission denied for device',
                details: {resourceType: 'device', identifier: shellyID}
            }).getRpcError(data.id);
            safeSocketSend(socket, JSON.stringify(rpcError));
            return;
        }

        const {method, params, src, id} = data;
        shelly.sendRPC(method, params, true).then(
            (resp) => {
                auditRelay(user, method, params, {success: true});
                const result = buildOutgoingJsonRpc(id, src, resp);
                safeSocketSend(socket, JSON.stringify(result));
            },
            (err) => {
                auditRelay(user, method, params, {
                    success: false,
                    errorMessage:
                        err instanceof Error ? err.message : String(err)
                });
                logger.error(
                    'Relay RPC failed dst:[%s] method:[%s] err:[%s]',
                    shellyID,
                    method,
                    String(err)
                );
                // If the device layer already threw an `RpcError` (e.g.
                // `DeviceOffline` with a structured `data.details`),
                // forward it unchanged so the caller can dispatch on the
                // original domain code. Only wrap unknown / non-RpcError
                // throws as `DeviceOperationFailed`.
                const rpcError = (
                    err instanceof RpcError
                        ? err
                        : RpcError.DeviceFailed(
                              `relay ${method}`,
                              err,
                              shellyID
                          )
                ).getRpcError(id);
                safeSocketSend(socket, JSON.stringify(rpcError));
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
        data: JsonRpcIncoming,
        user?: user_t
    ) {
        const params = data.params;

        user ??= UNAUTHORIZED_USER;

        const existingCtx = ConnectionContext.forSocket(
            socket as WebSocket.WebSocket
        );
        // Reuse the connection's sender so V2 effective shape stays loaded.
        // Per-message construction is the HTTP /rpc Sendable shim path only.
        let sender: CommandSender;
        try {
            if (existingCtx) {
                sender = existingCtx.sender;
            } else {
                sender = await senderFromUser(user, {
                    socket: socket as WebSocket.WebSocket
                });
            }
        } catch (err: any) {
            logger.error(
                'senderFromUser failed for method:[%s]: %s',
                data.method,
                err?.message ?? err
            );
            safeSocketSend(
                socket,
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: data.id,
                    src: 'FLEET_MANAGER',
                    dst: data.src,
                    error: {
                        message: 'authorization unavailable',
                        code: -32000
                    }
                })
            );
            return;
        }

        logger.debug(
            'Received %s with %s from %s:%s',
            data.method,
            truncateForDebugLog(
                AuditLogger.redactSensitiveParams(data.method, data.params),
                tuning.ws.debugLogMaxBytes
            ),
            user.username,
            user.group
        );

        // ctx is undefined for HTTP /rpc Sendable shim (no .on).
        const ctx =
            'on' in socket
                ? ConnectionContext.forSocket(socket as WebSocket.WebSocket)
                : undefined;

        try {
            const result = await Commander.exec(
                sender,
                data.method,
                params,
                ctx
            );
            safeSocketSend(
                socket,
                JSON.stringify(buildOutgoingJsonRpc(data.id, data.src, result))
            );
        } catch (err: any) {
            logger.error(
                'Sending error:[%s] method:[%s] params:[%s]',
                err?.message,
                data.method,
                truncateForDebugLog(
                    AuditLogger.redactSensitiveParams(data.method, params),
                    tuning.ws.debugLogMaxBytes
                )
            );
            // Forward the full error envelope — Commander throws the result
            // of `RpcError.getErrorObject()`, which carries `data.details`
            // (resourceType, operation, cause, etc.) for domain errors.
            // Dropping it here previously hid that context from clients and
            // broke `isResourceNotFound(err, type)` style matchers.
            const errorPayload: Record<string, unknown> = {
                message: err?.message ?? 'Internal error',
                code: err?.code ?? -1
            };
            if (err?.data !== undefined) errorPayload.data = err.data;
            safeSocketSend(
                socket,
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: data.id,
                    src: 'FLEET_MANAGER',
                    dst: data.src,
                    error: errorPayload
                })
            );
        }
    }
}
