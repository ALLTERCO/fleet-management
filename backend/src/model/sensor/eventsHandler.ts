/**
 * Pure handler for `Sensor.Events`.
 *
 * Mirrors Energy.Query's devices-scope path (queryHandler.ts resolveScope,
 * `validated.devices` branch): filter the requested shellyIDs through the
 * sender's device access, resolve to internal ids, then query — same
 * permission model, no group/location/tag/fleet scope yet (see
 * types/api/sensor.ts for why devices-only is enough for a first cut).
 *
 * Takes a minimal sender interface (not CommandSender) so tests can pass a
 * structurally-typed fake, same reasoning as queryHandler's SenderCapabilities.
 * The shellyID→internal-id resolver is injected too (mirrors
 * EnergyRepositoryDeps.resolveDeviceIds) so a unit test never has to import
 * PostgresProvider — the Component wires the real one.
 */

import type {SensorRepository} from '../../modules/repositories/SensorRepository';
import RpcError from '../../rpc/RpcError';
import {MAX_RANGE, parseDateRange} from '../../rpc/validation';
import {
    SENSOR_EVENTS_LIMITS,
    type SensorEventRow,
    type SensorEventsParams,
    type SensorEventsResponse
} from '../../types/api/sensor';

export interface SenderCapabilities {
    getOrganizationId(): string | undefined;
    filterAccessibleDevices(ids: string[]): Promise<Set<string>>;
}

export type DeviceIdResolver = (shellyIDs: string[]) => Promise<{
    internalIds: number[];
    idMap: Record<number, string>;
}>;

export async function handleSensorEvents(
    params: SensorEventsParams,
    sender: SenderCapabilities,
    repo: SensorRepository,
    resolveDeviceIds: DeviceIdResolver
): Promise<SensorEventsResponse> {
    const {from, to} = parseDateRange(params.from, params.to, MAX_RANGE.YEAR);

    const allowed = await resolveAllowedDevices(sender, params.devices);
    if (allowed.length === 0) {
        throw RpcError.Domain('PermissionDenied');
    }

    // Org passed for defense-in-depth alongside the device-access filter
    // above — same pattern as Energy.Query's devices path (queryEnvRows
    // always forwards sender.getOrganizationId() regardless of branch).
    const {internalIds, idMap} = await resolveDeviceIds(allowed);
    const rows = await repo.queryEvents({
        organizationId: sender.getOrganizationId() ?? null,
        internalIds,
        kind: params.kind ?? null,
        from,
        to,
        limit: params.limit ?? SENSOR_EVENTS_LIMITS.defaultRowLimit
    });

    const items: SensorEventRow[] = rows.map((r) => ({
        ts: r.ts,
        device: r.device_id,
        shellyID: idMap[r.device_id] ?? null,
        source: r.source,
        kind: r.kind,
        channel: r.channel,
        state: r.state
    }));
    return {items};
}

async function resolveAllowedDevices(
    sender: SenderCapabilities,
    devices: string[]
): Promise<string[]> {
    const accessible = await sender.filterAccessibleDevices(devices);
    return devices.filter((id) => accessible.has(id));
}
