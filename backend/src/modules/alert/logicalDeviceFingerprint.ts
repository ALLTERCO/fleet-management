import RpcError from '../../rpc/RpcError';
import * as postgres from '../PostgresProvider';
import type {MatchResult} from './types';

interface DeviceIdRow {
    id: number;
}

interface PublicSubjectRow {
    alert_id: number;
    external_id: string;
    source_entity_suffix: string | null;
    source_subject_type: string;
}

interface EntityReferenceRow {
    device_id: number | null;
    entity_suffix: string | null;
}

export interface LogicalDeviceHint {
    deviceId: number;
    externalId: string;
}

export async function resolveLogicalDeviceId(
    organizationId: string,
    deviceReference: string
): Promise<number> {
    try {
        const rows = await postgres.queryRows<DeviceIdRow>(
            `SELECT organization.fn_resolve_device_id($1, $2) AS id`,
            [organizationId, deviceReference]
        );
        return Number(rows[0].id);
    } catch (error) {
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === '22023'
        ) {
            throw RpcError.NotFound('device', deviceReference);
        }
        throw error;
    }
}

export async function resolveCurrentDeviceExternalId(
    organizationId: string,
    deviceId: number
): Promise<string> {
    const externalId = await findCurrentDeviceExternalId(
        organizationId,
        deviceId
    );
    if (!externalId) throw RpcError.NotFound('device', String(deviceId));
    return externalId;
}

export async function findCurrentDeviceExternalId(
    organizationId: string,
    deviceId: number
): Promise<string | null> {
    const rows = await postgres.queryRows<{external_id: string}>(
        `SELECT external_id FROM device.list
          WHERE organization_id = $1 AND id = $2
          LIMIT 1`,
        [organizationId, deviceId]
    );
    return rows[0]?.external_id ?? null;
}

function rewriteSubjectFingerprint(
    ruleId: number,
    fingerprint: string,
    subjectType: 'device' | 'entity',
    currentSubjectId: string,
    durableSubjectId: string
): string {
    const prefix = `rule:${ruleId}:${subjectType}:${currentSubjectId}`;
    if (!fingerprint.startsWith(prefix)) return fingerprint;
    return `rule:${ruleId}:${subjectType}:${durableSubjectId}${fingerprint.slice(prefix.length)}`;
}

async function resolveLogicalEntityReference(
    organizationId: string,
    entityId: string,
    hint?: LogicalDeviceHint
): Promise<{deviceId: number; entitySuffix: string} | null> {
    if (entityId.endsWith(':virtual')) return null;
    if (hint && entityId.startsWith(`${hint.externalId}_`)) {
        return {
            deviceId: hint.deviceId,
            entitySuffix: entityId.slice(hint.externalId.length + 1)
        };
    }
    const rows = await postgres.queryRows<EntityReferenceRow>(
        `SELECT device_id, entity_suffix
           FROM organization.fn_normalize_entity_subject($1, $2)`,
        [organizationId, entityId]
    );
    const row = rows[0];
    if (row?.device_id == null || !row.entity_suffix) {
        throw RpcError.NotFound('entity', entityId);
    }
    return {deviceId: Number(row.device_id), entitySuffix: row.entity_suffix};
}

export async function resolveDurableAlertSubjectId(
    organizationId: string,
    subjectType: 'device' | 'entity',
    subjectId: string
): Promise<string> {
    if (subjectType === 'device') {
        return String(await resolveLogicalDeviceId(organizationId, subjectId));
    }
    const entity = await resolveLogicalEntityReference(
        organizationId,
        subjectId
    );
    return entity ? `${entity.deviceId}_${entity.entitySuffix}` : subjectId;
}

export async function canonicalAlertFingerprint(
    organizationId: string,
    ruleId: number,
    fingerprint: string,
    hint?: LogicalDeviceHint
): Promise<string> {
    const devicePrefix = `rule:${ruleId}:device:`;
    if (fingerprint.startsWith(devicePrefix)) {
        const tail = fingerprint.slice(devicePrefix.length);
        const separator = tail.indexOf(':');
        const subject = separator >= 0 ? tail.slice(0, separator) : tail;
        if (hint && subject === String(hint.deviceId)) return fingerprint;
        const deviceId =
            hint?.externalId === subject
                ? hint.deviceId
                : await resolveLogicalDeviceId(organizationId, subject);
        return rewriteSubjectFingerprint(
            ruleId,
            fingerprint,
            'device',
            subject,
            String(deviceId)
        );
    }

    const entityPrefix = `rule:${ruleId}:entity:`;
    if (!fingerprint.startsWith(entityPrefix)) return fingerprint;
    if (hint) {
        if (fingerprint.startsWith(`${entityPrefix}${hint.deviceId}_`)) {
            return fingerprint;
        }
        const currentPrefix = `${entityPrefix}${hint.externalId}_`;
        if (fingerprint.startsWith(currentPrefix)) {
            return `${entityPrefix}${hint.deviceId}_${fingerprint.slice(currentPrefix.length)}`;
        }
    }
    const rows = await postgres.queryRows<LogicalDeviceHint>(
        `SELECT candidate.device_id AS "deviceId",
                candidate.external_id AS "externalId"
           FROM (
               SELECT d.id AS device_id, d.external_id, 0 AS priority
                 FROM device.list d
                WHERE d.organization_id = $1
               UNION ALL
               SELECT retired.device_id, retired.external_id, 1
                 FROM device.retired_external_identity retired
                 JOIN device.list d
                   ON d.organization_id = retired.organization_id
                  AND d.id = retired.device_id
                WHERE retired.organization_id = $1
           ) candidate
          WHERE left($2, length($3 || candidate.external_id || '_')) =
                $3 || candidate.external_id || '_'
          ORDER BY length(candidate.external_id) DESC, candidate.priority
          LIMIT 1`,
        [organizationId, fingerprint, entityPrefix]
    );
    const resolved = rows[0];
    if (!resolved) {
        if (fingerprint.includes(':virtual')) return fingerprint;
        throw RpcError.NotFound('entity', fingerprint);
    }
    const currentPrefix = `${entityPrefix}${resolved.externalId}_`;
    return `${entityPrefix}${resolved.deviceId}_${fingerprint.slice(currentPrefix.length)}`;
}

export async function canonicalizeAlertMatch(
    organizationId: string,
    ruleId: number,
    match: MatchResult,
    hint?: LogicalDeviceHint
): Promise<MatchResult> {
    if (match.subject.type === 'device') {
        const deviceId =
            hint?.externalId === match.subject.id
                ? hint.deviceId
                : await resolveLogicalDeviceId(
                      organizationId,
                      match.subject.id
                  );
        return {
            ...match,
            subject: {...match.subject, id: String(deviceId)},
            fingerprintV2: rewriteSubjectFingerprint(
                ruleId,
                match.fingerprintV2,
                'device',
                match.subject.id,
                String(deviceId)
            )
        };
    }
    if (match.subject.type !== 'entity') return match;
    const entity = await resolveLogicalEntityReference(
        organizationId,
        match.subject.id,
        hint
    );
    if (!entity) return match;
    const durableSubjectId = `${entity.deviceId}_${entity.entitySuffix}`;
    return {
        ...match,
        subject: {...match.subject, id: durableSubjectId},
        fingerprintV2: rewriteSubjectFingerprint(
            ruleId,
            match.fingerprintV2,
            'entity',
            match.subject.id,
            durableSubjectId
        )
    };
}

export async function hydratePublicAlertSubjects<
    T extends {
        id?: number;
        alert_id?: number;
        source_subject_type?: string;
        source_subject_id?: string;
    }
>(organizationId: string, rows: T[]): Promise<T[]> {
    const ids = rows
        .map((row) => row.id ?? row.alert_id)
        .filter((id): id is number => typeof id === 'number');
    if (ids.length === 0) return rows;
    const subjects = await postgres.queryRows<PublicSubjectRow>(
        `SELECT a.id AS alert_id, d.external_id, a.source_entity_suffix,
                a.source_subject_type
           FROM notifications.alert_instances a
           JOIN device.list d
             ON d.organization_id = a.organization_id
            AND d.id = a.source_device_id
          WHERE a.organization_id = $1 AND a.id = ANY($2::INTEGER[])`,
        [organizationId, ids]
    );
    const current = new Map(
        subjects.map((row) => [
            row.alert_id,
            row.source_subject_type === 'entity' && row.source_entity_suffix
                ? `${row.external_id}_${row.source_entity_suffix}`
                : row.external_id
        ])
    );
    for (const row of rows) {
        const id = row.id ?? row.alert_id;
        if (
            (row.source_subject_type === 'device' ||
                row.source_subject_type === 'entity') &&
            id !== undefined
        ) {
            row.source_subject_id = current.get(id) ?? row.source_subject_id;
        }
    }
    return rows;
}
