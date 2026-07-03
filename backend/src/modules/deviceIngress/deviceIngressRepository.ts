import {totalFromRows} from '../../rpc/listResponse';
import type {
    DeviceIngressConnectionResult,
    DeviceIngressCredentialState,
    DeviceIngressCredentialType,
    DeviceIngressIdentityState,
    DeviceIngressProfileId,
    DeviceIngressRejectionReason,
    DeviceIngressRejectionSeverity,
    DeviceIngressRiskLevel,
    DeviceIngressScopeKind,
    DeviceIngressSecurityModel,
    DeviceIngressSubjectType,
    DeviceIngressTransport
} from '../../types/api/deviceIngress';
import {iso, isoOrNull} from '../util/iso';
import type {DeviceSeenBatch} from './deviceSeenQueue';

// A page of rows plus the windowed total, so callers report the real count.
export interface ListPage<T> {
    items: T[];
    total: number;
}

export interface DeviceIngressRepositoryDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<T[]>;
}

const defaultDeps: DeviceIngressRepositoryDeps = {
    async queryRows<T>(
        sql: string,
        params: readonly unknown[] = []
    ): Promise<T[]> {
        // Deliberate lazy import: PostgresProvider loads runtime config.
        const postgres = await import('../PostgresProvider.js');
        return postgres.queryRows<T>(sql, params);
    }
};

export interface DeviceIngressIdentity {
    id: string;
    organizationId: string;
    subjectType: DeviceIngressSubjectType;
    subjectId: string;
    displayName: string;
    securityModel: DeviceIngressSecurityModel;
    transport: DeviceIngressTransport;
    riskLevel: DeviceIngressRiskLevel;
    status: DeviceIngressIdentityState;
    expectedExternalId: string | null;
    scopeKind: DeviceIngressScopeKind | null;
    scopeRef: string | null;
    reportedExternalIds: string[];
    lastSeenAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface DeviceIngressCredential {
    id: string;
    organizationId: string;
    identityId: string;
    credentialType: DeviceIngressCredentialType;
    state: DeviceIngressCredentialState;
    tokenPrefix: string | null;
    certificateId: string | null;
    certificateFingerprint: string | null;
    notBefore: string | null;
    notAfter: string | null;
    lastUsedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface DeviceIngressCredentialSecret extends DeviceIngressCredential {
    tokenHash: string | null;
}

export interface DeviceIngressLookupCredential extends DeviceIngressCredential {
    identitySecurityModel: DeviceIngressSecurityModel;
    identityTransport: DeviceIngressTransport;
    identityRiskLevel: DeviceIngressRiskLevel;
    identityStatus: DeviceIngressIdentityState;
    identityExpectedExternalId: string | null;
    identityScopeKind: DeviceIngressScopeKind | null;
    identityScopeRef: string | null;
}

export interface DeviceIngressTokenLookupCredential
    extends DeviceIngressLookupCredential {
    tokenHash: string | null;
}

export interface DeviceIngressConnection {
    id: string;
    organizationId: string;
    identityId: string | null;
    credentialId: string | null;
    reportedExternalId: string | null;
    observedTransport: string;
    result: DeviceIngressConnectionResult;
    reasonCode: string | null;
    remoteAddressHash: string | null;
    safeDetail: Record<string, unknown>;
    userAgent: string | null;
    createdAt: string;
    disconnectedAt: string | null;
    disconnectReason: string | null;
}

export interface DeviceIngressWaitingRoomEntry {
    id: string;
    organizationId: string;
    state: 'open' | 'approved' | 'rejected' | 'expired';
    reportedExternalId: string;
    observedTransport: string;
    securityModel: string;
    riskLevel: string;
    profileId: DeviceIngressProfileId | null;
    safeDetail: Record<string, unknown>;
    firstSeenAt: string;
    lastSeenAt: string;
    attemptCount: number;
    approvedIdentityId: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
    rejectionReason: string | null;
    // Cert chains to the FM CA but the device is new — flagged for one-click
    // approve (Layer 2), not auto-provisioned.
    trustedCa: boolean;
}

export interface EnsureApprovedFleetDeviceInput {
    organizationId: string;
    reportedExternalId: string;
    jdoc?: Record<string, unknown>;
}

export interface EnsureApprovedFleetDeviceResult {
    externalId: string;
    organizationId: string;
}

export interface DeviceIngressRejection {
    id: string;
    organizationId: string;
    identityId: string | null;
    credentialId: string | null;
    waitingRoomId: string | null;
    reasonCode: DeviceIngressRejectionReason;
    severity: DeviceIngressRejectionSeverity;
    reportedExternalId: string | null;
    observedTransport: string | null;
    safeDetail: Record<string, unknown>;
    createdAt: string;
    resolvedAt: string | null;
    resolvedBy: string | null;
    resolutionNote: string | null;
}

export interface DeviceIngressSetupSession {
    id: string;
    organizationId: string;
    reportedExternalId: string;
    profileId: DeviceIngressProfileId;
    status: 'planned' | 'applied' | 'partial' | 'failed' | 'expired';
    applyMethod: string | null;
    bundle: Record<string, unknown>;
    errorCode: string | null;
    errorMessage: string | null;
    bundleFetchCount: number;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface CreateIdentityInput {
    organizationId: string;
    subjectType: DeviceIngressSubjectType;
    subjectId: string;
    displayName: string;
    securityModel: DeviceIngressSecurityModel;
    transport: DeviceIngressTransport;
    riskLevel: DeviceIngressRiskLevel;
    status?: DeviceIngressIdentityState;
    expectedExternalId?: string | null;
    scopeKind?: DeviceIngressScopeKind | null;
    scopeRef?: string | null;
}

export async function createIdentity(
    input: CreateIdentityInput,
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressIdentity> {
    await ensureOrganization(input.organizationId, deps);
    const rows = await deps.queryRows<IdentityRow>(
        `INSERT INTO organization.device_ingress_identity (
            organization_id, subject_type, subject_id, display_name,
            security_model, transport, risk_level, status, expected_external_id,
            scope_kind, scope_ref
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (organization_id, subject_type, subject_id) DO UPDATE
            SET display_name = EXCLUDED.display_name,
                security_model = EXCLUDED.security_model,
                transport = EXCLUDED.transport,
                risk_level = EXCLUDED.risk_level,
                expected_external_id = EXCLUDED.expected_external_id,
                -- Preserve an existing scope when a scope-less re-create (e.g.
                -- waiting-room approve) omits it, so it can't silently widen.
                scope_kind = COALESCE(EXCLUDED.scope_kind,
                    organization.device_ingress_identity.scope_kind),
                scope_ref = COALESCE(EXCLUDED.scope_ref,
                    organization.device_ingress_identity.scope_ref),
                updated_at = now()
        RETURNING ${IDENTITY_COLUMNS}`,
        [
            input.organizationId,
            input.subjectType,
            input.subjectId,
            input.displayName,
            input.securityModel,
            input.transport,
            input.riskLevel,
            input.status ?? 'pending',
            input.expectedExternalId ?? null,
            input.scopeKind ?? null,
            input.scopeRef ?? null
        ]
    );
    return toIdentity(rows[0]);
}

export async function getIdentity(
    input: {organizationId: string; id: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressIdentity | null> {
    const rows = await deps.queryRows<IdentityRow>(
        `SELECT ${IDENTITY_COLUMNS}
           FROM organization.device_ingress_identity
          WHERE organization_id = $1 AND id = $2
          LIMIT 1`,
        [input.organizationId, input.id]
    );
    return rows[0] ? toIdentity(rows[0]) : null;
}

export async function updateIdentity(
    input: {
        organizationId: string;
        id: string;
        displayName?: string;
        expectedExternalId?: string | null;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressIdentity | null> {
    const current = await getIdentity(input, deps);
    if (!current) return null;
    const rows = await deps.queryRows<IdentityRow>(
        `UPDATE organization.device_ingress_identity
            SET display_name = $3,
                expected_external_id = $4,
                updated_at = now()
          WHERE organization_id = $1 AND id = $2
          RETURNING ${IDENTITY_COLUMNS}`,
        [
            input.organizationId,
            input.id,
            input.displayName ?? current.displayName,
            input.expectedExternalId ?? current.expectedExternalId
        ]
    );
    return rows[0] ? toIdentity(rows[0]) : null;
}

export async function listIdentities(
    input: {
        organizationId: string;
        status?: DeviceIngressIdentityState;
        securityModel?: DeviceIngressSecurityModel;
        transport?: DeviceIngressTransport;
        limit: number;
        offset: number;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<ListPage<DeviceIngressIdentity>> {
    const params: unknown[] = [input.organizationId];
    const clauses = ['organization_id = $1'];
    addOptionalClause(clauses, params, 'status', input.status);
    addOptionalClause(clauses, params, 'security_model', input.securityModel);
    addOptionalClause(clauses, params, 'transport', input.transport);
    params.push(input.limit, input.offset);
    const rows = await deps.queryRows<IdentityRow & {total_count?: number}>(
        `SELECT ${IDENTITY_COLUMNS}, COUNT(*) OVER()::int AS total_count
           FROM organization.device_ingress_identity
          WHERE ${clauses.join(' AND ')}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
    );
    return {items: rows.map(toIdentity), total: totalFromRows(rows)};
}

export async function updateIdentityStatus(
    input: {
        organizationId: string;
        id: string;
        status: DeviceIngressIdentityState;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressIdentity | null> {
    const rows = await deps.queryRows<IdentityRow>(
        `UPDATE organization.device_ingress_identity
            SET status = $3, updated_at = now()
          WHERE organization_id = $1 AND id = $2
          RETURNING ${IDENTITY_COLUMNS}`,
        [input.organizationId, input.id, input.status]
    );
    return rows[0] ? toIdentity(rows[0]) : null;
}

export interface CreateCredentialInput {
    organizationId: string;
    identityId: string;
    credentialType: DeviceIngressCredentialType;
    state: DeviceIngressCredentialState;
    tokenHash?: string | null;
    tokenPrefix?: string | null;
    certificateId?: string | null;
    certificateFingerprint?: string | null;
    notBefore?: string | null;
    notAfter?: string | null;
}

export async function createCredential(
    input: CreateCredentialInput,
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressCredential> {
    const rows = await deps.queryRows<CredentialRow>(
        `INSERT INTO organization.device_ingress_credential (
            organization_id, identity_id, credential_type, state, token_hash,
            token_prefix, certificate_id, certificate_fingerprint,
            not_before, not_after
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING ${CREDENTIAL_COLUMNS}`,
        [
            input.organizationId,
            input.identityId,
            input.credentialType,
            input.state,
            input.tokenHash ?? null,
            input.tokenPrefix ?? null,
            input.certificateId ?? null,
            input.certificateFingerprint ?? null,
            input.notBefore ?? null,
            input.notAfter ?? null
        ]
    );
    return toCredential(rows[0]);
}

export async function updateCredentialState(
    input: {
        organizationId: string;
        credentialId: string;
        state: DeviceIngressCredentialState;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressCredential | null> {
    const rows = await deps.queryRows<CredentialRow>(
        `UPDATE organization.device_ingress_credential
            SET state = $3, updated_at = now()
          WHERE organization_id = $1 AND id = $2
          RETURNING ${CREDENTIAL_COLUMNS}`,
        [input.organizationId, input.credentialId, input.state]
    );
    return rows[0] ? toCredential(rows[0]) : null;
}

export async function finalizeCredentialRotation(
    input: {
        organizationId: string;
        credentialId: string;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressCredential | null> {
    // One atomic statement: activate the new credential and supersede the
    // others for the same identity+type. Two separate UPDATEs could leave two
    // active credentials on partial failure; the partial unique index (7050)
    // backstops concurrent rotations.
    const rows = await deps.queryRows<CredentialRow>(
        `WITH activated AS (
            UPDATE organization.device_ingress_credential
                SET state = 'active', updated_at = now()
              WHERE organization_id = $1 AND id = $2
                -- Only a pending rotation may activate (no resurrecting revoked).
                AND state = 'pending'
              RETURNING ${CREDENTIAL_COLUMNS}
        ), superseded AS (
            UPDATE organization.device_ingress_credential c
                SET state = 'superseded', updated_at = now()
               FROM activated a
              WHERE c.organization_id = a.organization_id
                AND c.identity_id = a.identity_id
                AND c.credential_type = a.credential_type
                AND c.id <> a.id
                AND c.state = 'active'
        )
        SELECT ${CREDENTIAL_COLUMNS} FROM activated`,
        [input.organizationId, input.credentialId]
    );
    return rows[0] ? toCredential(rows[0]) : null;
}

export async function findTokenCredential(
    input: {tokenHash: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressTokenLookupCredential | null> {
    const rows = await deps.queryRows<CredentialLookupRow>(
        `SELECT ${qualifiedColumns(CREDENTIAL_SECRET_COLUMNS, 'c')},
                i.security_model AS identity_security_model,
                i.transport AS identity_transport,
                i.risk_level AS identity_risk_level,
                i.status AS identity_status,
                i.expected_external_id AS identity_expected_external_id,
                i.scope_kind AS identity_scope_kind,
                i.scope_ref AS identity_scope_ref
           FROM organization.device_ingress_credential c
           JOIN organization.device_ingress_identity i
             ON i.id = c.identity_id
            AND i.organization_id = c.organization_id
          WHERE c.token_hash = $1
          LIMIT 1`,
        [input.tokenHash]
    );
    return rows[0] ? toTokenLookupCredential(rows[0]) : null;
}

export async function findCertificateCredential(
    input: {fingerprint: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressLookupCredential | null> {
    const rows = await deps.queryRows<CredentialLookupRow>(
        `SELECT ${qualifiedColumns(CREDENTIAL_COLUMNS, 'c')},
                i.security_model AS identity_security_model,
                i.transport AS identity_transport,
                i.risk_level AS identity_risk_level,
                i.status AS identity_status,
                i.expected_external_id AS identity_expected_external_id,
                i.scope_kind AS identity_scope_kind,
                i.scope_ref AS identity_scope_ref
           FROM organization.device_ingress_credential c
           JOIN organization.device_ingress_identity i
             ON i.id = c.identity_id
            AND i.organization_id = c.organization_id
          WHERE c.certificate_fingerprint = $1
          LIMIT 2`,
        [input.fingerprint]
    );
    // A fingerprint is public; two tenants can hold the same cert. LIMIT 1 would
    // pick an arbitrary org — fail closed on collision so it can't cross tenants.
    if (rows.length !== 1) return null;
    return toLookupCredential(rows[0]);
}

// Is the connecting device inside the identity's group/location scope? (The
// device scope is an exact compare against expected_external_id in the gate.)
export async function deviceInIngressScope(
    input: {
        organizationId: string;
        scopeKind: DeviceIngressScopeKind;
        scopeRef: string;
        externalId: string;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<boolean> {
    const rows = await deps.queryRows<{in_scope: boolean}>(
        'SELECT device.fn_device_in_ingress_scope($1, $2, $3, $4) AS in_scope',
        [
            input.organizationId,
            input.scopeKind,
            input.scopeRef,
            input.externalId
        ]
    );
    return rows[0]?.in_scope === true;
}

// ── Enrollment tokens ───────────────────────────────────────────────────────
// Device-agnostic, org-scoped, time-boxed admission tokens. The device is
// unknown until it connects, so these have no identity — a dedicated table,
// not the identity-bound credential table.
export interface EnrollmentToken {
    id: string;
    organizationId: string;
    tokenPrefix: string;
    preferredProfileId: DeviceIngressProfileId | null;
    state: 'active' | 'consumed' | 'revoked';
    maxUses: number;
    useCount: number;
    notAfter: string;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
}

export interface CreateEnrollmentTokenInput {
    organizationId: string;
    tokenHash: string;
    tokenPrefix: string;
    preferredProfileId: DeviceIngressProfileId | null;
    maxUses: number;
    notAfter: string;
    createdBy: string | null;
    activeCap?: number;
    validityMinutes?: number;
}

export interface ConsumeEnrollmentTokenForWaitingRoomInput {
    tokenHash: string;
}

const ENROLLMENT_TOKEN_COLUMNS = `id, organization_id, token_prefix,
    preferred_profile_id, state, max_uses, use_count, not_after, created_by,
    created_at, updated_at, last_used_at, revoked_at`;

// Consume requires an active, unexpired token.
const ENROLLMENT_TOKEN_LIVE_PREDICATE = `state = 'active' AND not_after > now()`;

// Reentry only resolves the org for a device already in the waiting room, so a
// spent (consumed) single-use token still counts; only revoked/expired are out.
const ENROLLMENT_TOKEN_REENTRY_PREDICATE = `state IN ('active', 'consumed') AND not_after > now()`;

export async function createEnrollmentToken(
    input: CreateEnrollmentTokenInput,
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<EnrollmentToken> {
    await ensureOrganization(input.organizationId, deps);
    if (input.activeCap !== undefined) {
        return createEnrollmentTokenWithinCap(input, deps);
    }
    const rows = await deps.queryRows<EnrollmentTokenRow>(
        `INSERT INTO organization.device_ingress_enrollment_token (
            organization_id, token_hash, token_prefix, preferred_profile_id,
            max_uses, not_after, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING ${ENROLLMENT_TOKEN_COLUMNS}`,
        [
            input.organizationId,
            input.tokenHash,
            input.tokenPrefix,
            input.preferredProfileId,
            input.maxUses,
            input.notAfter,
            input.createdBy
        ]
    );
    return toEnrollmentToken(rows[0]);
}

async function createEnrollmentTokenWithinCap(
    input: CreateEnrollmentTokenInput,
    deps: DeviceIngressRepositoryDeps
): Promise<EnrollmentToken> {
    assertValidityMinutesForCappedCreate(input);
    const rows = await deps.queryRows<EnrollmentTokenRow>(
        `WITH org_lock AS (
            SELECT id FROM organization.profile WHERE id = $1 FOR UPDATE
        ), active_count AS (
            SELECT COUNT(*)::int AS count
              FROM organization.device_ingress_enrollment_token t
              JOIN org_lock o ON o.id = t.organization_id
             WHERE t.state = 'active' AND t.not_after > now()
        ), inserted AS (
            INSERT INTO organization.device_ingress_enrollment_token (
                organization_id, token_hash, token_prefix, preferred_profile_id,
                max_uses, not_after, created_by
            )
            SELECT o.id, $2, $3, $4, $5,
                   now() + ($6::int * interval '1 minute'), $7
              FROM org_lock o, active_count a
             WHERE a.count < $8
            RETURNING ${ENROLLMENT_TOKEN_COLUMNS}
        )
        SELECT ${ENROLLMENT_TOKEN_COLUMNS} FROM inserted`,
        [
            input.organizationId,
            input.tokenHash,
            input.tokenPrefix,
            input.preferredProfileId,
            input.maxUses,
            input.validityMinutes,
            input.createdBy,
            input.activeCap
        ]
    );
    if (!rows[0]) throw new Error('enrollment_token_active_cap');
    return toEnrollmentToken(rows[0]);
}

function assertValidityMinutesForCappedCreate(
    input: CreateEnrollmentTokenInput
): void {
    if (input.validityMinutes === undefined) {
        throw new Error('enrollment_token_validity_minutes_required');
    }
}

// Atomic single-shot consume: state + remaining uses + expiry enforced in one
// row-locked UPDATE so two devices can't both win one token. Flips to
// 'consumed' on the final use. Returns the row (org + profile) or null.
export async function consumeEnrollmentToken(
    input: {tokenHash: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<EnrollmentToken | null> {
    const rows = await deps.queryRows<EnrollmentTokenRow>(
        `UPDATE organization.device_ingress_enrollment_token
            SET use_count = use_count + 1,
                last_used_at = now(),
                updated_at = now(),
                state = CASE WHEN use_count + 1 >= max_uses
                             THEN 'consumed' ELSE 'active' END
          WHERE token_hash = $1
            AND ${ENROLLMENT_TOKEN_LIVE_PREDICATE}
            AND use_count < max_uses
          RETURNING ${ENROLLMENT_TOKEN_COLUMNS}`,
        [input.tokenHash]
    );
    return rows[0] ? toEnrollmentToken(rows[0]) : null;
}

export function consumeEnrollmentTokenForWaitingRoom(
    input: ConsumeEnrollmentTokenForWaitingRoomInput,
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<EnrollmentToken | null> {
    return consumeEnrollmentToken(input, deps);
}

// Resolves the token org without consuming. A revoked or expired token must
// not grant reentry, but a spent single-use token (consumed on first connect)
// must, or a device waiting for approval is rejected on every reconnect.
export async function findEnrollmentTokenOrg(
    input: {tokenHash: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<{organizationId: string} | null> {
    const rows = await deps.queryRows<{organization_id: string}>(
        `SELECT organization_id
           FROM organization.device_ingress_enrollment_token
          WHERE token_hash = $1
            AND ${ENROLLMENT_TOKEN_REENTRY_PREDICATE}
          ORDER BY created_at DESC
          LIMIT 1`,
        [input.tokenHash]
    );
    return rows[0] ? {organizationId: rows[0].organization_id} : null;
}

export async function listEnrollmentTokens(
    input: {organizationId: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<EnrollmentToken[]> {
    const rows = await deps.queryRows<EnrollmentTokenRow>(
        `SELECT ${ENROLLMENT_TOKEN_COLUMNS}
           FROM organization.device_ingress_enrollment_token
          WHERE organization_id = $1
          ORDER BY created_at DESC`,
        [input.organizationId]
    );
    return rows.map(toEnrollmentToken);
}

export async function revokeEnrollmentToken(
    input: {organizationId: string; id: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<EnrollmentToken | null> {
    const rows = await deps.queryRows<EnrollmentTokenRow>(
        `UPDATE organization.device_ingress_enrollment_token
            SET state = 'revoked', revoked_at = now(), updated_at = now()
          WHERE id = $1 AND organization_id = $2 AND state = 'active'
          RETURNING ${ENROLLMENT_TOKEN_COLUMNS}`,
        [input.id, input.organizationId]
    );
    return rows[0] ? toEnrollmentToken(rows[0]) : null;
}

export async function countActiveEnrollmentTokens(
    input: {organizationId: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<number> {
    const rows = await deps.queryRows<{count: string}>(
        `SELECT COUNT(*) AS count
           FROM organization.device_ingress_enrollment_token
          WHERE organization_id = $1
            AND state = 'active' AND not_after > now()`,
        [input.organizationId]
    );
    return Number(rows[0]?.count ?? 0);
}

// Batched "last seen" flush: one bulk round-trip for many accepts at once
// (see DeviceSeenQueue). Stamps each device's last_seen + last-observed posture
// on device.list keyed on external_id, and stamps last_used_at for the
// credentialed ones (null credential rows match nothing and no-op). Called by
// the write-behind flusher, never per-connect — a reconnect storm never touches
// the DB on the hot path.
export async function markDeviceSeenBatch(
    batch: DeviceSeenBatch,
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<void> {
    if (batch.p_external.length === 0) return;
    await deps.queryRows(
        `WITH used AS (
            UPDATE organization.device_ingress_credential c
               SET last_used_at = now(), updated_at = now()
              FROM UNNEST($5::uuid[]) AS v(cred)
             WHERE v.cred IS NOT NULL AND c.id = v.cred
        )
        UPDATE device.list d
           SET last_seen = now(),
               transport = v.transport,
               security_model = v.security_model,
               risk_level = v.risk_level
          FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[])
               AS v(external_id, transport, security_model, risk_level)
         WHERE d.external_id = v.external_id`,
        [
            batch.p_external,
            batch.p_transport,
            batch.p_security,
            batch.p_risk,
            batch.p_credential
        ]
    );
}

export interface RecordConnectionInput {
    organizationId: string;
    identityId?: string | null;
    credentialId?: string | null;
    reportedExternalId?: string | null;
    observedTransport: string;
    result: DeviceIngressConnectionResult;
    reasonCode?: string | null;
    remoteAddressHash?: string | null;
    safeDetail?: Record<string, unknown>;
    userAgent?: string | null;
}

export async function recordConnection(
    input: RecordConnectionInput,
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressConnection> {
    // Ensure the org row first, like every other ingress write — else the FK rejects it.
    await ensureOrganization(input.organizationId, deps);
    const rows = await deps.queryRows<ConnectionRow>(
        `INSERT INTO organization.device_ingress_connection (
            organization_id, identity_id, credential_id, reported_external_id,
            observed_transport, result, reason_code, remote_address_hash,
            safe_detail, user_agent
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING ${CONNECTION_COLUMNS}`,
        [
            input.organizationId,
            input.identityId ?? null,
            input.credentialId ?? null,
            input.reportedExternalId ?? null,
            input.observedTransport,
            input.result,
            input.reasonCode ?? null,
            input.remoteAddressHash ?? null,
            input.safeDetail ?? {},
            input.userAgent ?? null
        ]
    );
    return toConnection(rows[0]);
}

export interface BulkConnectionRecord {
    id: string;
    createdAt: string;
    organizationId: string;
    identityId: string | null;
    credentialId: string | null;
    reportedExternalId: string | null;
    observedTransport: string;
    result: string;
    reasonCode: string | null;
    remoteAddressHash: string | null;
    safeDetail: Record<string, unknown>;
    userAgent: string | null;
}

// Bulk-insert connection rows deferred off the connect hot path. One
// parameterized multi-row INSERT (no SQLi); idempotent on the caller-minted id
// so a re-flush after a crash can't duplicate rows.
export async function bulkInsertConnections(
    records: BulkConnectionRecord[],
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<void> {
    if (records.length === 0) return;
    for (const organizationId of new Set(
        records.map((r) => r.organizationId)
    )) {
        await ensureOrganization(organizationId, deps);
    }
    const COLS = 12;
    const params: unknown[] = [];
    const tuples = records.map((r, i) => {
        const b = i * COLS;
        params.push(
            r.id,
            r.createdAt,
            r.organizationId,
            r.identityId ?? null,
            r.credentialId ?? null,
            r.reportedExternalId ?? null,
            r.observedTransport,
            r.result,
            r.reasonCode ?? null,
            r.remoteAddressHash ?? null,
            r.safeDetail ?? {},
            r.userAgent ?? null
        );
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`;
    });
    await deps.queryRows(
        `INSERT INTO organization.device_ingress_connection (
            id, created_at, organization_id, identity_id, credential_id,
            reported_external_id, observed_transport, result, reason_code,
            remote_address_hash, safe_detail, user_agent
        ) VALUES ${tuples.join(',')}
        ON CONFLICT (id) DO NOTHING`,
        params
    );
}

export async function ensureApprovedFleetDevice(
    input: EnsureApprovedFleetDeviceInput,
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<EnsureApprovedFleetDeviceResult | null> {
    await ensureOrganization(input.organizationId, deps);
    const rows = await deps.queryRows<{
        external_id: string;
        organization_id: string;
    }>(
        `INSERT INTO device.list (
            external_id, control_access, organization_id, jdoc
        ) VALUES ($1, 3, $2, $3::jsonb)
        ON CONFLICT (external_id) WHERE external_id IS NOT NULL
        DO UPDATE SET
            control_access = 3,
            organization_id = EXCLUDED.organization_id,
            jdoc = COALESCE(device.list.jdoc, EXCLUDED.jdoc),
            updated = now()
        WHERE NULLIF(device.list.organization_id, '') IS NULL
           OR device.list.organization_id = EXCLUDED.organization_id
        RETURNING external_id, organization_id`,
        [
            input.reportedExternalId,
            input.organizationId,
            JSON.stringify(
                input.jdoc ??
                    defaultFleetDeviceSnapshot(input.reportedExternalId)
            )
        ]
    );
    if (!rows[0]) return null;
    return {
        externalId: rows[0].external_id,
        organizationId: rows[0].organization_id
    };
}

export async function listConnections(
    input: {
        organizationId: string;
        identityId?: string;
        result?: DeviceIngressConnectionResult;
        limit: number;
        offset: number;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<ListPage<DeviceIngressConnection>> {
    const params: unknown[] = [input.organizationId];
    const clauses = ['organization_id = $1'];
    addOptionalClause(clauses, params, 'identity_id', input.identityId);
    addOptionalClause(clauses, params, 'result', input.result);
    params.push(input.limit, input.offset);
    const rows = await deps.queryRows<ConnectionRow & {total_count?: number}>(
        `SELECT ${CONNECTION_COLUMNS}, COUNT(*) OVER()::int AS total_count
           FROM organization.device_ingress_connection
          WHERE ${clauses.join(' AND ')}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
    );
    return {items: rows.map(toConnection), total: totalFromRows(rows)};
}

export async function getConnection(
    input: {organizationId: string; id: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressConnection | null> {
    const rows = await deps.queryRows<ConnectionRow>(
        `SELECT ${CONNECTION_COLUMNS}
           FROM organization.device_ingress_connection
          WHERE organization_id = $1 AND id = $2
          LIMIT 1`,
        [input.organizationId, input.id]
    );
    return rows[0] ? toConnection(rows[0]) : null;
}

export async function markConnectionDisconnected(
    input: {organizationId: string; id: string; reason: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressConnection | null> {
    const rows = await deps.queryRows<ConnectionRow>(
        `UPDATE organization.device_ingress_connection
            SET disconnected_at = now(),
                disconnect_reason = $3
          WHERE organization_id = $1 AND id = $2
          RETURNING ${CONNECTION_COLUMNS}`,
        [input.organizationId, input.id, input.reason]
    );
    return rows[0] ? toConnection(rows[0]) : null;
}

export async function listWaitingRoom(
    input: {
        organizationId: string;
        state?: DeviceIngressWaitingRoomEntry['state'];
        observedTransport?: DeviceIngressTransport;
        securityModel?: DeviceIngressSecurityModel;
        riskLevel?: DeviceIngressRiskLevel;
        limit: number;
        offset: number;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<ListPage<DeviceIngressWaitingRoomEntry>> {
    const params: unknown[] = [input.organizationId];
    const clauses = ['organization_id = $1'];
    addOptionalClause(clauses, params, 'state', input.state);
    addOptionalClause(
        clauses,
        params,
        'observed_transport',
        input.observedTransport
    );
    addOptionalClause(clauses, params, 'security_model', input.securityModel);
    addOptionalClause(clauses, params, 'risk_level', input.riskLevel);
    params.push(input.limit, input.offset);
    const rows = await deps.queryRows<WaitingRoomRow & {total_count?: number}>(
        `SELECT ${WAITING_ROOM_COLUMNS}, COUNT(*) OVER()::int AS total_count
           FROM organization.device_ingress_waiting_room
          WHERE ${clauses.join(' AND ')}
          ORDER BY last_seen_at DESC, id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
    );
    return {items: rows.map(toWaitingRoom), total: totalFromRows(rows)};
}

export async function getWaitingRoom(
    input: {organizationId: string; waitingRoomId: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressWaitingRoomEntry | null> {
    const rows = await deps.queryRows<WaitingRoomRow>(
        `SELECT ${WAITING_ROOM_COLUMNS}
           FROM organization.device_ingress_waiting_room
          WHERE organization_id = $1 AND id = $2
          LIMIT 1`,
        [input.organizationId, input.waitingRoomId]
    );
    return rows[0] ? toWaitingRoom(rows[0]) : null;
}

export async function approveWaitingRoom(
    input: {organizationId: string; waitingRoomId: string; identityId: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressWaitingRoomEntry | null> {
    const rows = await deps.queryRows<WaitingRoomRow>(
        `UPDATE organization.device_ingress_waiting_room
            SET state = 'approved',
                approved_identity_id = $3,
                approved_at = now()
          WHERE organization_id = $1 AND id = $2 AND state = 'open'
          RETURNING ${WAITING_ROOM_COLUMNS}`,
        [input.organizationId, input.waitingRoomId, input.identityId]
    );
    return rows[0] ? toWaitingRoom(rows[0]) : null;
}

export async function approveOpenWaitingRoomForTrustedDevice(
    input: {
        organizationId: string;
        reportedExternalId: string;
        observedTransport: string;
        identityId: string;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressWaitingRoomEntry | null> {
    const rows = await deps.queryRows<WaitingRoomRow>(
        `UPDATE organization.device_ingress_waiting_room
            SET state = 'approved',
                approved_identity_id = $4,
                approved_at = now()
          WHERE organization_id = $1
            AND reported_external_id = $2
            AND observed_transport = $3
            AND state = 'open'
          RETURNING ${WAITING_ROOM_COLUMNS}`,
        [
            input.organizationId,
            input.reportedExternalId,
            input.observedTransport,
            input.identityId
        ]
    );
    return rows[0] ? toWaitingRoom(rows[0]) : null;
}

export async function rejectWaitingRoom(
    input: {
        organizationId: string;
        waitingRoomId: string;
        reasonCode: DeviceIngressRejectionReason;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressWaitingRoomEntry | null> {
    const rows = await deps.queryRows<WaitingRoomRow>(
        `UPDATE organization.device_ingress_waiting_room
            SET state = 'rejected',
                rejected_at = now(),
                rejection_reason = $3
          WHERE organization_id = $1 AND id = $2 AND state = 'open'
          RETURNING ${WAITING_ROOM_COLUMNS}`,
        [input.organizationId, input.waitingRoomId, input.reasonCode]
    );
    return rows[0] ? toWaitingRoom(rows[0]) : null;
}

export interface RecordRejectionInput {
    organizationId: string;
    identityId?: string | null;
    credentialId?: string | null;
    waitingRoomId?: string | null;
    reasonCode: DeviceIngressRejectionReason;
    severity: DeviceIngressRejectionSeverity;
    reportedExternalId?: string | null;
    observedTransport?: string | null;
    safeDetail?: Record<string, unknown>;
}

export async function recordRejection(
    input: RecordRejectionInput,
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressRejection> {
    const rows = await deps.queryRows<RejectionRow>(
        `INSERT INTO organization.device_ingress_rejection (
            organization_id, identity_id, credential_id, waiting_room_id,
            reason_code, severity, reported_external_id, observed_transport,
            safe_detail
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING ${REJECTION_COLUMNS}`,
        [
            input.organizationId,
            input.identityId ?? null,
            input.credentialId ?? null,
            input.waitingRoomId ?? null,
            input.reasonCode,
            input.severity,
            input.reportedExternalId ?? null,
            input.observedTransport ?? null,
            input.safeDetail ?? {}
        ]
    );
    return toRejection(rows[0]);
}

export async function listRejections(
    input: {
        organizationId: string;
        severity?: DeviceIngressRejectionSeverity;
        reasonCode?: DeviceIngressRejectionReason;
        limit: number;
        offset: number;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<ListPage<DeviceIngressRejection>> {
    const params: unknown[] = [input.organizationId];
    const clauses = ['organization_id = $1'];
    addOptionalClause(clauses, params, 'severity', input.severity);
    addOptionalClause(clauses, params, 'reason_code', input.reasonCode);
    params.push(input.limit, input.offset);
    const rows = await deps.queryRows<RejectionRow & {total_count?: number}>(
        `SELECT ${REJECTION_COLUMNS}, COUNT(*) OVER()::int AS total_count
           FROM organization.device_ingress_rejection
          WHERE ${clauses.join(' AND ')}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
    );
    return {items: rows.map(toRejection), total: totalFromRows(rows)};
}

export async function resolveRejection(
    input: {
        organizationId: string;
        id: string;
        resolvedBy: string;
        note?: string | null;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressRejection | null> {
    const rows = await deps.queryRows<RejectionRow>(
        `UPDATE organization.device_ingress_rejection
            SET resolved_at = now(),
                resolved_by = $3,
                resolution_note = $4
          WHERE organization_id = $1 AND id = $2
            -- Re-resolving would overwrite the original resolver + audit trail.
            AND resolved_at IS NULL
          RETURNING ${REJECTION_COLUMNS}`,
        [input.organizationId, input.id, input.resolvedBy, input.note ?? null]
    );
    return rows[0] ? toRejection(rows[0]) : null;
}

export interface CreateSetupSessionInput {
    organizationId: string;
    reportedExternalId: string;
    profileId: DeviceIngressProfileId;
    bundle: Record<string, unknown>;
    expiresAt: string;
}

export async function createSetupSession(
    input: CreateSetupSessionInput,
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressSetupSession> {
    const rows = await deps.queryRows<SetupSessionRow>(
        `INSERT INTO organization.device_ingress_setup_session (
            organization_id, reported_external_id, profile_id, bundle,
            expires_at
        ) VALUES ($1,$2,$3,$4,$5)
        RETURNING ${SETUP_COLUMNS}`,
        [
            input.organizationId,
            input.reportedExternalId,
            input.profileId,
            input.bundle,
            input.expiresAt
        ]
    );
    return toSetupSession(rows[0]);
}

export async function getSetupSession(
    input: {organizationId: string; sessionId: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressSetupSession | null> {
    const rows = await deps.queryRows<SetupSessionRow>(
        `SELECT ${SETUP_COLUMNS}
           FROM organization.device_ingress_setup_session
          WHERE organization_id = $1 AND id = $2
          LIMIT 1`,
        [input.organizationId, input.sessionId]
    );
    return rows[0] ? toSetupSession(rows[0]) : null;
}

export async function fetchSetupBundle(
    input: {
        organizationId: string;
        sessionId: string;
        maxFetches: number;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressSetupSession | null> {
    const rows = await deps.queryRows<SetupSessionRow>(
        `UPDATE organization.device_ingress_setup_session
            SET bundle_fetch_count = bundle_fetch_count + 1,
                updated_at = now()
          WHERE organization_id = $1
            AND id = $2
            AND expires_at >= now()
            AND bundle_fetch_count < $3
          RETURNING ${SETUP_COLUMNS}`,
        [input.organizationId, input.sessionId, input.maxFetches]
    );
    return rows[0] ? toSetupSession(rows[0]) : null;
}

export async function markSetupSessionConnected(
    input: {organizationId: string; reportedExternalId: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<number> {
    const rows = await deps.queryRows<{id: string}>(
        `UPDATE organization.device_ingress_setup_session
            SET status = 'applied',
                updated_at = now()
          WHERE organization_id = $1
            AND reported_external_id = $2
            AND status IN ('planned', 'partial')
            AND expires_at >= now()
          RETURNING id`,
        [input.organizationId, input.reportedExternalId]
    );
    return rows.length;
}

export async function countOpenWaitingRoom(input: {
    organizationId: string;
}): Promise<number> {
    // Open devices live in the store.
    const store = await import('../WaitingRoom/redisWaitingStore.js');
    return store.countPending(input.organizationId);
}

export interface RetentionCleanupInput {
    waitingRoomRetentionDays: number;
    connectionHistoryRetentionDays: number;
}

export interface RetentionCleanupResult {
    expiredCredentials: number;
    expiredSetupSessions: number;
    expiredWaitingRoomEntries: number;
    disconnectedConnections: number;
}

export async function runRetentionCleanup(
    input: RetentionCleanupInput,
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<RetentionCleanupResult> {
    const [credentials, sessions, waitingRoom, connections] = await Promise.all(
        [
            expireCredentials(deps),
            expireSetupSessions(deps),
            expireWaitingRoom(input, deps),
            markStaleConnectionsDisconnected(input, deps)
        ]
    );
    return {
        expiredCredentials: credentials,
        expiredSetupSessions: sessions,
        expiredWaitingRoomEntries: waitingRoom,
        disconnectedConnections: connections
    };
}

export async function reportSetupApply(
    input: {
        organizationId: string;
        sessionId: string;
        status: 'applied' | 'partial' | 'failed';
        applyMethod: string;
        errorCode?: string | null;
        errorMessage?: string | null;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<DeviceIngressSetupSession | null> {
    const rows = await deps.queryRows<SetupSessionRow>(
        `UPDATE organization.device_ingress_setup_session
            SET status = $3,
                apply_method = $4,
                error_code = $5,
                error_message = $6,
                updated_at = now()
          WHERE organization_id = $1 AND id = $2
          RETURNING ${SETUP_COLUMNS}`,
        [
            input.organizationId,
            input.sessionId,
            input.status,
            input.applyMethod,
            input.errorCode ?? null,
            input.errorMessage ?? null
        ]
    );
    return rows[0] ? toSetupSession(rows[0]) : null;
}

async function expireCredentials(
    deps: DeviceIngressRepositoryDeps
): Promise<number> {
    const rows = await deps.queryRows<{id: string}>(
        `UPDATE organization.device_ingress_credential
            SET state = 'expired', updated_at = now()
          WHERE state IN ('active', 'pending')
            AND not_after IS NOT NULL
            AND not_after < now()
          RETURNING id`
    );
    return rows.length;
}

async function expireSetupSessions(
    deps: DeviceIngressRepositoryDeps
): Promise<number> {
    const rows = await deps.queryRows<{id: string}>(
        `UPDATE organization.device_ingress_setup_session
            SET status = 'expired', updated_at = now()
          WHERE status IN ('planned', 'partial')
            AND expires_at < now()
          RETURNING id`
    );
    return rows.length;
}

async function expireWaitingRoom(
    input: RetentionCleanupInput,
    deps: DeviceIngressRepositoryDeps
): Promise<number> {
    const rows = await deps.queryRows<{id: string}>(
        `UPDATE organization.device_ingress_waiting_room
            SET state = 'expired'
          WHERE state = 'open'
            AND last_seen_at < now() - ($1::int * interval '1 day')
          RETURNING id`,
        [input.waitingRoomRetentionDays]
    );
    return rows.length;
}

async function markStaleConnectionsDisconnected(
    input: RetentionCleanupInput,
    deps: DeviceIngressRepositoryDeps
): Promise<number> {
    const rows = await deps.queryRows<{id: string}>(
        `UPDATE organization.device_ingress_connection
            SET disconnected_at = now(),
                disconnect_reason = 'retention_cleanup'
          WHERE result = 'accepted'
            AND disconnected_at IS NULL
            AND created_at < now() - ($1::int * interval '1 day')
          RETURNING id`,
        [input.connectionHistoryRetentionDays]
    );
    return rows.length;
}

async function ensureOrganization(
    organizationId: string,
    deps: DeviceIngressRepositoryDeps
): Promise<void> {
    await deps.queryRows('SELECT organization.fn_profile_ensure($1)', [
        organizationId
    ]);
}

function defaultFleetDeviceSnapshot(
    reportedExternalId: string
): Record<string, unknown> {
    return {
        shellyID: reportedExternalId,
        source: 'offline',
        info: {id: reportedExternalId},
        status: {},
        settings: {},
        capabilities: {},
        methods: []
    };
}

function addOptionalClause(
    clauses: string[],
    params: unknown[],
    column: string,
    value: unknown
): void {
    if (value === undefined) return;
    params.push(value);
    clauses.push(`${column} = $${params.length}`);
}

const IDENTITY_COLUMNS = `id, organization_id, subject_type, subject_id,
    display_name, security_model, transport, risk_level, status,
    expected_external_id, scope_kind, scope_ref, reported_external_ids,
    last_seen_at, created_at, updated_at`;

const CREDENTIAL_COLUMNS = `id, organization_id, identity_id, credential_type,
    state, token_prefix, certificate_id, certificate_fingerprint, not_before,
    not_after, last_used_at, created_at, updated_at`;

const CREDENTIAL_SECRET_COLUMNS = `id, organization_id, identity_id,
    credential_type, state, token_hash, token_prefix, certificate_id,
    certificate_fingerprint, not_before, not_after, last_used_at, created_at,
    updated_at`;

const CONNECTION_COLUMNS = `id, organization_id, identity_id, credential_id,
    reported_external_id, observed_transport, result, reason_code,
    remote_address_hash, safe_detail, user_agent, created_at,
    disconnected_at, disconnect_reason`;

const WAITING_ROOM_COLUMNS = `id, organization_id, state, reported_external_id,
    observed_transport, security_model, risk_level, profile_id, safe_detail,
    first_seen_at, last_seen_at, attempt_count, approved_identity_id,
    approved_at, rejected_at, rejection_reason, trusted_ca`;

const REJECTION_COLUMNS = `id, organization_id, identity_id, credential_id,
    waiting_room_id, reason_code, severity, reported_external_id, observed_transport,
    safe_detail, created_at, resolved_at, resolved_by, resolution_note`;

const SETUP_COLUMNS = `id, organization_id, reported_external_id, profile_id,
    status, apply_method, bundle, error_code, error_message,
    bundle_fetch_count, expires_at, created_at, updated_at`;

function qualifiedColumns(columns: string, alias: string): string {
    return columns
        .split(',')
        .map((column) => `${alias}.${column.trim()}`)
        .join(', ');
}

interface IdentityRow {
    id: string;
    organization_id: string;
    subject_type: DeviceIngressSubjectType;
    subject_id: string;
    display_name: string;
    security_model: DeviceIngressSecurityModel;
    transport: DeviceIngressTransport;
    risk_level: DeviceIngressRiskLevel;
    status: DeviceIngressIdentityState;
    expected_external_id: string | null;
    scope_kind: DeviceIngressScopeKind | null;
    scope_ref: string | null;
    reported_external_ids: string[] | null;
    last_seen_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
}

interface CredentialRow {
    id: string;
    organization_id: string;
    identity_id: string;
    credential_type: DeviceIngressCredentialType;
    state: DeviceIngressCredentialState;
    token_hash?: string | null;
    token_prefix: string | null;
    certificate_id: string | null;
    certificate_fingerprint: string | null;
    not_before: Date | string | null;
    not_after: Date | string | null;
    last_used_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
}

interface CredentialLookupRow extends CredentialRow {
    identity_security_model: DeviceIngressSecurityModel;
    identity_transport: DeviceIngressTransport;
    identity_risk_level: DeviceIngressRiskLevel;
    identity_status: DeviceIngressIdentityState;
    identity_expected_external_id: string | null;
    identity_scope_kind: DeviceIngressScopeKind | null;
    identity_scope_ref: string | null;
}

interface ConnectionRow {
    id: string;
    organization_id: string;
    identity_id: string | null;
    credential_id: string | null;
    reported_external_id: string | null;
    observed_transport: string;
    result: DeviceIngressConnectionResult;
    reason_code: string | null;
    remote_address_hash: string | null;
    safe_detail: Record<string, unknown> | null;
    user_agent: string | null;
    created_at: Date | string;
    disconnected_at: Date | string | null;
    disconnect_reason: string | null;
}

interface WaitingRoomRow {
    id: string;
    organization_id: string;
    state: DeviceIngressWaitingRoomEntry['state'];
    reported_external_id: string;
    observed_transport: string;
    security_model: string;
    risk_level: string;
    profile_id: DeviceIngressProfileId | null;
    safe_detail: Record<string, unknown> | null;
    first_seen_at: Date | string;
    last_seen_at: Date | string;
    attempt_count: number | string;
    approved_identity_id: string | null;
    approved_at: Date | string | null;
    rejected_at: Date | string | null;
    rejection_reason: string | null;
    trusted_ca: boolean;
}

interface RejectionRow {
    id: string;
    organization_id: string;
    identity_id: string | null;
    credential_id: string | null;
    waiting_room_id: string | null;
    reason_code: DeviceIngressRejectionReason;
    severity: DeviceIngressRejectionSeverity;
    reported_external_id: string | null;
    observed_transport: string | null;
    safe_detail: Record<string, unknown> | null;
    created_at: Date | string;
    resolved_at: Date | string | null;
    resolved_by: string | null;
    resolution_note: string | null;
}

interface SetupSessionRow {
    id: string;
    organization_id: string;
    reported_external_id: string;
    profile_id: DeviceIngressProfileId;
    status: DeviceIngressSetupSession['status'];
    apply_method: string | null;
    bundle: Record<string, unknown> | null;
    error_code: string | null;
    error_message: string | null;
    bundle_fetch_count?: number | string;
    expires_at: Date | string;
    created_at: Date | string;
    updated_at: Date | string;
}

function toIdentity(row: IdentityRow): DeviceIngressIdentity {
    return {
        id: row.id,
        organizationId: row.organization_id,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        displayName: row.display_name,
        securityModel: row.security_model,
        transport: row.transport,
        riskLevel: row.risk_level,
        status: row.status,
        expectedExternalId: row.expected_external_id,
        scopeKind: row.scope_kind,
        scopeRef: row.scope_ref,
        reportedExternalIds: row.reported_external_ids ?? [],
        lastSeenAt: isoOrNull(row.last_seen_at),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
    };
}

function toCredential(row: CredentialRow): DeviceIngressCredential {
    return {
        id: row.id,
        organizationId: row.organization_id,
        identityId: row.identity_id,
        credentialType: row.credential_type,
        state: row.state,
        tokenPrefix: row.token_prefix,
        certificateId: row.certificate_id,
        certificateFingerprint: row.certificate_fingerprint,
        notBefore: isoOrNull(row.not_before),
        notAfter: isoOrNull(row.not_after),
        lastUsedAt: isoOrNull(row.last_used_at),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
    };
}

function toLookupCredential(
    row: CredentialLookupRow
): DeviceIngressLookupCredential {
    return {
        ...toCredential(row),
        identitySecurityModel: row.identity_security_model,
        identityTransport: row.identity_transport,
        identityRiskLevel: row.identity_risk_level,
        identityStatus: row.identity_status,
        identityExpectedExternalId: row.identity_expected_external_id,
        identityScopeKind: row.identity_scope_kind,
        identityScopeRef: row.identity_scope_ref
    };
}

interface EnrollmentTokenRow {
    id: string;
    organization_id: string;
    token_prefix: string;
    preferred_profile_id: DeviceIngressProfileId | null;
    state: EnrollmentToken['state'];
    max_uses: number;
    use_count: number;
    not_after: Date | string;
    created_by: string | null;
    created_at: Date | string;
    updated_at: Date | string;
    last_used_at: Date | string | null;
    revoked_at: Date | string | null;
}

function toEnrollmentToken(row: EnrollmentTokenRow): EnrollmentToken {
    return {
        id: row.id,
        organizationId: row.organization_id,
        tokenPrefix: row.token_prefix,
        preferredProfileId: row.preferred_profile_id,
        state: row.state,
        maxUses: row.max_uses,
        useCount: row.use_count,
        notAfter: iso(row.not_after),
        createdBy: row.created_by,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        lastUsedAt: isoOrNull(row.last_used_at),
        revokedAt: isoOrNull(row.revoked_at)
    };
}

function toTokenLookupCredential(
    row: CredentialLookupRow
): DeviceIngressTokenLookupCredential {
    return {...toLookupCredential(row), tokenHash: row.token_hash ?? null};
}

function toConnection(row: ConnectionRow): DeviceIngressConnection {
    return {
        id: row.id,
        organizationId: row.organization_id,
        identityId: row.identity_id,
        credentialId: row.credential_id,
        reportedExternalId: row.reported_external_id,
        observedTransport: row.observed_transport,
        result: row.result,
        reasonCode: row.reason_code,
        remoteAddressHash: row.remote_address_hash,
        safeDetail: row.safe_detail ?? {},
        userAgent: row.user_agent,
        createdAt: iso(row.created_at),
        disconnectedAt: isoOrNull(row.disconnected_at),
        disconnectReason: row.disconnect_reason
    };
}

function toWaitingRoom(row: WaitingRoomRow): DeviceIngressWaitingRoomEntry {
    return {
        id: row.id,
        organizationId: row.organization_id,
        state: row.state,
        reportedExternalId: row.reported_external_id,
        observedTransport: row.observed_transport,
        securityModel: row.security_model,
        riskLevel: row.risk_level,
        profileId: row.profile_id,
        safeDetail: row.safe_detail ?? {},
        firstSeenAt: iso(row.first_seen_at),
        lastSeenAt: iso(row.last_seen_at),
        attemptCount: Number(row.attempt_count),
        approvedIdentityId: row.approved_identity_id,
        approvedAt: isoOrNull(row.approved_at),
        rejectedAt: isoOrNull(row.rejected_at),
        rejectionReason: row.rejection_reason,
        trustedCa: row.trusted_ca
    };
}

function toRejection(row: RejectionRow): DeviceIngressRejection {
    return {
        id: row.id,
        organizationId: row.organization_id,
        identityId: row.identity_id,
        credentialId: row.credential_id,
        waitingRoomId: row.waiting_room_id,
        reasonCode: row.reason_code,
        severity: row.severity,
        reportedExternalId: row.reported_external_id,
        observedTransport: row.observed_transport,
        safeDetail: row.safe_detail ?? {},
        createdAt: iso(row.created_at),
        resolvedAt: isoOrNull(row.resolved_at),
        resolvedBy: row.resolved_by,
        resolutionNote: row.resolution_note
    };
}

function toSetupSession(row: SetupSessionRow): DeviceIngressSetupSession {
    return {
        id: row.id,
        organizationId: row.organization_id,
        reportedExternalId: row.reported_external_id,
        profileId: row.profile_id,
        status: row.status,
        applyMethod: row.apply_method,
        bundle: row.bundle ?? {},
        errorCode: row.error_code,
        errorMessage: row.error_message,
        bundleFetchCount: Number(row.bundle_fetch_count ?? 0),
        expiresAt: iso(row.expires_at),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
    };
}
