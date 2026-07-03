import {toIso} from '../../rpc/pgRows';
import type {DeviceRelationshipInclude} from '../../types/api/device';
import * as postgres from '../PostgresProvider';
import {operationStatus} from './relationshipHealth';
import {operationJobLabel, operationUnitLabel} from './relationshipLabels';
import {operationJobMeta, operationUnitMeta} from './relationshipRedaction';
import type {
    DeviceRelationshipPermissions,
    RelationshipOperationJobFact,
    RelationshipOperationUnitFact
} from './types';

export interface RelationshipOperationCache {
    operationJobRows?: Promise<OperationJobRow[]>;
}

interface RelationshipOperationInput {
    organizationId: string | undefined;
    centerExternalId: string;
    includes: ReadonlySet<DeviceRelationshipInclude>;
    permissions: Pick<DeviceRelationshipPermissions, 'operationsRead'>;
    cache?: RelationshipOperationCache;
}

interface OrganizationRelationshipOperationInput
    extends RelationshipOperationInput {
    organizationId: string;
}

interface OperationJobRow {
    id: string;
    kind: RelationshipOperationJobFact['kind'];
    status: string;
    created_at: Date | string;
    unit_status: string;
    unit_phase: string | null;
    unit_id: number | string;
}

export async function loadIncludedOperationJobFacts(
    input: RelationshipOperationInput
): Promise<RelationshipOperationJobFact[]> {
    if (!canReadOperationRelationships(input)) return [];
    const scopedInput = requireOrganization(input);
    const rows = await loadOperationJobRows(scopedInput);
    return dedupeOperationJobRows(rows).map((row) =>
        operationJobFact({input: scopedInput, row})
    );
}

export async function loadIncludedOperationUnitFacts(
    input: RelationshipOperationInput
): Promise<RelationshipOperationUnitFact[]> {
    if (!canReadOperationRelationships(input)) return [];
    const scopedInput = requireOrganization(input);
    const rows = await loadOperationJobRows(scopedInput);
    return rows.map((row) => operationUnitFact({input: scopedInput, row}));
}

function canReadOperationRelationships(
    input: RelationshipOperationInput
): boolean {
    return (
        input.includes.has('operations') &&
        Boolean(input.organizationId) &&
        canReadAnyOperation(input.permissions.operationsRead)
    );
}

async function loadOperationJobRows(
    input: OrganizationRelationshipOperationInput
): Promise<OperationJobRow[]> {
    if (!input.cache) return await queryOperationJobs(input);
    input.cache.operationJobRows ??= queryOperationJobs(input);
    return await input.cache.operationJobRows;
}

async function queryOperationJobs(
    input: OrganizationRelationshipOperationInput
): Promise<OperationJobRow[]> {
    const rows = await Promise.all(operationJobQueries(input));
    return rows.flat().sort(operationJobRowsByCreatedAt).slice(0, 100);
}

function operationJobQueries(
    input: OrganizationRelationshipOperationInput
): Promise<OperationJobRow[]>[] {
    const queries: Promise<OperationJobRow[]>[] = [];
    const permissions = input.permissions.operationsRead;
    if (permissions.backupRead) queries.push(queryBackupOperationJobs(input));
    if (permissions.firmwareRead) {
        queries.push(queryFirmwareOperationJobs(input));
    }
    if (permissions.certificateRead) {
        queries.push(queryCertificateOperationJobs(input));
    }
    if (permissions.credentialRead) {
        queries.push(queryCredentialOperationJobs(input));
    }
    return queries;
}

function canReadAnyOperation(
    permissions: DeviceRelationshipPermissions['operationsRead']
): boolean {
    return Object.values(permissions).some(Boolean);
}

async function queryBackupOperationJobs(
    input: OrganizationRelationshipOperationInput
): Promise<OperationJobRow[]> {
    return await postgres.queryRows<OperationJobRow>(
        `SELECT
            j.id::text,
            'backup'::text AS kind,
            j.status,
            j.created_at,
            u.status AS unit_status,
            u.phase AS unit_phase,
            u.id AS unit_id
           FROM organization.backup_units u
           JOIN organization.backup_jobs j ON j.id = u.job_id
          WHERE u.tenant_id = $1
            AND u.device_id = $2
          ORDER BY j.created_at DESC, u.id DESC
          LIMIT 25`,
        [input.organizationId, input.centerExternalId]
    );
}

async function queryFirmwareOperationJobs(
    input: OrganizationRelationshipOperationInput
): Promise<OperationJobRow[]> {
    return await postgres.queryRows<OperationJobRow>(
        `SELECT
            j.id::text,
            'firmware'::text AS kind,
            j.status,
            j.created_at,
            u.status AS unit_status,
            u.phase AS unit_phase,
            u.id AS unit_id
           FROM organization.firmware_units u
           JOIN organization.firmware_jobs j ON j.id = u.job_id
          WHERE u.tenant_id = $1
            AND u.device_id = $2
          ORDER BY j.created_at DESC, u.id DESC
          LIMIT 25`,
        [input.organizationId, input.centerExternalId]
    );
}

async function queryCertificateOperationJobs(
    input: OrganizationRelationshipOperationInput
): Promise<OperationJobRow[]> {
    return await postgres.queryRows<OperationJobRow>(
        `SELECT
            j.id::text,
            'certificate'::text AS kind,
            j.status,
            j.created_at,
            p.status AS unit_status,
            p.slot AS unit_phase,
            p.id AS unit_id
           FROM organization.certificate_pushes p
           JOIN organization.certificate_jobs j ON j.id = p.job_id
          WHERE j.tenant_id = $1
            AND p.device_id = $2
          ORDER BY j.created_at DESC, p.id DESC
          LIMIT 25`,
        [input.organizationId, input.centerExternalId]
    );
}

async function queryCredentialOperationJobs(
    input: OrganizationRelationshipOperationInput
): Promise<OperationJobRow[]> {
    return await postgres.queryRows<OperationJobRow>(
        `SELECT
            j.id::text,
            'credential'::text AS kind,
            j.status,
            j.created_at,
            p.status AS unit_status,
            j.mode AS unit_phase,
            p.id AS unit_id
           FROM organization.credential_pushes p
           JOIN organization.credential_jobs j ON j.id = p.job_id
          WHERE j.tenant_id = $1
            AND p.device_id = $2
          ORDER BY j.created_at DESC, p.id DESC
          LIMIT 25`,
        [input.organizationId, input.centerExternalId]
    );
}

function operationJobFact(input: {
    input: OrganizationRelationshipOperationInput;
    row: OperationJobRow;
}): RelationshipOperationJobFact {
    return {
        id: input.row.id,
        label: operationJobLabel({kind: input.row.kind, id: input.row.id}),
        kind: input.row.kind,
        status: operationStatus({
            jobStatus: input.row.status,
            unitStatus: input.row.unit_status
        }),
        targetExternalId: input.input.centerExternalId,
        createdAt: toIso(input.row.created_at) ?? '',
        meta: operationJobMeta({
            jobStatus: input.row.status,
            unitStatus: input.row.unit_status,
            unitPhase: input.row.unit_phase,
            sampleUnitId: String(input.row.unit_id)
        })
    };
}

function operationUnitFact(input: {
    input: OrganizationRelationshipOperationInput;
    row: OperationJobRow;
}): RelationshipOperationUnitFact {
    const unitId = String(input.row.unit_id);
    return {
        id: unitId,
        jobId: input.row.id,
        label: operationUnitLabel({kind: input.row.kind, unitId}),
        kind: input.row.kind,
        status: operationStatus({
            jobStatus: input.row.status,
            unitStatus: input.row.unit_status
        }),
        targetExternalId: input.input.centerExternalId,
        phase: input.row.unit_phase,
        meta: operationUnitMeta({
            jobId: input.row.id,
            jobStatus: input.row.status,
            unitStatus: input.row.unit_status
        })
    };
}

function operationJobRowsByCreatedAt(
    left: OperationJobRow,
    right: OperationJobRow
): number {
    return (
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime()
    );
}

function dedupeOperationJobRows(
    rows: readonly OperationJobRow[]
): OperationJobRow[] {
    const seen = new Set<string>();
    return rows.filter((row) => {
        const key = operationRowJobKey(row);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function operationRowJobKey(row: OperationJobRow): string {
    return `${row.kind}:${row.id}`;
}

function requireOrganization(
    input: RelationshipOperationInput
): OrganizationRelationshipOperationInput {
    if (!input.organizationId) {
        throw new Error('organizationId is required');
    }
    return {...input, organizationId: input.organizationId};
}
