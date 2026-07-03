import {toIso} from '../../rpc/pgRows';
import type {DeviceRelationshipInclude} from '../../types/api/device';
import * as postgres from '../PostgresProvider';
import {certificateStatus, securityStatus} from './relationshipHealth';
import type {
    DeviceRelationshipPermissions,
    RelationshipCertificateFact,
    RelationshipCredentialStateFact
} from './types';

export interface RelationshipSecurityCache {
    certificateRows?: Promise<CertificateRow[]>;
}

interface RelationshipSecurityInput {
    organizationId: string | undefined;
    centerExternalId: string;
    includes: ReadonlySet<DeviceRelationshipInclude>;
    permissions: Pick<DeviceRelationshipPermissions, 'securityStateRead'>;
    cache?: RelationshipSecurityCache;
}

interface OrganizationRelationshipSecurityInput
    extends RelationshipSecurityInput {
    organizationId: string;
}

interface CredentialStateRow {
    username: string;
    realm: string;
    rotated_at: Date | string | null;
    last_rotation_status: string;
}

interface CertificateRow {
    id: string;
    name: string;
    kind: string;
    not_after: Date | string | null;
    slot: string | null;
    push_status: string;
}

export async function loadIncludedCredentialStateFacts(
    input: RelationshipSecurityInput
): Promise<RelationshipCredentialStateFact[]> {
    if (!canReadSecurityRelationships(input)) return [];
    const rows = await queryCredentialStates(requireOrganization(input));
    return rows.map((row) => credentialStateFact({input, row}));
}

export async function loadIncludedCertificateFacts(
    input: RelationshipSecurityInput
): Promise<RelationshipCertificateFact[]> {
    if (!canReadSecurityRelationships(input)) return [];
    const rows = await loadCertificateRows(requireOrganization(input));
    return rows.map((row) => certificateFact({input, row}));
}

function canReadSecurityRelationships(
    input: RelationshipSecurityInput
): boolean {
    return (
        input.includes.has('securityState') &&
        Boolean(input.organizationId) &&
        input.permissions.securityStateRead
    );
}

async function queryCredentialStates(
    input: OrganizationRelationshipSecurityInput
): Promise<CredentialStateRow[]> {
    return await postgres.queryRows<CredentialStateRow>(
        `SELECT username, realm, rotated_at, last_rotation_status
           FROM organization.device_credentials
          WHERE tenant_id = $1
            AND device_id = $2
          LIMIT 1`,
        [input.organizationId, input.centerExternalId]
    );
}

async function loadCertificateRows(
    input: OrganizationRelationshipSecurityInput
): Promise<CertificateRow[]> {
    if (!input.cache) return await queryCertificateFacts(input);
    input.cache.certificateRows ??= queryCertificateFacts(input);
    return await input.cache.certificateRows;
}

async function queryCertificateFacts(
    input: OrganizationRelationshipSecurityInput
): Promise<CertificateRow[]> {
    return await postgres.queryRows<CertificateRow>(
        `SELECT DISTINCT ON (c.id, p.slot)
            c.id::text,
            c.name,
            c.kind,
            c.not_after,
            p.slot,
            p.status AS push_status
           FROM organization.certificate_pushes p
           JOIN organization.certificate_jobs j ON j.id = p.job_id
           JOIN organization.certificates c ON c.id = p.certificate_id
          WHERE j.tenant_id = $1
            AND p.device_id = $2
          ORDER BY c.id, p.slot, p.id DESC
          LIMIT 100`,
        [input.organizationId, input.centerExternalId]
    );
}

function credentialStateFact(input: {
    input: RelationshipSecurityInput;
    row: CredentialStateRow;
}): RelationshipCredentialStateFact {
    return {
        deviceExternalId: input.input.centerExternalId,
        status: securityStatus({status: input.row.last_rotation_status}),
        username: input.row.username,
        realm: input.row.realm,
        rotatedAt: toIso(input.row.rotated_at)
    };
}

function certificateFact(input: {
    input: RelationshipSecurityInput;
    row: CertificateRow;
}): RelationshipCertificateFact {
    return {
        id: input.row.id,
        label: input.row.name,
        kind: input.row.kind,
        status: certificateStatus({
            pushStatus: input.row.push_status,
            expiresAt: input.row.not_after
        }),
        targetExternalId: input.input.centerExternalId,
        slot: input.row.slot,
        expiresAt: toIso(input.row.not_after)
    };
}

function requireOrganization(
    input: RelationshipSecurityInput
): OrganizationRelationshipSecurityInput {
    if (!input.organizationId) {
        throw new Error('organizationId is required');
    }
    return {...input, organizationId: input.organizationId};
}
