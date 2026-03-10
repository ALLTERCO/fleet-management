import * as log4js from 'log4js';
import type AbstractDevice from '../model/AbstractDevice';
import * as Observability from './Observability';
import {clearDeviceStatusCache} from './ShellyMessageHandler';
const logger = log4js.getLogger('DeviceCollector');

const devices: Map<string, AbstractDevice> = new Map();

export function register(shelly: AbstractDevice) {
    const old = devices.get(shelly.shellyID);
    let reconnected = false;
    if (old !== undefined) {
        logger.mark('destroying old connection shellyID:[%s]', shelly.shellyID);
        devices.delete(shelly.shellyID);
        // Skip delete event during reconnection - the device is being replaced, not deleted
        old.destroy({skipDeleteEvent: true});
        reconnected = true;
    }

    if (shelly.source === 'local') {
        const originalID = shelly.shellyID.replace('.local', '').toLowerCase();
        if (devices.get(originalID) !== undefined) {
            logger.mark(
                'destroying duplicate mdns connection shellyID:[%s]',
                shelly.shellyID
            );
            // Skip delete event - this is a duplicate connection being cleaned up, not a device deletion
            shelly.destroy({skipDeleteEvent: true});
            return;
        }
    }

    logger.mark(
        'registering new device id:[%s] prot:[%s]',
        shelly.shellyID,
        shelly.source
    );

    shelly.reconnected = reconnected;
    devices.set(shelly.shellyID, shelly);
    Observability.incrementCounter('devices_connected');
    if (reconnected) Observability.incrementCounter('devices_reconnected');
}

export function getAllShellyIDs() {
    return devices.keys();
}

export function getAll() {
    return Array.from(devices.values());
}

export function getDevice(shellyID: string) {
    return devices.get(shellyID);
}

export function deleteDevice(shellyID: string) {
    logger.mark('starting device delete for', shellyID);
    const device = devices.get(shellyID);
    if (!device) {
        logger.warn('device not found', shellyID);
        return;
    }
    devices.delete(shellyID);
    clearDeviceStatusCache(device.id);
    device.destroy();
    Observability.incrementCounter('devices_disconnected');
    logger.debug('disconnected & removed cached data for device', shellyID);
}

// Register observability module stats
Observability.registerModule('devices', () => {
    let online = 0;
    let offline = 0;
    const sources: Record<string, number> = {};
    const models: Record<string, number> = {};
    for (const device of devices.values()) {
        if (device.online) online++;
        else offline++;
        const src = device.source || 'unknown';
        sources[src] = (sources[src] ?? 0) + 1;
        const model = device.info?.model || 'unknown';
        models[model] = (models[model] ?? 0) + 1;
    }
    return {
        total: devices.size,
        online,
        offline,
        sourceCount: Object.keys(sources).length,
        modelCount: Object.keys(models).length,
        ...Object.fromEntries(
            Object.entries(sources).map(([k, v]) => [`source_${k}`, v])
        )
    };
});
