/**
 * Pure handler for `Energy.Current` — live instantaneous active power read
 * straight from in-memory device status (no DB, no cache). The current
 * status is already held per device by DeviceCollector, so this just
 * resolves the scope, reads each device's power channels, and sums.
 *
 * Extracted from `EnergyComponent` (same pattern as `handleEnergyQuery`) so
 * it unit-tests without the Component base class graph. The live device
 * lookup is injected so tests pass a fake instead of DeviceCollector.
 */

import type {EnergyRepository} from '../../modules/repositories/EnergyRepository';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ENERGY_CURRENT_PARAMS_SCHEMA,
    type EnergyCurrentDevice,
    type EnergyCurrentParams,
    type EnergyCurrentResponse,
    type EnergyLogicalMeter
} from '../../types/api/energy';
import {accessibleShellyIds} from './deviceAccessFilter';
import {
    type DeviceLive,
    type MeterDeviceChannels,
    meterLiveWatts
} from './liveMeterPower';
import {
    type DeviceStatusView,
    devicePowerChannels,
    type PowerChannel,
    sumChannels
} from './livePowerChannels';
import {resolveScope, type SenderCapabilities} from './queryHandler';

// Resolve a device's current status by shellyID. DeviceCollector.getDevice
// in production; a fake map in tests.
export type LiveDeviceLookup = (
    shellyID: string
) => DeviceStatusView | undefined;

export type ListMeters = (org: string) => Promise<EnergyLogicalMeter[]>;

export async function handleEnergyCurrent(
    params: unknown,
    sender: SenderCapabilities,
    repo: EnergyRepository,
    lookup: LiveDeviceLookup,
    listMeters?: ListMeters
): Promise<EnergyCurrentResponse> {
    const validated = validateOrThrow<EnergyCurrentParams>(
        params,
        ENERGY_CURRENT_PARAMS_SCHEMA
    );
    assertOneSelector(validated);
    const detail = validated.detail ?? 'total';

    if (validated.meterIds !== undefined) {
        return meterCurrent(
            validated,
            sender,
            repo,
            lookup,
            listMeters,
            detail
        );
    }
    if (detail === 'meter') {
        throw RpcError.InvalidParams('detail=meter requires meterIds');
    }

    const componentFilter = validated.components
        ? new Set(validated.components)
        : null;

    const {idMap} = await resolveScope(sender, validated, repo);

    let total = 0;
    let onlineDevices = 0;
    const devices: EnergyCurrentDevice[] = [];

    for (const shellyID of Object.values(idMap)) {
        const dev = lookup(shellyID);
        const online = dev?.online ?? false;
        let channels = dev ? devicePowerChannels(dev) : [];
        if (componentFilter) {
            channels = channels.filter((c) =>
                componentFilter.has(c.componentKey)
            );
        }
        const watts = sumChannels(channels);
        total += watts;
        if (online) onlineDevices++;

        if (detail !== 'total') {
            devices.push(deviceRow(shellyID, online, watts, channels, detail));
        }
    }

    const response: EnergyCurrentResponse = {
        watts: total,
        asOf: new Date(Date.now()).toISOString(),
        onlineDevices
    };
    if (detail !== 'total') response.devices = devices;
    return response;
}

function deviceRow(
    shellyID: string,
    online: boolean,
    watts: number,
    channels: readonly PowerChannel[],
    detail: 'device' | 'channel'
): EnergyCurrentDevice {
    const row: EnergyCurrentDevice = {shellyID, online, watts};
    if (detail === 'channel') {
        row.channels = channels.map((c) => ({
            componentKey: c.componentKey,
            phase: c.phase,
            watts: c.watts
        }));
    }
    return row;
}

// scope / devices / meterIds select the population three different ways; at
// most one may be set.
function assertOneSelector(params: EnergyCurrentParams): void {
    const set = [params.scope, params.devices, params.meterIds].filter(
        (v) => v !== undefined
    );
    if (set.length > 1) {
        throw RpcError.InvalidParams(
            'scope, devices and meterIds are mutually exclusive'
        );
    }
}

// Live power summed per logical meter. Reads each meter's devices from the
// in-memory snapshot and attributes their channel power back to the meter.
async function meterCurrent(
    validated: EnergyCurrentParams,
    sender: SenderCapabilities,
    repo: EnergyRepository,
    lookup: LiveDeviceLookup,
    listMeters: ListMeters | undefined,
    detail: EnergyCurrentParams['detail']
): Promise<EnergyCurrentResponse> {
    const org = sender.getOrganizationId();
    if (!org) throw RpcError.Unauthorized();
    if (!listMeters) throw RpcError.InvalidParams('meter lookup unavailable');
    assertMeterMode(validated);

    const wanted = new Set(validated.meterIds);
    const selected = (await listMeters(org)).filter((m) => wanted.has(m.id));
    assertNoFormula(selected);

    const deviceIds = new Set<number>();
    for (const m of selected) {
        for (const p of m.points) deviceIds.add(p.deviceId);
    }
    // One id source for both the access check and the live read: the fleet
    // idMap. Using a second source (DeviceCollector) for access could deny an
    // accessible-but-offline device that the idMap still resolves.
    const {idMap} = repo.resolveFleetDevices();
    // Explicit meter read: fail loud if any device is unreadable, never a
    // partial/zero sum that would understate the meter.
    await assertDevicesAccessible(deviceIds, idMap, sender);

    const deviceLive = buildDeviceLive(deviceIds, idMap, lookup);
    const meterChannels: MeterDeviceChannels[] = selected.map((m) => ({
        id: m.id,
        points: m.points.map((p) => ({
            deviceId: p.deviceId,
            channel: p.channel
        }))
    }));
    const result = meterLiveWatts(meterChannels, deviceLive);

    const response: EnergyCurrentResponse = {
        watts: result.total,
        asOf: new Date(Date.now()).toISOString(),
        onlineDevices: result.onlineDevices
    };
    if (detail === 'meter') response.meters = result.perMeter;
    return response;
}

// meterIds mode rules: a non-empty selector, no components (they apply per
// device, not per meter), and only total/meter detail (device/channel are a
// per-device shape that meter mode does not produce).
function assertMeterMode(validated: EnergyCurrentParams): void {
    if (!validated.meterIds || validated.meterIds.length === 0) {
        throw RpcError.InvalidParams('meterIds must not be empty');
    }
    if (validated.components !== undefined) {
        throw RpcError.InvalidParams(
            'components is not supported with meterIds'
        );
    }
    const detail = validated.detail ?? 'total';
    if (detail !== 'total' && detail !== 'meter') {
        throw RpcError.InvalidParams(
            'detail must be total or meter when meterIds is set'
        );
    }
}

// A formula meter carries no points, so it has no live channels. Reject rather
// than silently report 0 — its combined energy is read via Energy.Query.
function assertNoFormula(meters: readonly EnergyLogicalMeter[]): void {
    const formula = meters.filter((m) => m.aggregationMode === 'formula');
    if (formula.length > 0) {
        throw RpcError.InvalidParams(
            `formula meters have no live power: ${formula
                .map((m) => m.id)
                .join(', ')} — use Energy.Query for their energy`
        );
    }
}

// Every device a selected meter measures must be readable by the caller; one
// inaccessible device fails the whole read (Unauthorized) rather than dropping
// silently to zero. Ids resolve through the SAME fleet idMap the live read uses,
// so an offline-but-accessible device (in the idMap, absent from the snapshot)
// is allowed and simply contributes 0 — a denial would be wrong. A device not
// in the idMap has no live power and no shellyID to check, so it contributes 0
// and leaks nothing.
async function assertDevicesAccessible(
    deviceIds: ReadonlySet<number>,
    idMap: Readonly<Record<number, string>>,
    sender: SenderCapabilities
): Promise<void> {
    const shellyIDs: string[] = [];
    for (const id of deviceIds) {
        const shellyID = idMap[id];
        if (shellyID) shellyIDs.push(shellyID);
    }
    const allowed = await accessibleShellyIds(shellyIDs, sender);
    for (const id of deviceIds) {
        const shellyID = idMap[id];
        if (shellyID && !allowed.has(shellyID))
            throw RpcError.Domain('PermissionDenied');
    }
}

// deviceId -> live status from the in-memory snapshot, keyed by the same fleet
// idMap used for the access check. A device absent from the snapshot has no live
// power (0) — distinct from being inaccessible.
function buildDeviceLive(
    deviceIds: ReadonlySet<number>,
    idMap: Readonly<Record<number, string>>,
    lookup: LiveDeviceLookup
): Map<number, DeviceLive> {
    const out = new Map<number, DeviceLive>();
    for (const deviceId of deviceIds) {
        const shellyID = idMap[deviceId];
        if (!shellyID) continue;
        const dev = lookup(shellyID);
        out.set(deviceId, {
            online: dev?.online ?? false,
            channels: dev ? devicePowerChannels(dev) : []
        });
    }
    return out;
}
