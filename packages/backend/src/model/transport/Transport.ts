import * as log4js from "log4js";
import { EventEmitter } from "ws";
const logger = log4js.getLogger();

export interface ShellyMessage {
    method: string,
    messageHandler?: message_handler_t | undefined,
    result?: any,
    params?: any
}

export interface message_handler_t {
    resolve: (value: unknown) => void,
    reject: (reason?: any) => void,
    method: string
}

export type message_listener = (message: ShellyMessage) => void;

export type event_t = 'message' | 'close';

export default abstract class Transport {

    private _shellyMessageMap = new Map<number, message_handler_t>();
    private _uniqueID = 0;
    protected _messageListeners: message_listener[] = [];
    protected _eventEmitter?: EventEmitter;

    protected abstract _sendRPC(params: string): void;

    public setEventEmitter(emitter: EventEmitter) {
        this._eventEmitter = emitter;
    }

    public emit(event: event_t, ... data:any[]){
        if(this._eventEmitter != undefined){
            this._eventEmitter.emit(event, ...data)
        }
    }

    public on(event: event_t, listener: (...data:any[]) => void){
        if(this._eventEmitter != undefined){
            this._eventEmitter.on(event, listener)
        }
    }

    public shellyRPC(method: string, params?: any) {
        this._uniqueID += 1;
        const toSend = JSON.stringify({
            jsonrpc: '2.0',
            id: this._uniqueID,
            src: 'wsserver',
            method: method,
            ...(params && { params })
        });
        logger.debug("Transport shellyRPC send:[%s]", toSend);
        this._sendRPC(toSend);
        return new Promise((resolve, reject) => {
            this._shellyMessageMap.set(this._uniqueID, { resolve, reject, method });
        });
    }

    public parseMessage(message: any): ShellyMessage | undefined {
        try {
            message = JSON.parse(message);
        } catch (error) {
            logger.error("transport failed to parse message");
            return undefined;
        }

        let messageHandler: message_handler_t | undefined = undefined;
        if (message.method == undefined) {
            if (message.id == undefined) {
                logger.debug("Transport parseMessage NO id NO method msg:[%s]", JSON.stringify(message))
                return undefined; // no method and no id
            }
            messageHandler = this._shellyMessageMap.get(message.id);

            if (messageHandler == undefined) {
                logger.debug("Transport::parseMessage id:[%s] unable to find messageHandler", message.id);
            } else {
                if (message.error) {
                    messageHandler.reject(message.error);
                } else {
                    messageHandler.resolve(message.result)
                }
            }

        }

        const parsed = {
            method: message['method'] || 'RPC response',
            messageHandler,
            result: message.result,
            params: message.params
        };

        this.emit('message', parsed);
        return parsed;
    }

    public abstract destroy(): void;
}