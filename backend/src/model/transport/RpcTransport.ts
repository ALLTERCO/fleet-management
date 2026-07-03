/* eslint-disable no-undef */
import * as log4js from 'log4js';
import {tuning} from '../../config';
import * as Observability from '../../modules/Observability';
import RpcError from '../../rpc/RpcError';
import type {
    ShellyMessageData,
    ShellyMessageIncoming,
    ShellyMessageUnsafe,
    ShellyResponseCallback
} from '../../types';
import {ShellyDeviceEmitter} from '../TypedEventEmitter';

const logger = log4js.getLogger();

interface StoredMessage {
    req?: ShellyMessageData;
    resolve: (resp: ShellyMessageIncoming, req?: ShellyMessageData) => void;
    reject: (error: any) => void;
    silent?: boolean;
    startedTs: number;
    cleanup?: () => void;
}

export default abstract class RpcTransport {
    #shellyMessageMap = new Map<number, StoredMessage>();
    #uniqueID = 0;
    #intervalId: NodeJS.Timeout;
    protected _messageListeners: ShellyResponseCallback[] = [];
    protected _eventEmitter: ShellyDeviceEmitter;

    public abstract readonly name: string;
    // shellyID once known; lets slow-command timings name the device.
    public deviceLabel = '';

    constructor() {
        this._eventEmitter = new ShellyDeviceEmitter();
        this.#intervalId = setInterval(() => {
            this.#clearOldMessages();
        }, 10 * 1000);
        // Stale-RPC cleanup is housekeeping — don't pin the event loop.
        this.#intervalId.unref?.();
    }

    #clearOldMessages() {
        const now = Date.now();
        for (const [key, value] of this.#shellyMessageMap.entries()) {
            if (now > value.startedTs + tuning.rpc.rpcTimeoutMs) {
                value.cleanup?.();
                this.#recordCommand(value, 'timeout');
                value.reject(RpcError.Timeout());
                this.#shellyMessageMap.delete(key);
            }
        }
    }

    // One home for the command timing — every settle (response, timeout,
    // teardown) records through here so none is silently dropped.
    #recordCommand(
        entry: StoredMessage,
        outcome: Observability.DeviceCommandOutcome
    ) {
        Observability.recordDeviceCommand({
            label: this.deviceLabel,
            method: entry.req?.method ?? 'unknown',
            ms: Date.now() - entry.startedTs,
            outcome
        });
    }

    // Method-not-found is an expected probe, not a real error.
    #responseOutcome(error: unknown): Observability.DeviceCommandOutcome {
        if (!error) return 'ok';
        return RpcError.isMethodNotFound(error) ? 'unsupported' : 'error';
    }

    // Transports may send asynchronously (HTTP); callers never await —
    // responses arrive via parseMessage.
    protected abstract _sendRPC(data: string): void | Promise<void>;

    public sendRPC(
        method: string,
        params: any = null,
        silent = false,
        signal?: AbortSignal
    ) {
        if (signal?.aborted) {
            return Promise.reject(signal.reason ?? new Error('aborted'));
        }
        if (this.#shellyMessageMap.size >= tuning.rpc.maxPendingRpcs) {
            Observability.incrementLabeledCounter('device_rpc_rejected_total', {
                reason: 'cap-exceeded'
            });
            logger.warn(
                'RPC queue full (%d pending), rejecting %s',
                this.#shellyMessageMap.size,
                method
            );
            return Promise.reject(RpcError.Timeout());
        }

        this.#uniqueID += 1;
        const id = this.#uniqueID;
        const message: ShellyMessageData = {
            jsonrpc: '2.0',
            id,
            src: 'FLEET_MANAGER',
            method,
            ...(params && {params})
        };
        const toSend = JSON.stringify(message);

        // Register the response slot BEFORE sending: a synchronously-landing
        // reply (fast WS) would otherwise hit the orphan path and hang.
        const settled = new Promise<any>((resolve, reject) => {
            this.#registerPending(id, message, silent, resolve, reject, signal);
        });
        try {
            this._sendRPC(toSend);
        } catch (err) {
            // Sync send failure (e.g. socket not open): drop the slot we just
            // registered and fail fast, don't leak it until the stale sweep.
            this.#failPending(id, err);
        }
        return settled;
    }

    #failPending(id: number, error: unknown): void {
        const handler = this.#shellyMessageMap.get(id);
        if (!handler) return;
        this.#shellyMessageMap.delete(id);
        handler.cleanup?.();
        handler.reject(error);
    }

    #registerPending(
        id: number,
        message: ShellyMessageData,
        silent: boolean,
        resolve: (value: any) => void,
        reject: (error: any) => void,
        signal?: AbortSignal
    ): void {
        // signal aborts → drop pending slot + reject immediately.
        let abortListener: (() => void) | undefined;
        if (signal) {
            abortListener = () => {
                const handler = this.#shellyMessageMap.get(id);
                if (!handler) return;
                this.#shellyMessageMap.delete(id);
                handler.reject(signal.reason ?? new Error('aborted'));
            };
            signal.addEventListener('abort', abortListener, {once: true});
        }
        this.#shellyMessageMap.set(id, {
            req: message,
            resolve,
            reject,
            silent,
            startedTs: Date.now(),
            cleanup: abortListener
                ? () => signal?.removeEventListener('abort', abortListener!)
                : undefined
        });
    }

    public sendUnsafe(message: ShellyMessageUnsafe) {
        this._sendRPC(JSON.stringify(message));
    }

    public parseMessage(packet: any): ShellyMessageIncoming | undefined {
        let message: any;
        try {
            logger.debug('transport parseMessage message[%s]', packet);
            message = JSON.parse(packet);
        } catch (_error) {
            logger.error('transport failed to parse message as JSON');
            this._eventEmitter.emit('parse_error', packet);
            return undefined;
        }

        if (message.method === undefined) {
            if (message.id === undefined) {
                logger.debug(
                    'Transport parseMessage NO id NO method msg:[%s]',
                    JSON.stringify(message)
                );
                this._eventEmitter.emit('parse_error', message);
                return undefined; // no method and no id
            }
        }

        // Only a response (no `method`) may settle a pending RPC; a device
        // notification reusing an id must not resolve an in-flight request.
        const isResponse = message.method === undefined;
        const handler = isResponse
            ? this.#shellyMessageMap.get(message.id)
            : undefined;
        if (isResponse) {
            this.#shellyMessageMap.delete(message.id);
            // Drop orphan RPC responses (id present, no pending handler).
            if (message.id && !handler) {
                return;
            }
        }

        if (handler) {
            handler.cleanup?.();
            this.#recordCommand(handler, this.#responseOutcome(message.error));
            if (message.error) {
                handler.reject(message.error);
            } else {
                // Void replies carry no `result`; resolve undefined so the
                // caller doesn't hang (slot is already deleted above).
                handler.resolve(message.result);
            }
        }
        if (
            typeof handler?.silent === 'undefined' ||
            (typeof handler.silent === 'boolean' && handler.silent)
        ) {
            this._eventEmitter.emit('message', message, handler?.req);
        }
        return message;
    }

    public destroy() {
        const error = RpcError.Timeout();
        for (const handler of this.#shellyMessageMap.values()) {
            handler.cleanup?.();
            // The socket died with this command in flight; the caller sees a
            // timeout, so record it as one rather than losing it from the trail.
            this.#recordCommand(handler, 'timeout');
            handler.reject(error);
        }
        this.#shellyMessageMap.clear();
        clearInterval(this.#intervalId);
    }

    get pendingRpcCount() {
        return this.#shellyMessageMap.size;
    }

    get eventemitter() {
        return this._eventEmitter;
    }
}
