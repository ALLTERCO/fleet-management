import Transport from "./transport/Transport";
import * as clientWs from "../controller/ws/client";
import { EventEmitter } from "ws";
import * as Listeners from "./Listeners";
import Component from "./Component"

type source_t = 'ws' | 'ble';
interface ShellyDeviceProps {
    transport: Transport,
    source: source_t,
    deviceInfo?: any;
    status?: any;
    channels?: number;
}

export default class ShellyDevice {
    private _transport: Transport;
    private _shellyID: string;
    private _lastStatus?: { status: any, ts: number };
    private _deviceInfo?: any;
    private _source: source_t;
    private _eventEmitter: EventEmitter;
    private _channels: number;
    private _components: Record<string, Component>;

    constructor(shellyID: string, props: ShellyDeviceProps) {
        this._shellyID = shellyID;
        this._transport = props.transport;
        this._source = props.source;
        this._eventEmitter = new EventEmitter();
        this.setTransport(this._transport);
        this._channels = props.channels || 0;
        this._components = {};
        if(props.status){
            this.status = props.status;
        }
        if(props.deviceInfo){
            this._deviceInfo = props.deviceInfo;
            clientWs.emitConnectEvent(this);
        } else {
            this.shellyRPC('shelly.getdeviceinfo');
        }
        if(this._source == 'ws'){
            this.shellyRPC('shelly.getstatus');
        }
    }

    shellyRPC(method: string, params?: any) {
        return this._transport.shellyRPC(method, params);
    }

    destroy(){
        this._transport.destroy();
    }

    setTransport(transport: Transport) {
        this._transport = transport;
        this._transport.setEventEmitter(this._eventEmitter);
        Listeners.addListeners(this);
    }

    setChannels(channels: number){
        this._channels = channels;
    }

    addComponent(component: Component){
        this._components[component.name] = component;
    }

    getComponent(name: string){
        if(this._components[name] == undefined){
            this._components[name] = new Component(this.shellyID, name);
        }
        return this._components[name];
    }

    get channels(){
        return this._channels;
    }

    set status(status: any) {
        this._lastStatus = { status, ts: Date.now() }
    }

    set deviceInfo(deviceInfo: any) {
        this._deviceInfo = deviceInfo;
    }

    get deviceInfo() {
        return this._deviceInfo;
    }

    get shellyID() {
        return this._shellyID;
    }

    get lastStatus() {
        return this._lastStatus?.status;
    }

    get lastStatusTs() {
        return this._lastStatus?.ts;
    }

    get source(){
        return this._source;
    }

    get transport(){
        return this._transport;
    }

    get fields(){
        let fields: Record<string, any> = {};
        for(const key in this._components){
            fields[key] = this._components[key].getFields()
        }
        return fields;
    }
}