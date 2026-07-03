// Per-device row-level access filter. Classification / reset-audit
// rows are keyed by internal numeric `deviceId`; sender ACLs operate
// on Shelly IDs. This helper bridges the two and filters out rows
// the sender can't read so cross-org reads can't leak data.

import * as DeviceCollector from '../../modules/DeviceCollector';

export interface DeviceAccessSender {
    canCrossOrganizations?(): boolean;
    filterAccessibleDevices(shellyIDs: string[]): Promise<Set<string>>;
}

// The one access rule: which shellyIDs may the sender read. Global-provider
// senders bypass tenant scoping. Single source of truth for both the
// deviceId-row filter below and any caller that already has shellyIDs (e.g.
// the meter-current path, which resolves ids from its own live id map).
export async function accessibleShellyIds(
    shellyIDs: readonly string[],
    sender: DeviceAccessSender
): Promise<Set<string>> {
    if (sender.canCrossOrganizations?.() ?? false) return new Set(shellyIDs);
    return sender.filterAccessibleDevices([...shellyIDs]);
}

// Answer — keep only rows whose device's shellyID is in the sender's
// accessible set. Maps deviceId -> shellyID via DeviceCollector for callers
// whose rows carry only the internal id. Cross-org providers keep every row.
export async function filterRowsByDeviceAccess<T extends {deviceId: number}>(
    rows: ReadonlyArray<T>,
    sender: DeviceAccessSender
): Promise<T[]> {
    if (sender.canCrossOrganizations?.() ?? false) return rows.slice();
    const idMap = mapDeviceIdsToShellyIds(rows);
    const allowed = await accessibleShellyIds([...idMap.values()], sender);
    return rows.filter((row) => {
        const shellyId = idMap.get(row.deviceId);
        return shellyId !== undefined && allowed.has(shellyId);
    });
}

// Answer — is the single deviceId one the sender can read? Used by
// write paths to reject before mutating PG.
export async function senderCanAccessDevice(
    deviceId: number,
    sender: DeviceAccessSender
): Promise<boolean> {
    if (sender.canCrossOrganizations?.() ?? false) return true;
    const shellyId = lookupShellyId(deviceId);
    if (!shellyId) return false;
    const allowed = await sender.filterAccessibleDevices([shellyId]);
    return allowed.has(shellyId);
}

function mapDeviceIdsToShellyIds<T extends {deviceId: number}>(
    rows: ReadonlyArray<T>
): Map<number, string> {
    const needed = new Set(rows.map((r) => r.deviceId));
    const out = new Map<number, string>();
    for (const device of DeviceCollector.getAll()) {
        if (needed.has(device.id)) out.set(device.id, device.shellyID);
    }
    return out;
}

function lookupShellyId(deviceId: number): string | null {
    for (const device of DeviceCollector.getAll()) {
        if (device.id === deviceId) return device.shellyID;
    }
    return null;
}
