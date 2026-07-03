import RpcError from '../../rpc/RpcError';
import {isoOrNull} from '../util/iso';
import {
    createCredential,
    type DeviceIngressCredential,
    type DeviceIngressRepositoryDeps
} from './deviceIngressRepository';

export interface CertificateCredentialDeps
    extends DeviceIngressRepositoryDeps {}

export interface CreateCertificateCredentialInput {
    organizationId: string;
    identityId: string;
    certificateId: string;
    state: 'active' | 'pending';
}

const defaultDeps: CertificateCredentialDeps = {
    async queryRows<T>(
        sql: string,
        params: readonly unknown[] = []
    ): Promise<T[]> {
        // Deliberate lazy import: PostgresProvider loads runtime config.
        const postgres = await import('../PostgresProvider.js');
        return postgres.queryRows<T>(sql, params);
    }
};

interface CertificateRow {
    id: string;
    fingerprint_sha256: string;
    not_before: Date | string | null;
    not_after: Date | string | null;
}

export async function createCertificateCredential(
    input: CreateCertificateCredentialInput,
    deps: CertificateCredentialDeps = defaultDeps
): Promise<DeviceIngressCredential> {
    const certificate = await requireOrganizationCertificate(input, deps);
    return createCredential(
        {
            organizationId: input.organizationId,
            identityId: input.identityId,
            credentialType: 'certificate',
            state: input.state,
            certificateId: certificate.id,
            certificateFingerprint: certificate.fingerprint_sha256,
            notBefore: isoOrNull(certificate.not_before),
            notAfter: isoOrNull(certificate.not_after)
        },
        deps
    );
}

async function requireOrganizationCertificate(
    input: CreateCertificateCredentialInput,
    deps: CertificateCredentialDeps
): Promise<CertificateRow> {
    const rows = await deps.queryRows<CertificateRow>(
        `SELECT id, fingerprint_sha256, not_before, not_after
           FROM organization.certificates
          WHERE tenant_id = $1 AND id = $2
          LIMIT 1`,
        [input.organizationId, input.certificateId]
    );
    if (rows[0]) return rows[0];
    throw RpcError.Domain('CrossOrgReference', {
        details: {
            resourceType: 'certificate',
            identifier: input.certificateId
        }
    });
}
