import {getLogger} from 'log4js';
import type AbstractDevice from '../model/AbstractDevice';
import * as AuditLogger from '../modules/AuditLogger';
import * as EventDistributor from '../modules/EventDistributor';
import * as Observability from '../modules/Observability';
import {buildOutgoingEvent, buildOutgoingStatus} from '../rpc/builders';
import type {
    BTHome,
    Console,
    EntityEvent,
    FleetManagerEvent,
    ShellyEvent,
    ShellyMessageData,
    ShellyMessageIncoming,
    WaitingRoomEvent,
    entity_t,
    json_rpc_event,
    shelly_bthome_type_t
} from '../types';

const logger = getLogger('shelly-events');

export function notifyComponentEvent(component: string, event: string) {
    const outgoingEvent = buildOutgoingEvent('FM_CLIENT', component, event);
    EventDistributor.notifyAll(outgoingEvent, {reason: component});
}

export function notifyComponentStatus(patch: object) {
    const key = Object.keys(patch)?.[0];
    if (!key) return;
    const outgoingEvent = buildOutgoingStatus('FM_CLIENT', patch);
    EventDistributor.notifyAll(outgoingEvent, {reason: key});
}

let connectCount = 0;
let disconnectCount = 0;
let eventCount = 0;

Observability.registerModule('shellyEvents', () => ({
    connects: connectCount,
    disconnects: disconnectCount,
    totalEvents: eventCount
}));

export function emitShellyConnected(device: AbstractDevice) {
    connectCount++;
    logger.info(
        'emitShellyConnected shellyID:[%s] model:[%s]',
        device.shellyID,
        device.info?.model
    );
    const deviceJSON = device.toJSON();
    const event: ShellyEvent.Connect = {
        method: 'Shelly.Connect',
        params: {
            shellyID: device.shellyID,
            device: deviceJSON
        }
    };
    EventDistributor.processAndNotifyAll(event, {device});
    AuditLogger.logDeviceOnline(device.shellyID);
}

export function emitFleetManagerConfig(
    name: FleetManagerEvent.Config['params']['name'],
    config: any
) {
    const event: FleetManagerEvent.Config = {
        method: 'FleetManager.Config',
        params: {name, config}
    };
    EventDistributor.processAndNotifyAll(event);
}

export function emitShellyDisconnected(device: AbstractDevice) {
    disconnectCount++;
    const {shellyID} = device;
    const event: ShellyEvent.Disconnect = {
        method: 'Shelly.Disconnect',
        params: {shellyID}
    };
    EventDistributor.processAndNotifyAll(event, {device});
    AuditLogger.logDeviceOffline(shellyID);
}

export function emitShellyDeleted(device: AbstractDevice, username?: string) {
    const {shellyID} = device;
    const event: ShellyEvent.Delete = {
        method: 'Shelly.Delete',
        params: {shellyID}
    };
    EventDistributor.processAndNotifyAll(event, {device});
    AuditLogger.logDeviceDelete(shellyID, username);
}

export function emitShellyDeviceInfo(device: AbstractDevice) {
    const {shellyID, info: deviceInfo} = device;
    const event: ShellyEvent.Info = {
        method: 'Shelly.Info',
        params: {shellyID, info: deviceInfo}
    };
    EventDistributor.processAndNotifyAll(event, {device});
}

export function emitShellyStatus(
    device: AbstractDevice,
    reason: string | string[]
) {
    const {shellyID, status} = device;
    const event: ShellyEvent.Status = {
        method: 'Shelly.Status',
        params: {shellyID, status}
    };
    EventDistributor.processAndNotifyAll(event, {
        device,
        reason
    });
}

export function emitShellySettings(device: AbstractDevice) {
    const {shellyID, config: settings} = device;
    const event: ShellyEvent.Settings = {
        method: 'Shelly.Settings',
        params: {shellyID, settings}
    };
    EventDistributor.processAndNotifyAll(event, {device});
}

export function emitShellyMessage(
    device: AbstractDevice,
    res: ShellyMessageIncoming,
    req?: ShellyMessageData
) {
    eventCount++;
    const event: ShellyEvent.Message = {
        method: 'Shelly.Message',
        params: {shellyID: device.shellyID, message: res, req}
    };
    EventDistributor.processAndNotifyAll(event, {device});
}

export function emitShellyPresence(device: AbstractDevice) {
    const {shellyID, presence} = device;
    const event: ShellyEvent.Presence = {
        method: 'Shelly.Presence',
        params: {shellyID, presence}
    };
    EventDistributor.processAndNotifyAll(event, {device});
}

export function emitEntityAdded(entity: entity_t) {
    const event: EntityEvent.Added = {
        method: 'Entity.Added',
        params: {entityId: entity.id}
    };
    EventDistributor.processAndNotifyAll(event);
}

export function emitEntityRemoved(entity: entity_t) {
    const event: EntityEvent.Removed = {
        method: 'Entity.Removed',
        params: {entityId: entity.id}
    };
    EventDistributor.processAndNotifyAll(event);
}

export function emitEntityEvent(
    entity: entity_t,
    event: 'single_push' | 'double_push' | 'triple_push' | 'long_push'
) {
    const _event: EntityEvent.Event = {
        method: 'Entity.Event',
        params: {entityId: entity.id, event}
    };

    EventDistributor.processAndNotifyAll(_event);
}

export function emitEntityStatusChange(entity: entity_t, status: any) {
    const _event: EntityEvent.StatusChange = {
        method: 'Entity.StatusChange',
        params: {entityId: entity.id, status}
    };

    EventDistributor.processAndNotifyAll(_event);
}

export function emitBTHomeDiscoveryResult(
    type: shelly_bthome_type_t,
    mac: string,
    shellyID: string
) {
    const event: BTHome.DiscoveryResult = {
        method: 'BTHome.DiscoveryResult',
        params: {type, mac, shellyID}
    };
    EventDistributor.processAndNotifyAll(event);
}

export function emitShellyDiscoveryDone(
    shellyID: string,
    discoveredDevicesCount: number
) {
    const event: BTHome.DiscoveryDone = {
        method: 'BTHome.DiscoveryDone',
        params: {shellyID, discoveredDevicesCount}
    };
    EventDistributor.processAndNotifyAll(event);
}
export function emitConsoleLog(
    coloredPart: string,
    log: string,
    color: string
) {
    const event: Console.Log = {
        method: 'Console.Log',
        params: {coloredPart: coloredPart, log: log, color: color}
    };
    EventDistributor.notifyAll(event, {});
}

export function emitConsoleLogBatch(
    logs: {coloredPart: string; log: string; color: string}[]
) {
    const event: json_rpc_event = {
        method: 'Console.Log',
        params: {batch: logs}
    };
    EventDistributor.notifyAll(event, {});
}

export function emitWaitingRoomAccepted(id: number) {
    const event: WaitingRoomEvent.Accepted = {
        method: 'WaitingRoomEvent.Accepted',
        params: {id}
    };
    EventDistributor.processAndNotifyAll(event);
}

/**
 * Batch variant — one event with all IDs instead of N individual events.
 * Used by accept-all to avoid saturating the event loop.
 */
export function emitWaitingRoomAcceptedBatch(ids: number[]) {
    if (ids.length === 0) return;
    const event: json_rpc_event = {
        method: 'WaitingRoomEvent.Accepted',
        params: {ids}
    };
    EventDistributor.processAndNotifyAll(event);
}

export function emitWaitingRoomDenied(id: number) {
    const event: WaitingRoomEvent.Denied = {
        method: 'WaitingRoomEvent.Denied',
        params: {id}
    };
    EventDistributor.processAndNotifyAll(event);
}
