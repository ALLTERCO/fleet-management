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

import {tuning} from '../../config/tuning';
import type {SensorRepository} from '../../modules/repositories/SensorRepository';
import {
    loadVirtualRoleHistorySources,
    type VirtualRoleSource
} from '../../modules/virtualDevice/energySources';
import {readVirtualDeviceRoleHistory} from '../../modules/virtualDevice/historyRepository';
import {filterReadableVirtualSourceMap} from '../../modules/virtualDevice/sourceAccessPolicy';
import RpcError from '../../rpc/RpcError';
import {MAX_RANGE, parseDateRange} from '../../rpc/validation';
import {
    SENSOR_EVENTS_LIMITS,
    type SensorEventRow,
    type SensorEventsParams,
    type SensorEventsResponse,
    UNDECLARED_ROLE_SENSOR_SOURCE
} from '../../types/api/sensor';
import {virtualSourceOrganization} from '../energy/queryHandler';

// Same OOM ceiling as Sensor.Query and Energy.Query, one cap for every read.
const SENSOR_EVENTS_ROW_CEILING = tuning.energy.queryRowLimit;

export interface SenderCapabilities {
    getOrganizationId(): string | undefined;
    canCrossOrganizations?(): boolean;
    filterAccessibleDevices(ids: string[]): Promise<Set<string>>;
}

export type DeviceIdResolver = (shellyIDs: string[]) => Promise<{
    internalIds: number[];
    idMap: Record<number, string>;
}>;

export interface SensorEventVirtualDeps {
    loadRoleSources: typeof loadVirtualRoleHistorySources;
    readRoleHistory: typeof readVirtualDeviceRoleHistory;
}

const defaultVirtualDeps: SensorEventVirtualDeps = {
    loadRoleSources: loadVirtualRoleHistorySources,
    readRoleHistory: readVirtualDeviceRoleHistory
};

export async function handleSensorEvents(
    params: SensorEventsParams,
    sender: SenderCapabilities,
    repo: SensorRepository,
    resolveDeviceIds: DeviceIdResolver,
    virtualDeps: SensorEventVirtualDeps = defaultVirtualDeps
): Promise<SensorEventsResponse> {
    const {from, to} = parseDateRange(params.from, params.to, MAX_RANGE.YEAR);

    const allowed = await resolveAllowedDevices(sender, params.devices);
    if (allowed.length === 0) {
        throw RpcError.Domain('PermissionDenied');
    }

    // Org passed for defense-in-depth alongside the device-access filter
    // above — same pattern as Energy.Query's devices path (queryEnvRows
    // always forwards sender.getOrganizationId() regardless of branch).
    const organizationId = sender.getOrganizationId() ?? null;
    const {internalIds, idMap} = await resolveDeviceIds(allowed);
    const virtualIds = internalIds.filter((id) =>
        idMap[id]?.startsWith('vdev_')
    );
    const loadedVirtualRoles =
        virtualIds.length > 0
            ? await virtualDeps.loadRoleSources(
                  virtualSourceOrganization(organizationId, sender),
                  virtualIds
              )
            : new Map<number, VirtualRoleSource[]>();
    const virtualRoles = await filterReadableVirtualSourceMap(
        sender,
        loadedVirtualRoles,
        {from, to}
    );
    const limit = params.limit ?? SENSOR_EVENTS_LIMITS.defaultRowLimit;
    const offset = params.offset ?? 0;
    const physicalIds = internalIds.filter((id) => !virtualRoles.has(id));
    const hasVirtual = virtualRoles.size > 0;
    // Aliasing adds and drops rows, so the page slices the materialized set.
    const targetRows = hasVirtual
        ? Math.min(SENSOR_EVENTS_ROW_CEILING + 1, offset + limit + 1)
        : limit + 1;
    let rawOffset = hasVirtual ? 0 : offset;
    // Keep the unpaged DB function for an offset-less physical read.
    const dbPaged = hasVirtual || offset > 0;
    let lastPhysicalPage = await repo.queryEvents({
        organizationId,
        internalIds: physicalIds,
        kind: params.kind ?? null,
        from,
        to,
        limit: targetRows,
        ...(dbPaged ? {offset: rawOffset} : {})
    });
    rawOffset += lastPhysicalPage.length;

    const selectedIds = new Set(internalIds);
    const sourceIdByExternalId = new Map(
        Object.entries(idMap).map(([id, externalId]) => [
            externalId,
            Number(id)
        ])
    );
    const aliasedPhysical = new Set<string>();
    const virtualItems: SensorEventRow[] = [];
    const seenLineage = new Set<string>();
    for (const [virtualId, roles] of virtualRoles) {
        const externalId = idMap[virtualId];
        for (const role of roles) {
            if (
                role.series !== 'sensor_event' ||
                (params.kind !== undefined && role.field !== params.kind)
            ) {
                continue;
            }
            // Same rule as Sensor.Query: an undeclared binding is not a claim
            // of device health, so it must not be labelled `internal`.
            const readingSource =
                role.sensorSource ?? UNDECLARED_ROLE_SENSOR_SOURCE;
            const roleOrganizationId = role.organizationId ?? organizationId;
            if (!roleOrganizationId) continue;
            const history = await virtualDeps.readRoleHistory(
                roleOrganizationId,
                {
                    externalId,
                    roleKey: role.roleKey,
                    from: from.toISOString(),
                    to: to.toISOString(),
                    order: 'desc',
                    limit: targetRows
                }
            );
            for (const point of history.items) {
                const pointSource = point.readingSource ?? readingSource;
                const channel =
                    point.channel ??
                    componentChannel(point.source.componentKey);
                const pointSourceId = sourceIdByExternalId.get(
                    point.source.deviceExternalId
                );
                if (
                    pointSourceId !== undefined &&
                    selectedIds.has(pointSourceId)
                ) {
                    aliasedPhysical.add(
                        `${pointSourceId}|${role.field}|${pointSource}|${channel}|${point.ts}`
                    );
                }
                const lineage = `${virtualId}|${point.bindingId}|${role.field}|${pointSource}|${channel}|${point.ts}`;
                if (seenLineage.has(lineage)) continue;
                seenLineage.add(lineage);
                virtualItems.push({
                    ts: point.ts,
                    device: virtualId,
                    shellyID: externalId,
                    source: pointSource,
                    kind: role.field,
                    channel,
                    state: Number(point.value ?? 0),
                    roleKey: role.roleKey
                });
            }
        }
    }
    const mapPhysicalRows = (
        rows: Awaited<ReturnType<SensorRepository['queryEvents']>>
    ): SensorEventRow[] =>
        rows
            .map((r) => ({
                ts: r.ts,
                device: r.device_id,
                shellyID: idMap[r.device_id] ?? null,
                source: r.source,
                kind: r.kind,
                channel: r.channel,
                state: r.state
            }))
            .filter(
                (row) =>
                    !aliasedPhysical.has(
                        `${row.device}|${row.kind}|${row.source}|${row.channel ?? 0}|${row.ts}`
                    )
            );
    const physicalItems = mapPhysicalRows(lastPhysicalPage);
    const logicalItems = (): SensorEventRow[] => {
        const merged = [...physicalItems, ...virtualItems];
        merged.sort((a, b) => b.ts.localeCompare(a.ts));
        return merged;
    };
    let items = logicalItems();
    while (
        hasVirtual &&
        items.length < targetRows &&
        lastPhysicalPage.length === targetRows
    ) {
        lastPhysicalPage = await repo.queryEvents({
            organizationId,
            internalIds: physicalIds,
            kind: params.kind ?? null,
            from,
            to,
            limit: targetRows,
            offset: rawOffset
        });
        rawOffset += lastPhysicalPage.length;
        physicalItems.push(...mapPhysicalRows(lastPhysicalPage));
        items = logicalItems();
    }
    if (items.length > SENSOR_EVENTS_ROW_CEILING) {
        throw rowsExceeded(items.length);
    }
    // The DB read already skipped offset; only the materialized set has it.
    const pageStart = hasVirtual ? offset : 0;
    const pageEnd = Math.min(items.length, pageStart + limit);
    const has_more = pageEnd < items.length;
    const page = items.slice(pageStart, pageEnd);
    return {
        items: page,
        total: offset + page.length + (has_more ? 1 : 0),
        limit,
        offset,
        has_more
    };
}

function rowsExceeded(rowCount: number): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message: `Result too large (${rowCount} rows). Use a shorter range or a smaller page.`,
        field: 'range',
        details: {rowCount, limit: SENSOR_EVENTS_ROW_CEILING}
    });
}

function componentChannel(componentKey: string): number {
    const raw = componentKey.slice(componentKey.lastIndexOf(':') + 1);
    const channel = Number.parseInt(raw, 10);
    return Number.isInteger(channel) && channel >= 0 ? channel : 0;
}

async function resolveAllowedDevices(
    sender: SenderCapabilities,
    devices: string[]
): Promise<string[]> {
    const accessible = await sender.filterAccessibleDevices(devices);
    return devices.filter((id) => accessible.has(id));
}
