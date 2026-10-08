// Project active bindings onto a virtual-device row so list/get callers see
// role-backed entities, status snapshots, capabilities and per-role health
// instead of empty shells. Output is additive — existing fields stay.

import type {VirtualDeviceDto} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';
import {
    type ActiveVirtualDeviceBinding,
    loadActiveVirtualDeviceBindings
} from './bindingReadRepository';
import {
    assignVirtualComponentIds,
    type ProjectedVirtualEntity,
    projectVirtualEntity,
    virtualEntityType
} from './entityProjection';
import {
    computeDeviceHealth,
    computeRoleHealth,
    type DeviceHealth,
    type VirtualDevicePresence,
    type VirtualDeviceRoleHealth,
    type VirtualDeviceRoleStatus
} from './health';
import {
    projectRoleScalar,
    resolveRoleProjection,
    shapeProjectedRoleStatus,
    type VirtualRoleProjection
} from './roleProjection';

export type {
    DeviceHealth,
    VirtualDevicePresence,
    VirtualDeviceRoleHealth,
    VirtualDeviceRoleStatus
};

export interface VirtualDeviceRoleStatusEntry {
    available: boolean;
    value: unknown;
    source: {
        deviceExternalId: string;
        componentKey: string;
    };
}

export interface VirtualDeviceMetricRole {
    roleKey: string;
    available: boolean;
    value: unknown;
    unit: string | null;
    projection: VirtualRoleProjection;
}

export type VirtualDeviceEntity = ProjectedVirtualEntity;

export interface VirtualDeviceReadModel {
    externalId: string;
    statusRoles: Record<string, VirtualDeviceRoleStatusEntry>;
    metricRoles?: VirtualDeviceMetricRole[];
    entityIds: string[];
    entityDetails: VirtualDeviceEntity[];
    capabilities: Record<string, unknown>;
    methods: string[];
    roleHealth: Record<string, VirtualDeviceRoleHealth>;
    presence: VirtualDevicePresence;
    health: DeviceHealth;
}

export interface SourceSnapshot {
    presence: 'online' | 'offline' | 'pending';
    status: Record<string, unknown> | null;
}

export interface VirtualDeviceReadModelDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    // null = source unknown to FM (yields `missing_source` role health).
    getSourceSnapshot(externalId: string): SourceSnapshot | null;
}

export interface BuildVirtualDeviceReadModelsInput {
    organizationId: string;
    devices: readonly VirtualDeviceDto[];
}

export async function buildVirtualDeviceReadModels(
    input: BuildVirtualDeviceReadModelsInput,
    deps: VirtualDeviceReadModelDeps
): Promise<Map<string, VirtualDeviceReadModel>> {
    const out = new Map<string, VirtualDeviceReadModel>();
    if (input.devices.length === 0) return out;
    const bindingsByDevice = await loadActiveVirtualDeviceBindings(
        {
            organizationId: input.organizationId,
            deviceListIds: input.devices.map((d) => d.deviceListId)
        },
        deps
    );
    for (const device of input.devices) {
        const bindings = bindingsByDevice.get(device.deviceListId) ?? [];
        out.set(device.externalId, projectDevice(device, bindings, deps));
    }
    return out;
}

function projectDevice(
    device: VirtualDeviceDto,
    bindings: readonly ActiveVirtualDeviceBinding[],
    deps: VirtualDeviceReadModelDeps
): VirtualDeviceReadModel {
    const statusRoles: Record<string, VirtualDeviceRoleStatusEntry> = {};
    const metricRoles: VirtualDeviceMetricRole[] = [];
    const entityIds: string[] = [];
    const entityDetails: VirtualDeviceEntity[] = [];
    const roleHealth: Record<string, VirtualDeviceRoleHealth> = {};
    const readRoles: string[] = [];
    const writableRoles: string[] = [];
    const componentIds = assignVirtualComponentIds(
        bindings.map((binding) => ({
            roleKey: binding.roleKey,
            sourceComponentKey: binding.sourceComponentKey,
            entityType: virtualEntityType(binding)
        }))
    );

    for (const binding of bindings) {
        const snapshot = deps.getSourceSnapshot(binding.sourceExternalId);
        const sourceComponentStatus = snapshot
            ? readComponentStatus(snapshot.status, binding.sourceComponentKey)
            : null;
        const projection = resolveRoleProjection(binding);
        const scalar = projectRoleScalar(sourceComponentStatus, projection);
        const sourcePresent = snapshot !== null;
        const sourceOnline = snapshot?.presence === 'online';
        const componentPresent = scalar !== null && scalar !== undefined;
        const available = sourceOnline && componentPresent;

        const writable = binding.writable === true;
        const entity = projectVirtualEntity({
            device,
            binding,
            available,
            componentId: componentIds.get(binding.roleKey)
        });
        statusRoles[binding.roleKey] = {
            available,
            value: shapeProjectedRoleStatus(entity.type, scalar),
            source: {
                deviceExternalId: binding.sourceExternalId,
                componentKey: binding.sourceComponentKey
            }
        };
        metricRoles.push({
            roleKey: binding.roleKey,
            available,
            value: scalar,
            unit: binding.unit,
            projection
        });
        entityIds.push(entity.id);
        entityDetails.push(entity);

        roleHealth[binding.roleKey] = computeRoleHealth({
            roleKey: binding.roleKey,
            sourceExternalId: binding.sourceExternalId,
            sourceComponentKey: binding.sourceComponentKey,
            sourcePresent,
            sourceOnline,
            componentPresent,
            required: binding.required ?? true,
            writable
        });

        readRoles.push(binding.roleKey);
        if (writable) writableRoles.push(binding.roleKey);
    }

    const hostPresence =
        device.kind === 'extracted'
            ? hostPresenceForExtracted(device, deps)
            : null;
    const health = computeDeviceHealth({
        kind: device.kind,
        roleHealth: Object.values(roleHealth),
        hostPresence
    });

    return {
        externalId: device.externalId,
        statusRoles,
        metricRoles,
        entityIds,
        entityDetails,
        capabilities: {
            roles: {read: readRoles, writable: writableRoles}
        },
        methods:
            writableRoles.length > 0 ? ['virtualdevice.Command.Invoke'] : [],
        roleHealth,
        presence: health.status,
        health
    };
}

function hostPresenceForExtracted(
    device: VirtualDeviceDto,
    deps: VirtualDeviceReadModelDeps
): 'online' | 'offline' | 'pending' | null {
    const hostId = (
        device.metadata as {extraction?: {sourceHostExternalId?: string}}
    )?.extraction?.sourceHostExternalId;
    if (!hostId) return null;
    const snapshot = deps.getSourceSnapshot(hostId);
    return snapshot?.presence ?? null;
}

export const defaultReadModelDeps: Omit<
    VirtualDeviceReadModelDeps,
    'getSourceSnapshot'
> = {
    queryRows: postgres.queryRows
};

export interface MergeableRow {
    entities: string[];
    capabilities: unknown;
    methods?: string[];
    status: unknown;
    presence?: 'online' | 'offline' | 'pending';
}

// Merge a read model into an existing device-list row without dropping any
// pre-existing fields. Caller keeps its concrete row type via the spread.
export function mergeReadModelIntoRow<Row extends MergeableRow>(
    row: Row,
    model: VirtualDeviceReadModel
): Row {
    const baseStatus = (row.status as Record<string, unknown>) ?? {};
    const virtualStatus =
        (baseStatus.virtualdevice as Record<string, unknown>) ?? {};
    // Mirror each projected role's source value to a top-level
    // `${entity.type}:${entity.properties.id}` key so existing card
    // components (CardValue_Sensor, _Switch, _Virtual, ...) which look up
    // `device.status[`${e.type}:${e.properties.id}`]` resolve to a real
    // value instead of undefined. Without this mirror, virtual-device
    // entities render with their name only and no measurement.
    const projectedTopLevel: Record<string, unknown> = {};
    for (const entity of model.entityDetails) {
        const role = model.statusRoles[entity.properties.roleKey];
        if (!role || role.value === null || role.value === undefined) continue;
        const key = `${entity.type}:${entity.properties.id}`;
        if (baseStatus[key] === undefined) {
            projectedTopLevel[key] = role.value;
        }
        // Logical entity-target alert rules address component:<entity.id>.
        // Mirror the same projected status under that stable identity so
        // Device.List, initial evaluation, and Rule.Preview share one shape.
        if (baseStatus[entity.id] === undefined) {
            projectedTopLevel[entity.id] = role.value;
        }
    }
    const merged = {
        ...row,
        // Collapse non-online → offline for clients that only know online/offline.
        presence: model.presence === 'online' ? row.presence : 'offline',
        entities: [...row.entities, ...model.entityIds],
        capabilities: {
            ...(row.capabilities as Record<string, unknown>),
            ...model.capabilities
        },
        methods:
            model.methods.length > 0
                ? [...(row.methods ?? []), ...model.methods]
                : row.methods,
        status: {
            ...baseStatus,
            ...projectedTopLevel,
            virtualdevice: {
                ...virtualStatus,
                presence: model.presence,
                roles: model.statusRoles,
                health: {
                    status: model.health.status,
                    roles: model.roleHealth,
                    reasons: model.health.reasons
                }
            }
        }
    };
    return merged as Row;
}

function readComponentStatus(
    deviceStatus: Record<string, unknown> | null,
    componentKey: string
): unknown {
    if (!deviceStatus) return null;
    const value = deviceStatus[componentKey];
    return value === undefined ? null : value;
}
