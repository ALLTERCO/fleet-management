import * as log4js from "log4js";
import { ShellyDeviceEmitter } from "../TypedEventEmitter";
const logger = log4js.getLogger();

interface stored_message {
    req?: ShellyMessageData,
    cb?: (resp: ShellyMessageIncoming, req?: ShellyMessageData) => void,
    silent?: boolean
}

export default abstract class Transport {
    #shellyMessageMap = new Map<number, stored_message>();
    #uniqueID = 0;
    protected _messageListeners: ShellyResponseCallback[] = [];
    protected _eventEmitter: ShellyDeviceEmitter;

    constructor() {
        this._eventEmitter = new ShellyDeviceEmitter();
    }

    protected abstract _sendRPC(params: string): void;

    public shellyRPC(method: string, params?: any, cb?: ShellyResponseCallback, silent = false) {
        this.#uniqueID += 1;
        const message: ShellyMessageData = {
            jsonrpc: '2.0',
            id: this.#uniqueID,
            src: 'FLEET_MANAGER',
            method,
            ...(params && { params })
        }
        const toSend = JSON.stringify(message);
        // logger.debug("Transport shellyRPC send:[%s]", toSend);
        this._sendRPC(toSend);
        if (cb) {
            this.#shellyMessageMap.set(this.#uniqueID, { req: message, cb, silent });
        } else {
            this.#shellyMessageMap.set(this.#uniqueID, { req: message });
        }
    }

    public sendUnsafe(message: ShellyMessageUnsafe) {
        this._sendRPC(JSON.stringify(message));
    }

    public parseMessage(message: any): ShellyMessageIncoming | undefined {
        try {
            message = JSON.parse(message);
        } catch (error) {
            logger.error("transport failed to parse message as JSON");
            this._eventEmitter.emit('parse_error', message)
            return undefined;
        }

        if (message.method == undefined) {
            if (message.id == undefined) {
                logger.debug("Transport parseMessage NO id NO method msg:[%s]", JSON.stringify(message))
                this._eventEmitter.emit('parse_error', message)
                return undefined; // no method and no id
            }
        }

        const handler = this.#shellyMessageMap.get(message.id);

        if (typeof handler?.cb === 'function') {
            handler.cb(message, handler?.req);
        }

        if (typeof handler?.silent === 'undefined' || (typeof handler.silent === 'boolean' && !handler.silent === false)) {
            this._eventEmitter.emit('message', message, handler?.req);
        }
        return message;
    }

    public abstract destroy(): void;

    get eventemitter() {
        return this._eventEmitter;
    }
}