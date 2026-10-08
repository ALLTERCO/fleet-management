import RpcError from '../../rpc/RpcError';
import * as postgres from '../PostgresProvider';
import {resolveRoleProjection} from './roleProjection';

/** One tenant, or every tenant for a caller allowed to cross organizations. */
export type VirtualSourceOrganization =
    | string
    | {readonly crossOrganization: true};

export interface VirtualEnergySource {
    organizationId?: string;
    virtualDeviceListId: number;
    roleKey: string;
    sourceDeviceListId: number;
    sourceExternalId: string;
    /** Every retained generation for authorization; descriptor remains one/role. */
    historySourceExternalIds?: string[];
    historySources?: Array<{
        externalId: string;
        effectiveFrom: string;
        effectiveTo: string | null;
    }>;
    sourceComponentKey: string;
    channel: number;
    tag: string;
    series: 'energy';
    roleMetadata: Record<string, unknown> | null;
    sourceSnapshot: Record<string, unknown> | null;
    transformJson: Record<string, unknown> | null;
    unit: string | null;
    valueType: string | null;
    sensorSource?: string;
    commodity?: string;
    electricalSource?: string;
}

/** Convert a projected counter role to the canonical kWh used by Energy APIs. */
export function virtualEnergyCounterValueKWh(
    source: Pick<
        VirtualEnergySource,
        'tag' | 'unit' | 'transformJson' | 'roleMetadata'
    >,
    value: unknown
): number | null {
    if (
        source.tag !== 'total_act_energy' &&
        source.tag !== 'total_act_ret_energy'
    ) {
        return null;
    }
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return null;
    // Role history is expressed in the role's declared unit. Legacy bindings
    // without a unit expose the physical energy store's native Wh values.
    return source.unit?.trim().toLowerCase() === 'kwh' ||
        legacyProjectionAlreadyConvertsWhToKWh(source)
        ? numeric
        : numeric / 1000;
}

function legacyProjectionAlreadyConvertsWhToKWh(
    source: Pick<VirtualEnergySource, 'transformJson' | 'roleMetadata'>
): boolean {
    const projection = source.roleMetadata?.projection;
    const persistedTransform =
        projection && typeof projection === 'object'
            ? (projection as Record<string, unknown>).transform
            : undefined;
    const transform =
        persistedTransform && typeof persistedTransform === 'object'
            ? (persistedTransform as Record<string, unknown>)
            : source.transformJson;
    return transform?.kind === 'scale' && transform.factor === 0.001;
}

export interface VirtualRoleSource
    extends Omit<VirtualEnergySource, 'tag' | 'series'> {
    series: 'status' | 'sensor_numeric' | 'sensor_event' | 'energy';
    field: string;
}

interface SourceRow {
    organization_id: string;
    virtual_device_list_id: number;
    role_key: string;
    source_device_list_id: number;
    source_external_id: string;
    source_component_key: string;
    role_metadata_json: Record<string, unknown> | null;
    source_snapshot_json: Record<string, unknown> | null;
    transform_json: Record<string, unknown> | null;
    unit: string | null;
    value_type: string | null;
    effective_from: Date | string;
    effective_to: Date | string | null;
}

export interface VirtualEnergySourceDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<T[]>;
}

const defaultDeps: VirtualEnergySourceDeps = {queryRows: postgres.queryRows};

export async function loadVirtualEnergySources(
    organizationId: VirtualSourceOrganization,
    virtualDeviceListIds: readonly number[],
    deps: VirtualEnergySourceDeps = defaultDeps
): Promise<Map<number, VirtualEnergySource[]>> {
    return loadVirtualEnergySourcesByLifetime(
        organizationId,
        virtualDeviceListIds,
        deps,
        false,
        false
    );
}

/** Every binding generation overlapping retained telemetry history. */
export async function loadVirtualEnergyHistorySources(
    organizationId: VirtualSourceOrganization,
    virtualDeviceListIds: readonly number[],
    deps: VirtualEnergySourceDeps = defaultDeps
): Promise<Map<number, VirtualEnergySource[]>> {
    return loadVirtualEnergySourcesByLifetime(
        organizationId,
        virtualDeviceListIds,
        deps,
        true,
        true
    );
}

async function loadVirtualEnergySourcesByLifetime(
    organizationId: VirtualSourceOrganization,
    virtualDeviceListIds: readonly number[],
    deps: VirtualEnergySourceDeps,
    includeHistorical: boolean,
    oneDescriptorPerRole: boolean
): Promise<Map<number, VirtualEnergySource[]>> {
    const all = await loadVirtualRoleSourcesInternal(
        organizationId,
        virtualDeviceListIds,
        deps,
        includeHistorical,
        oneDescriptorPerRole
    );
    const out = new Map<number, VirtualEnergySource[]>();
    for (const [deviceId, roles] of all) {
        for (const role of roles) {
            if (role.series !== 'energy') continue;
            const source: VirtualEnergySource = {
                ...role,
                series: 'energy',
                tag: role.field
            };
            const bucket = out.get(deviceId) ?? [];
            bucket.push(source);
            out.set(deviceId, bucket);
        }
    }
    return out;
}

export async function loadVirtualRoleSources(
    organizationId: VirtualSourceOrganization,
    virtualDeviceListIds: readonly number[],
    deps: VirtualEnergySourceDeps = defaultDeps
): Promise<Map<number, VirtualRoleSource[]>> {
    return loadVirtualRoleSourcesInternal(
        organizationId,
        virtualDeviceListIds,
        deps,
        false,
        false
    );
}

/** Every role binding generation used by historical standard APIs. */
export async function loadVirtualRoleHistorySources(
    organizationId: VirtualSourceOrganization,
    virtualDeviceListIds: readonly number[],
    deps: VirtualEnergySourceDeps = defaultDeps
): Promise<Map<number, VirtualRoleSource[]>> {
    return loadVirtualRoleSourcesInternal(
        organizationId,
        virtualDeviceListIds,
        deps,
        true,
        true
    );
}

async function loadVirtualRoleSourcesInternal(
    organization: VirtualSourceOrganization,
    virtualDeviceListIds: readonly number[],
    deps: VirtualEnergySourceDeps,
    includeHistorical: boolean,
    oneDescriptorPerRole: boolean
): Promise<Map<number, VirtualRoleSource[]>> {
    if (virtualDeviceListIds.length === 0) return new Map();
    const tenant = tenantFilter(organization);
    const rows = await deps.queryRows<SourceRow>(
        `SELECT
            b.organization_id,
            b.virtual_device_list_id,
            b.role_key,
            b.source_device_list_id,
            src.external_id AS source_external_id,
            b.source_component_key,
            b.role_metadata_json,
            b.source_snapshot_json,
            b.transform_json,
            b.unit,
            b.value_type,
            b.effective_from,
            b.effective_to
           FROM device.virtual_device_binding b
           JOIN device.virtual_device vd
             ON vd.device_list_id = b.virtual_device_list_id
            AND vd.organization_id = b.organization_id
            AND vd.deleted_at IS NULL
           JOIN device.list src
            ON src.id = b.source_device_list_id
            AND src.organization_id = b.organization_id
            AND ($3::boolean OR src.deleted_at IS NULL)
          WHERE ($4::boolean OR b.organization_id = $1)
            AND b.virtual_device_list_id = ANY($2::integer[])
            AND ($3::boolean OR (
                b.effective_to IS NULL AND b.effective_from <= NOW()
            ))
          ORDER BY
            b.virtual_device_list_id,
            b.role_key,
            b.effective_from DESC,
            b.created_at DESC,
            b.id DESC`,
        [
            tenant.organizationId,
            [...virtualDeviceListIds],
            includeHistorical,
            tenant.crossOrganization
        ]
    );
    const out = new Map<number, VirtualRoleSource[]>();
    const describedRoles = new Set<string>();
    const historySourcesByRole = new Map<string, string[]>();
    const historySegmentsByRole = new Map<
        string,
        Array<{
            externalId: string;
            effectiveFrom: string;
            effectiveTo: string | null;
        }>
    >();
    if (oneDescriptorPerRole) {
        for (const row of rows) {
            const key = `${row.virtual_device_list_id}|${row.role_key}`;
            const sourceIds = historySourcesByRole.get(key) ?? [];
            if (!sourceIds.includes(row.source_external_id)) {
                sourceIds.push(row.source_external_id);
            }
            historySourcesByRole.set(key, sourceIds);
            const segments = historySegmentsByRole.get(key) ?? [];
            segments.push({
                externalId: row.source_external_id,
                effectiveFrom: new Date(row.effective_from).toISOString(),
                effectiveTo:
                    row.effective_to == null
                        ? null
                        : new Date(row.effective_to).toISOString()
            });
            historySegmentsByRole.set(key, segments);
        }
    }
    for (const row of rows) {
        const descriptorKey = `${row.virtual_device_list_id}|${row.role_key}`;
        if (oneDescriptorPerRole && describedRoles.has(descriptorKey)) continue;
        describedRoles.add(descriptorKey);
        const projection = resolveRoleProjection({
            roleKey: row.role_key,
            sourceComponentKey: row.source_component_key,
            unit: row.unit,
            valueType: row.value_type,
            roleMetadata: row.role_metadata_json,
            sourceSnapshot: row.source_snapshot_json,
            transformJson: row.transform_json
        });
        const source: VirtualRoleSource = {
            organizationId: row.organization_id,
            virtualDeviceListId: row.virtual_device_list_id,
            roleKey: row.role_key,
            sourceDeviceListId: row.source_device_list_id,
            sourceExternalId: row.source_external_id,
            ...(oneDescriptorPerRole
                ? {
                      historySourceExternalIds: historySourcesByRole.get(
                          descriptorKey
                      ) ?? [row.source_external_id],
                      historySources:
                          historySegmentsByRole.get(descriptorKey) ?? []
                  }
                : {}),
            sourceComponentKey: row.source_component_key,
            channel: componentChannel(row.source_component_key),
            series: projection.series,
            field: projection.field,
            ...(projection.sensorSource
                ? {sensorSource: projection.sensorSource}
                : {}),
            ...(projection.commodity ? {commodity: projection.commodity} : {}),
            ...(projection.electricalSource
                ? {electricalSource: projection.electricalSource}
                : {}),
            roleMetadata: row.role_metadata_json,
            sourceSnapshot: row.source_snapshot_json,
            transformJson: row.transform_json,
            unit: row.unit,
            valueType: row.value_type
        };
        const bucket = out.get(row.virtual_device_list_id) ?? [];
        bucket.push(source);
        out.set(row.virtual_device_list_id, bucket);
    }
    return out;
}

// Bindings are tenant rows: an empty organization is refused, never read as
// "every tenant"; crossing tenants must be asked for by name.
function tenantFilter(organization: VirtualSourceOrganization): {
    organizationId: string | null;
    crossOrganization: boolean;
} {
    if (typeof organization !== 'string') {
        return {organizationId: null, crossOrganization: true};
    }
    if (!organization) throw RpcError.Domain('OrgScopeRequired');
    return {organizationId: organization, crossOrganization: false};
}

function componentChannel(componentKey: string): number {
    const raw = componentKey.slice(componentKey.lastIndexOf(':') + 1);
    const channel = Number.parseInt(raw, 10);
    return Number.isInteger(channel) && channel >= 0 ? channel : 0;
}
