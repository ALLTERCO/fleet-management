import * as log4js from 'log4js';
import type AbstractDevice from '../model/AbstractDevice';
import CommandSender from '../model/CommandSender';
import * as AuditLogger from './AuditLogger';
import {clearAnomalyBandCacheForDevice} from './alert/evaluators/anomalyBand';
import {clearChangeEventCacheForDevice} from './alert/evaluators/changeEvent';
import * as bluAssistConnectionTracker from './bluAssistConnectionTracker';
import * as EventDistributor from './EventDistributor';
import {energyClassifierCache} from './energyClassifierCache';
import {energyOverrideCache} from './energyOverrideCache';
import * as Observability from './Observability';

const logger = log4js.getLogger('DeviceCollector');

const devices: Map<string, AbstractDevice> = new Map();

// entityId → {device, entity} index. Replaces the O(N×M) scan that ran
// twice per Entity.* RPC. Invalidated by:
//   • register()/deleteDevice() — whole-device add/remove
//   • Entity.Added / Entity.Removed bus events — within-device mutations
// Lookups are O(1) on hit; rebuilds happen lazily on first lookup after
// invalidation.
type EntityRef = {
    device: AbstractDevice;
    entity: AbstractDevice['entities'][number];
};
const entityIndex: Map<string, EntityRef> = new Map();
let entityIndexBuilt = false;

function buildEntityIndex(): void {
    entityIndex.clear();
    for (const device of devices.values()) {
        for (const entity of device.entities) {
            entityIndex.set(entity.id, {device, entity});
        }
    }
    entityIndexBuilt = true;
}

function invalidateEntityIndex(): void {
    entityIndex.clear();
    entityIndexBuilt = false;
}

interface EntityListener {
    id: number;
    eventName: string;
}
const entityListeners: EntityListener[] = [];

export function startEntityIndexListeners(): void {
    if (entityListeners.length > 0) return;
    for (const eventName of ['Entity.Added', 'Entity.Removed']) {
        const id = EventDistributor.addEventListener(
            CommandSender.INTERNAL,
            eventName,
            {},
            // Full invalidation: O(1) clear, no mid-iteration races on
            // rapid add/remove bursts. Next lookup rebuilds lazily.
            () => invalidateEntityIndex()
        );
        entityListeners.push({id, eventName});
    }
}

export function stopEntityIndexListeners(): void {
    for (const {id, eventName} of entityListeners.splice(0)) {
        EventDistributor.removeEventListener(id, eventName);
    }
    invalidateEntityIndex();
}

// Monotonic version — bumped on register/delete for cache invalidation.
let collectorVersion = 0;
export function getCollectorVersion(): number {
    return collectorVersion;
}

export function register(shelly: AbstractDevice) {
    const old = devices.get(shelly.shellyID);
    let reconnected = false;
    if (old !== undefined) {
        logger.mark('destroying old connection shellyID:[%s]', shelly.shellyID);
        AuditLogger.logDeviceReconnectReplace(shelly.shellyID, {
            oldSource: old.source,
            newSource: shelly.source
        });
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
    invalidateEntityIndex();
    collectorVersion++;
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
    invalidateEntityIndex();
    collectorVersion++;
    energyClassifierCache.invalidateDevice(shellyID);
    energyOverrideCache.invalidateDevice(device.id);
    clearAnomalyBandCacheForDevice(shellyID);
    clearChangeEventCacheForDevice(shellyID);
    device.destroy();
    EventDistributor.clearDeviceOrg(shellyID);
    bluAssistConnectionTracker.clearDevice(shellyID);
    Observability.incrementCounter('devices_disconnected');
    logger.debug('disconnected & removed cached data for device', shellyID);
}

export function disconnectForIdentityChange(
    shellyIDs: readonly string[]
): void {
    let changed = false;
    for (const shellyID of new Set(shellyIDs)) {
        if (!shellyID) continue;
        const device = devices.get(shellyID);
        if (!device) continue;
        changed = true;
        devices.delete(shellyID);
        energyClassifierCache.invalidateDevice(shellyID);
        energyOverrideCache.invalidateDevice(device.id);
        clearAnomalyBandCacheForDevice(shellyID);
        clearChangeEventCacheForDevice(shellyID);
        device.destroy({skipDeleteEvent: true});
        EventDistributor.clearDeviceOrg(shellyID);
        bluAssistConnectionTracker.clearDevice(shellyID);
        Observability.incrementCounter('devices_disconnected');
        logger.info(
            'closed device connection for identity change: %s',
            shellyID
        );
    }
    if (!changed) return;
    invalidateEntityIndex();
    collectorVersion++;
}

// O(1) entity lookup. The index is invalidated by register/deleteDevice
// and by Entity.Added/Entity.Removed bus events (see start...Listeners),
// so a cache hit is always consistent without a per-call staleness check.
export function findEntityAndDevice(id: string): EntityRef | undefined {
    if (!entityIndexBuilt) buildEntityIndex();
    return entityIndex.get(id);
}

// Register observability module stats
Observability.registerModule('devices', {
    stats: () => {
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
    },
    topology: {
        role: 'source',
        cluster: 'ingest',
        upstreams: ['mdns'],
        downstreams: ['waitingRoom', 'deviceInit'],
        label: 'Devices',
        description: 'Connected device fleet',
        route: '/monitoring/device-ingest'
    }
});
