import {getLogger} from 'log4js';
import type {ShellyDeviceExternal} from '../types';
import * as AuditLogger from './AuditLogger';
import * as DeviceCollector from './DeviceCollector';
import * as Observability from './Observability';
import * as postgres from './PostgresProvider';
import * as ShellyEvents from './ShellyEvents';

const logger = getLogger('WaitingRoom');

const pendingDevices: Map<
    string,
    {
        status: any;
        onApprove: () => void;
        onDeny: () => void;
    }
> = new Map();

// Debounce waiting_room_updated — during connection storms (1k+ devices),
// avoids sending one event per device. One notification per 300ms is plenty.
let wrNotifyTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedNotifyWaitingRoom() {
    if (wrNotifyTimer) return;
    wrNotifyTimer = setTimeout(() => {
        wrNotifyTimer = null;
        ShellyEvents.notifyComponentEvent('device', 'waiting_room_updated');
    }, 300);
}

export async function addDevice(
    shellyID: string,
    status: any,
    onApprove: () => void,
    onDeny: () => void
) {
    let accessControl: number;
    try {
        accessControl =
            (await postgres.accessControl(shellyID))?.control_access ||
            Number.NaN;
    } catch (error) {
        logger.error(
            'Failed to check access control for %s: %s',
            shellyID,
            error
        );
        accessControl = Number.NaN;
    }

    // Check if we already have an answer already
    if (Number.isFinite(accessControl)) {
        if (accessControl === postgres.ACCESS_CONTROL.ALLOWED) {
            return void onApprove();
        }

        if (accessControl === postgres.ACCESS_CONTROL.DENIED) {
            return void onDeny();
        }
    }

    // We don't have an answer, wait for action
    debouncedNotifyWaitingRoom();
    pendingDevices.set(shellyID, {status, onApprove, onDeny: onDeny});
    // store device status
    const data: Partial<ShellyDeviceExternal> = {
        shellyID,
        presence: 'pending',
        status
    };
    try {
        await postgres.store(shellyID, data);
    } catch (error) {
        logger.error('Failed to store pending device %s: %s', shellyID, error);
    }
}

export async function listPendingDevices() {
    try {
        const response = await postgres.getPendingDevices();
        const devices: Record<string, any> = {};
        for (const {id, jdoc} of response) {
            devices[id] = jdoc;
        }
        return devices;
    } catch (error) {
        logger.warn(
            'Failed to list pending devices from DB, using in-memory fallback: %s',
            error
        );
        return Object.fromEntries(pendingDevices.entries());
    }
}

export async function approveDevice(shellyID: number, username?: string) {
    await postgres.allowAccessControl(shellyID);
    const dd: any = await postgres.accessControl(undefined, shellyID);
    const device = pendingDevices.get(dd.external_id);
    if (device) {
        pendingDevices.delete(dd.external_id);
        device.onApprove();
        Observability.incrementCounter('waiting_room_approved');
        AuditLogger.logDeviceAdd(dd.external_id, username);
    }
    return !!device;
}

/**
 * Batch approve: fires onApprove callbacks from pendingDevices
 * for all records. Pure in-memory — DB batch ops happen in caller.
 */
export function approveDevicesBatch(
    records: postgres.get_resp_t[],
    username?: string
) {
    for (const rec of records) {
        const device = pendingDevices.get(rec.external_id);
        if (device) {
            pendingDevices.delete(rec.external_id);
            device.onApprove();
            Observability.incrementCounter('waiting_room_approved');
            AuditLogger.logDeviceAdd(rec.external_id, username);
        }
    }
}

export async function denyDevice(id: number) {
    await postgres.denyAccessControl(id);
    const dd: any = await postgres.accessControl(undefined, id);
    const device = pendingDevices.get(dd.external_id);
    if (device) {
        pendingDevices.delete(dd.external_id);
        device.onDeny();
        Observability.incrementCounter('waiting_room_denied');
    }
    DeviceCollector.deleteDevice(dd.external_id);
    return !!device;
}

export async function getDenied() {
    const response = await postgres.getDeniedDevices();
    const devices: Record<string, any> = {};
    for (const dev of response) {
        devices[dev.id] = dev.jdoc;
    }
    return devices;
}

Observability.registerModule('waitingRoom', () => ({
    pendingDevices: pendingDevices.size
}));
