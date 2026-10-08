import type {MatchResult, NormalizedEvent} from './alert/types';
import * as postgres from './PostgresProvider';
import {
    projectRoleScalar,
    resolveRoleProjection
} from './virtualDevice/roleProjection';

export interface VirtualSourceRef {
    deviceExternalId: string;
    componentKey: string;
    dynamicCategory: string | null;
}

export interface AlertSubjectResolution {
    subjectType: 'device';
    virtualDeviceExternalId: string;
    virtualDeviceName: string;
    deviceKind: 'extracted' | 'composed' | 'connector';
    deviceType: string;
    categoryKey: string | null;
    profileId: string | null;
    locationId: number | null;
    roleKey: string | null;
    activeBinding: VirtualSourceRef | null;
    degradedReason: string | null;
}

export interface VirtualRoleState {
    roleKey: string;
    value: boolean | number | string | Record<string, unknown> | null;
    unit: string | null;
    health: 'ok' | 'degraded' | 'offline' | 'unbound';
    source: VirtualSourceRef | null;
    sourceTs: string | null;
}

export interface NotificationTemplateContext {
    resourceType: 'device';
    deviceKind: 'extracted' | 'composed' | 'connector';
    deviceExternalId: string;
    deviceName: string;
    roleKey: string | null;
    source: VirtualSourceRef | null;
    labels: Record<string, string>;
}

export interface ImportMappingResult {
    ok: boolean;
    mappedDeviceExternalId: string | null;
    mappedRoleKey: string | null;
    conflict: string | null;
}

interface VirtualAlertSubjectInput {
    organizationId: string;
    deviceExternalId: string;
    roleKey?: string | null;
    at?: string | Date | null;
}

interface VirtualAlertDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<T[]>;
}

interface VirtualSubjectRow {
    virtual_external_id: string;
    virtual_name: string;
    device_kind: 'extracted' | 'composed' | 'connector';
    device_type: string;
    category_key: string | null;
    profile_id: string | null;
    location_id: number | null;
    role_key: string | null;
    source_external_id: string | null;
    source_component_key: string | null;
    source_dynamic_category: string | null;
}

interface VirtualRoleStateRow extends VirtualSubjectRow {
    source_jdoc: Record<string, unknown> | null;
    source_updated: string | Date | null;
    unit: string | null;
    value_type: string | null;
    transform_json: Record<string, unknown> | null;
    source_snapshot_json: Record<string, unknown> | null;
    role_metadata_json: Record<string, unknown> | null;
}

const defaultDeps: VirtualAlertDeps = {
    queryRows: postgres.queryRows
};

export async function resolveVirtualAlertSubject(
    input: VirtualAlertSubjectInput,
    deps: VirtualAlertDeps = defaultDeps
): Promise<AlertSubjectResolution | null> {
    const rows = await deps.queryRows<VirtualSubjectRow>(subjectSql(), [
        input.organizationId,
        input.deviceExternalId,
        input.roleKey ?? null,
        input.at ?? null
    ]);
    const row = rows[0];
    if (!row) return null;
    return rowToSubjectResolution(row, input.roleKey ?? null);
}

export async function resolveVirtualRoleState(
    input: VirtualAlertSubjectInput,
    deps: VirtualAlertDeps = defaultDeps
): Promise<VirtualRoleState | null> {
    const rows = await deps.queryRows<VirtualRoleStateRow>(roleStateSql(), [
        input.organizationId,
        input.deviceExternalId,
        input.roleKey ?? null,
        input.at ?? null
    ]);
    const row = rows[0];
    if (!row) return null;
    const subject = rowToSubjectResolution(row, input.roleKey ?? null);
    if (!subject?.roleKey) return null;
    if (!subject.activeBinding) {
        return {
            roleKey: subject.roleKey,
            value: null,
            unit: null,
            health: 'unbound',
            source: null,
            sourceTs: null
        };
    }
    const projection = resolveRoleProjection({
        roleKey: subject.roleKey,
        sourceComponentKey: subject.activeBinding.componentKey,
        unit: row.unit,
        valueType: row.value_type,
        transformJson: row.transform_json,
        sourceSnapshot: row.source_snapshot_json,
        roleMetadata: row.role_metadata_json
    });
    const status = unknownRecord(row.source_jdoc?.status);
    const component = status?.[subject.activeBinding.componentKey];
    const value = projectRoleScalar(component, projection);
    return {
        roleKey: subject.roleKey,
        value: alertValue(value),
        unit: row.unit,
        health: value === null || value === undefined ? 'degraded' : 'ok',
        source: subject.activeBinding,
        sourceTs: dateIso(row.source_updated)
    };
}

export function buildVirtualAlertLabels(
    subject: AlertSubjectResolution
): Record<string, string> {
    const labels: Record<string, string> = {
        resource_type: subject.subjectType,
        device_kind: subject.deviceKind,
        device_external_id: subject.virtualDeviceExternalId,
        device_type: subject.deviceType
    };
    addLabel(labels, 'device_category', subject.categoryKey);
    addLabel(labels, 'virtual_role', subject.roleKey);
    addLabel(
        labels,
        'source_device_external_id',
        subject.activeBinding?.deviceExternalId
    );
    addLabel(
        labels,
        'source_component_key',
        subject.activeBinding?.componentKey
    );
    addLabel(labels, 'location_id', subject.locationId?.toString());
    addLabel(labels, 'profile_id', subject.profileId);
    return labels;
}

export function buildVirtualNotificationContext(
    subject: AlertSubjectResolution
): NotificationTemplateContext {
    return {
        resourceType: 'device',
        deviceKind: subject.deviceKind,
        deviceExternalId: subject.virtualDeviceExternalId,
        deviceName: subject.virtualDeviceName,
        roleKey: subject.roleKey,
        source: subject.activeBinding,
        labels: buildVirtualAlertLabels(subject)
    };
}

export async function mapImportedVirtualAlertSubject(
    input: VirtualAlertSubjectInput,
    deps: VirtualAlertDeps = defaultDeps
): Promise<ImportMappingResult> {
    const subject = await resolveVirtualAlertSubject(input, deps);
    if (!subject) {
        return {
            ok: false,
            mappedDeviceExternalId: null,
            mappedRoleKey: null,
            conflict: 'virtual_device_not_found'
        };
    }
    if (input.roleKey && subject.roleKey !== input.roleKey) {
        return {
            ok: false,
            mappedDeviceExternalId: subject.virtualDeviceExternalId,
            mappedRoleKey: null,
            conflict: 'virtual_role_not_found'
        };
    }
    return {
        ok: true,
        mappedDeviceExternalId: subject.virtualDeviceExternalId,
        mappedRoleKey: subject.roleKey,
        conflict: null
    };
}

export async function enrichVirtualAlertMatch(
    organizationId: string,
    match: MatchResult,
    deps: VirtualAlertDeps = defaultDeps
): Promise<MatchResult> {
    const roleKey = roleKeyFromContext(match.context);
    if (!roleKey) return match;
    const deviceExternalId = virtualDeviceExternalId(match);
    if (!deviceExternalId) return match;
    const subject = await resolveVirtualAlertSubject(
        {
            organizationId,
            deviceExternalId,
            roleKey
        },
        deps
    );
    if (!subject) return match;
    const context = buildVirtualNotificationContext(subject);
    return {
        ...match,
        context: {
            ...(match.context ?? {}),
            virtualDevice: context,
            labels: {
                ...(recordValue(match.context?.labels) ?? {}),
                ...context.labels
            }
        }
    };
}

/**
 * Attach the logical role that owns a projected component/entity match.
 * Evaluators stay device-agnostic; the projected entity descriptor remains
 * the single source of role identity for live, initial, and preview paths.
 */
export function attachVirtualRoleContext(
    match: MatchResult,
    event: NormalizedEvent
): MatchResult {
    if (
        event.kind !== 'device_status_changed' ||
        !event.shellyID.startsWith('vdev_') ||
        !event.device
    ) {
        return match;
    }
    if (roleKeyFromContext(match.context)) return match;
    const entities = event.device.entities ?? [];
    const component = match.context?.component;
    const targetedEntityId =
        match.subject.type === 'entity'
            ? match.subject.id
            : typeof component === 'string' &&
                (component.startsWith('component:') ||
                    component.startsWith('entity:'))
              ? component.slice(component.indexOf(':') + 1)
              : null;
    let entity = targetedEntityId
        ? entities.find((candidate) => candidate.id === targetedEntityId)
        : undefined;
    if (!entity && typeof component === 'string') {
        const separator = component.lastIndexOf(':');
        const type = component.slice(0, separator);
        const id = Number.parseInt(component.slice(separator + 1), 10);
        if (separator > 0 && Number.isFinite(id)) {
            entity = entities.find(
                (candidate) =>
                    candidate.type === type &&
                    unknownRecord(candidate.properties)?.id === id
            );
        }
    }
    const roleKey = unknownRecord(entity?.properties)?.roleKey;
    if (typeof roleKey !== 'string' || roleKey.length === 0) return match;
    return {
        ...match,
        context: {
            ...(match.context ?? {}),
            shellyID: event.shellyID,
            roleKey
        }
    };
}

function virtualDeviceExternalId(match: MatchResult): string | null {
    if (
        match.subject.type === 'device' &&
        match.subject.id.startsWith('vdev_')
    ) {
        return match.subject.id;
    }
    const shellyID = match.context?.shellyID;
    return typeof shellyID === 'string' && shellyID.startsWith('vdev_')
        ? shellyID
        : null;
}

function rowToSubjectResolution(
    row: VirtualSubjectRow,
    requestedRole: string | null
): AlertSubjectResolution {
    const roleKey = row.role_key ?? requestedRole;
    return {
        subjectType: 'device',
        virtualDeviceExternalId: row.virtual_external_id,
        virtualDeviceName: row.virtual_name,
        deviceKind: row.device_kind,
        deviceType: row.device_type,
        categoryKey: row.category_key,
        profileId: row.profile_id,
        locationId: row.location_id,
        roleKey,
        activeBinding: sourceRefFromRow(row),
        degradedReason:
            roleKey && !row.source_external_id ? 'role_unbound' : null
    };
}

function sourceRefFromRow(row: VirtualSubjectRow): VirtualSourceRef | null {
    if (!row.source_external_id || !row.source_component_key) return null;
    return {
        deviceExternalId: row.source_external_id,
        componentKey: row.source_component_key,
        dynamicCategory: row.source_dynamic_category
    };
}

function roleKeyFromContext(
    context: Record<string, unknown> | undefined
): string | null {
    const roleKey = context?.roleKey;
    return typeof roleKey === 'string' && roleKey.length > 0 ? roleKey : null;
}

function recordValue(value: unknown): Record<string, string> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => typeof v === 'string')
            .map(([k, v]) => [k, v as string])
    );
}

function unknownRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function alertValue(
    value: unknown
): boolean | number | string | Record<string, unknown> | null {
    if (
        value === null ||
        typeof value === 'boolean' ||
        typeof value === 'number' ||
        typeof value === 'string'
    ) {
        return value;
    }
    return unknownRecord(value);
}

function dateIso(value: string | Date | null): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== 'string') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addLabel(
    labels: Record<string, string>,
    key: string,
    value: string | null | undefined
): void {
    if (value) labels[key] = value;
}

function subjectSql(): string {
    return `SELECT
            dl.external_id AS virtual_external_id,
            vd.name AS virtual_name,
            vd.kind AS device_kind,
            vd.type_key AS device_type,
            vd.category_key,
            vd.profile_id::text AS profile_id,
            vd.location_id,
            b.role_key,
            src.external_id AS source_external_id,
            b.source_component_key,
            b.source_dynamic_category
          FROM device.virtual_device vd
          JOIN device.list dl
            ON dl.id = vd.device_list_id
           AND dl.organization_id = vd.organization_id
     LEFT JOIN LATERAL (
            SELECT *
              FROM device.virtual_device_binding b
             WHERE b.organization_id = vd.organization_id
               AND b.virtual_device_list_id = vd.device_list_id
               AND ($3::varchar IS NULL OR b.role_key = $3)
               AND b.effective_from <= COALESCE($4::timestamptz, NOW())
               AND (
                    b.effective_to IS NULL OR
                    b.effective_to > COALESCE($4::timestamptz, NOW())
               )
             ORDER BY b.role_key ASC, b.effective_from DESC
             LIMIT 1
          ) b ON TRUE
     LEFT JOIN device.list src
            ON src.id = b.source_device_list_id
           AND src.organization_id = b.organization_id
         WHERE vd.organization_id = $1
           AND dl.external_id = $2
           AND vd.deleted_at IS NULL
         LIMIT 1`;
}

function roleStateSql(): string {
    return subjectSql().replace(
        'b.source_dynamic_category',
        `b.source_dynamic_category,
            src.jdoc AS source_jdoc,
            src.updated AS source_updated,
            b.unit,
            b.value_type,
            b.transform_json,
            b.source_snapshot_json,
            b.role_metadata_json`
    );
}
