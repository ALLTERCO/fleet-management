import Transport from "./transport/Transport";
import { ShellyDeviceEvents } from "./TypedEventEmitter";
import * as EventManager from "../EventManager";

type source_t = 'ws' | 'local';
interface ShellyDeviceProps {
    transport: Transport,
    source: source_t,
}

export default class ShellyDevice {
    #transport: Transport;
    #shellyID: string;
    #status: any;
    #deviceInfo: any;
    #settings: any;
    #source: source_t;
    #groups: Record<string, string>;

    constructor(shellyID: string, props: ShellyDeviceProps) {
        this.#shellyID = shellyID;
        this.#transport = props.transport;
        this.#source = props.source;
        this.#groups = {};

        this.shellyRPC('shelly.getdeviceinfo');
        this.shellyRPC('shelly.getstatus');
        this.shellyRPC('shelly.getconfig');

        if (this.#source == 'ws') {
            this.shellyRPC('kvs.getmany');
        }
    }

    shellyRPC(method: string, params?: any, cb?: ShellyResponseCallback, silent = false) {
        return this.#transport.shellyRPC(method, params, cb, silent);
    }

    sendUnsafe(message: any) {
        return this.#transport.sendUnsafe(message);
    }

    destroy() {
        this.#transport.destroy();
    }

    setTransport(transport: Transport) {
        this.#transport = transport;
    }

    on<TEventName extends keyof ShellyDeviceEvents>(
        eventName: TEventName,
        handler: (...eventArg: ShellyDeviceEvents[TEventName]) => void
    ) {
        this.emitter.on(eventName, handler as any)
    }

    get emitter() {
        return this.transport.eventemitter;
    }

    get ready() {
        return this.#deviceInfo != undefined
            && this.#status != undefined
            && this.#settings != undefined
    }

    set status(status: any) {
        this.#status = status;
        EventManager.emitShellyStatus(this);
    }

    set settings(settings: any) {
        this.#settings = settings;
        EventManager.emitShellySettings(this);
    }

    get groups() {
        return this.#groups;
    }

    set groups(kvs: any) {
        this.#groups = kvs;
        EventManager.emitShellyGroups(this)
    }

    set deviceInfo(deviceInfo: any) {
        this.#deviceInfo = deviceInfo;
        EventManager.emitShellyDeviceInfo(this)
    }

    get deviceInfo() {
        return this.#deviceInfo;
    }

    get shellyID() {
        return this.#shellyID;
    }

    get status() {
        return this.#status;
    }

    get settings() {
        return this.#settings
    }

    get source() {
        return this.#source;
    }

    get transport() {
        return this.#transport;
    }

    toJSON() {
        const external: ShellyDeviceExternal = {
            shellyID: this.#shellyID,
            source: this.#source,
            info: this.#deviceInfo,
            status: this.#status,
            settings: this.#settings,
            groups: this.#groups
        }
        return external;
    }
}