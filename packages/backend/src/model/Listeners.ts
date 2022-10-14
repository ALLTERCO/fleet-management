import { ShellyMessage } from "./transport/Transport";
import { Consumption, Event } from "../database";
import ShellyDevice from "./ShellyDevice";
import * as clientWs from "../controller/ws/client";
import { deleteDevice } from "../globals";

const consumptionListener = (shellyID: string) => (message: ShellyMessage) => {
    if (message.method === 'NotifyStatus') {
        if (message.params != undefined) {
            for (const key in message.params) {
                // save power consumption
                if (!key.startsWith("switch:")) continue;
                const channel = Number(key.substring("switch:".length)) || 0;
                const { aenergy } = message.params[key];
                if (aenergy != undefined) {
                    const { minute_ts, by_minute } = aenergy;
                    if (minute_ts != undefined && by_minute != undefined && by_minute[0] != undefined) {
                        Consumption.create({ shellyID, channel, consumption: by_minute[0] / 1000, timestamp: minute_ts })
                    }
                }
            }
        }
    }
}

const statusListener = (device: ShellyDevice) => (message: ShellyMessage) => {
    if (message.messageHandler && message.messageHandler.method != undefined && message.result != undefined) {
        switch (message.messageHandler.method) {
            case 'shelly.getstatus':
                device.status = message.result;
                break;
            case 'shelly.getdeviceinfo':
                device.deviceInfo = message.result;
                clientWs.emitConnectEvent(device);
                break;
        }
    }
}

const fieldsListener = (device: ShellyDevice) => (message: ShellyMessage) => {

    if (message.messageHandler && message.messageHandler.method != undefined
        && message.result != undefined && message.messageHandler.method == 'shelly.getstatus') {
        const status = message.result;
        let channels = 0;

        for (const key in status) {
            if (key.startsWith('switch')) {
                channels++;
                const sw = status[key];
                if (sw.output != undefined) {
                    device.getComponent(key).update('output', sw.output);
                }
                if (sw.apower != undefined) {
                    device.getComponent(key).update('apower', sw.apower);
                }
                if (sw.voltage != undefined) {
                    device.getComponent(key).update('voltage', sw.voltage);
                }
                if (sw.current != undefined) {
                    device.getComponent(key).update('current', sw.current);
                }
                if(sw.aenergy?.total) {
                    device.getComponent(key).update('total', sw.aenergy.total);
                }
            }
        }
        device.setChannels(channels)
        return;
    }

    if (message.method == "NotifyStatus") {
        for (const key in message.params) {
            if (key.startsWith('switch')) {
                const sw = message.params[key];
                if (sw.output != undefined) {
                    device.getComponent(key).update('output', sw.output);
                }
                if (sw.apower != undefined) {
                    device.getComponent(key).update('apower', sw.apower);
                }
                if (sw.voltage != undefined) {
                    device.getComponent(key).update('voltage', sw.voltage);
                }
                if (sw.current != undefined) {
                    device.getComponent(key).update('current', sw.current);
                }
                if(sw.aenergy?.total) {
                    device.getComponent(key).update('total', sw.aenergy.total);
                }
            }
        }
    }
}


const wsReporter = (device: ShellyDevice) => (message: ShellyMessage) => {
    let parsed: any = Object.assign({}, message);
    clientWs.emitMessageEvent(device.shellyID, parsed)
}

const saveEvents = (device: ShellyDevice) => (message: ShellyMessage) => {
    Event.create({
        shellyID: device.shellyID,
        method: message.method || "RPC Response",
        msg: message.params || message.result,
        timestamp: Date.now()
    })
}

export function addListeners(device: ShellyDevice) {
    device.transport.on('close', () => {
        deleteDevice(device);
    })
    device.transport.on('message', statusListener(device));
    if (device.source == 'ws') {
        device.transport.on('message', consumptionListener(device.shellyID));
        device.transport.on('message', saveEvents(device));
        device.transport.on('message', fieldsListener(device));
        device.transport.on('message', wsReporter(device));
    }
}