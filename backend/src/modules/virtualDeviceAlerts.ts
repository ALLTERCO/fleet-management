import type {MatchResult} from './alert/types';
import * as postgres from './PostgresProvider';

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
    const subject = await resolveVirtualAlertSubject(input, deps);
    if (!subject?.roleKey) return null;
    return {
        roleKey: subject.roleKey,
        value: null,
        unit: null,
        health: subject.activeBinding ? 'ok' : 'unbound',
        source: subject.activeBinding,
        sourceTs: null
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
    if (match.subject.type !== 'device') return match;
    const roleKey = roleKeyFromContext(match.context);
    if (!roleKey) return match;
    const subject = await resolveVirtualAlertSubject(
        {
            organizationId,
            deviceExternalId: match.subject.id,
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
