import ShellyDevice from "./model/ShellyDevice";
import * as clients from "./controller/ws/index";
import * as plugins from "./config/plugins";
import log4js from 'log4js';
const logger = log4js.getLogger('EventManager');

let next_callback_id = 1;
const callback_ids = new Map<number, event_callback_t>;
const map = new Map<string, number[]>();
type callback_id = number;
export type event_data_t = { shelly?: ShellyDeviceExternal };
type event_callback_t = <T extends json_rpc_event>(event: T, eventData?: event_data_t) => void

export function addEventListener(eventName: string, cb: event_callback_t): callback_id {
    const callback_id = next_callback_id;
    callback_ids.set(callback_id, cb);
    let listeners = map.get(eventName) || [];
    listeners.push(callback_id);
    map.set(eventName, listeners);
    next_callback_id++;
    return callback_id;
}

export function removeEventListener(callback_id: callback_id, eventName?: string) {
    if (callback_ids.has(callback_id)) {
        callback_ids.delete(callback_id)
    }
    if (eventName) {
        if (!map.has(eventName)) return;
        let listeners = map.get(eventName) || [];
        const index = listeners.indexOf(callback_id);
        if (index > -1) {
            listeners.splice(index, 1)
        }
        if (listeners.length == 0) {
            map.delete(eventName)
        }
    }
}

export function notifyAll<T extends json_rpc_event>(event: T, eventData?: event_data_t) {
    // always notify plugins
    plugins.notifyEvent(event, eventData);
    const eventName = event.method;
    if (!map.has(eventName)) {
        // no listeners
        return;
    }
    const active_listeners: number[] = [];
    const listener_ids = map.get(eventName) || []
    for (const callback_id of listener_ids) {
        if (callback_ids.has(callback_id)) {
            const cb = callback_ids.get(callback_id);
            if (typeof cb === 'function') {
                cb(event, eventData)
            }
            active_listeners.push(callback_id);
        }
    }
    if (active_listeners.length < listener_ids.length) {
        if (active_listeners.length == 0) {
            logger.mark('deleting event_name:[%s]', eventName)
            map.delete(eventName);
        } else {
            logger.mark("removing %s listeners from event_name:[%s]", listener_ids.length - active_listeners.length, eventName);
            map.set(eventName, active_listeners);
        }
    }
}

export function emitShellyConnected(shelly: ShellyDevice) {
    const event: ShellyEvent.Connect = { method: 'Shelly.Connect', params: { shellyID: shelly.shellyID, device: shelly.toJSON() } };
    notifyAll(event, { shelly: shelly.toJSON() });
}

export function emitFleetManagerConfig(name: FleetManagerEvent.Config['params']['name'], config: any) {
    const event: FleetManagerEvent.Config = { method: "FleetManager.Config", params: { name, config } };
    notifyAll(event);
}

export function emitShellyDisconnected(shelly: ShellyDevice) {
    const { shellyID } = shelly;
    const event: ShellyEvent.Disconnect = { method: 'Shelly.Disconnect', params: { shellyID } };
    notifyAll(event, { shelly: shelly.toJSON() });
}

export function emitShellyDeviceInfo(shelly: ShellyDevice) {
    const { shellyID, deviceInfo } = shelly;
    const event: ShellyEvent.Info = { method: 'Shelly.Info', params: { shellyID, info: deviceInfo } };
    notifyAll(event, { shelly: shelly.toJSON() });
}

export function emitShellyStatus(shelly: ShellyDevice) {
    const { shellyID, status } = shelly;
    const event: ShellyEvent.Status = { method: 'Shelly.Status', params: { shellyID, status } };
    notifyAll(event, { shelly: shelly.toJSON() });
}

export function emitShellySettings(shelly: ShellyDevice) {
    const { shellyID, settings } = shelly;
    const event: ShellyEvent.Settings = { method: 'Shelly.Settings', params: { shellyID, settings } };
    notifyAll(event, { shelly: shelly.toJSON() });
}

export function emitShellyMessage(shelly: ShellyDevice, res: ShellyMessageIncoming, req?: ShellyMessageData) {
    const event: ShellyEvent.Message = { method: 'Shelly.Message', params: { shellyID: shelly.shellyID, message: res, req } };
    notifyAll(event, { shelly: shelly.toJSON() });
}

export function emitShellyGroups(shelly: ShellyDevice) {
    const { shellyID, groups } = shelly;
    const event: ShellyEvent.Group = { method: 'Shelly.Group', params: { shellyID, groups } };
    notifyAll(event, { shelly: shelly.toJSON() });
}
export function emitBleStatus(mac: string, status: string) {
    clients.notifyAll(JSON.stringify({
        event: 'Ble:Status',
        shellyID: mac,
        status
    }))
}