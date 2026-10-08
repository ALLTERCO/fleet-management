// Front door for the deviceIngress operator RPCs the UI uses today. Shared
// enums come from the backend contract (@api) — one source of truth.

import type {
    DeviceIngressProfile,
    DeviceIngressProfileId
} from '@api/deviceIngress';
import {sendRPC} from '@/tools/websocket';

const TARGET = 'FLEET_MANAGER';

export type IngressProfile = DeviceIngressProfile;

/** Paginated list envelope returned by the operator list endpoints. */
export interface IngressList<T> {
    items: T[];
    total?: number;
    limit?: number;
    offset?: number;
}

export function listProfiles(): Promise<IngressList<IngressProfile>> {
    return sendRPC(TARGET, 'deviceIngress.Profile.List', {});
}

// Which device auth methods this deployment accepts. keysChecked is false
// when record_only (or disabled) admits devices without reading their key.
export interface AuthMethods {
    token: boolean;
    approvedId: boolean;
    certificate: boolean;
    keysChecked: boolean;
}

export function getAuthMethods(): Promise<AuthMethods> {
    return sendRPC(TARGET, 'deviceIngress.AuthMethods', {});
}

// Quick token: device-agnostic. The device has `validityMinutes` to connect
// using it — no device id needed up front.
export interface EnrollmentToken {
    url: string;
    tokenOnce: string;
    expiresAt: string;
}

export function createEnrollmentToken(
    validityMinutes: number,
    preferredProfileId?: DeviceIngressProfileId
): Promise<EnrollmentToken> {
    return sendRPC(TARGET, 'deviceIngress.EnrollmentToken.Create', {
        validityMinutes,
        preferredProfileId
    });
}

// Per-device certificate enrollment via the provisioning plan. Returns the
// install material (cert + key + CA) to upload to that device — once.
export interface CertEnrollment {
    expiresAt: string;
    fingerprintSha256: string | null;
    clientCertPem: string;
    clientKeyPem: string | null;
    userCaPem: string;
}

interface SetupPlanResponse {
    expiresAt: string;
    bundle?: {
        certificates?: {
            fingerprintSha256?: string | null;
            install?: {
                clientCertPem?: string;
                clientKeyPem?: string;
                userCaPem?: string;
            };
        };
    };
}

export async function createCertificateEnrollment(
    externalId: string,
    preferredProfileId: DeviceIngressProfileId,
    validityDays?: number
): Promise<CertEnrollment> {
    const plan = (await sendRPC(TARGET, 'deviceIngress.Setup.Plan', {
        reportedExternalId: externalId,
        preferredProfileId,
        issueCertificate: true,
        certificateValidityDays: validityDays
    })) as SetupPlanResponse;
    const certs = plan.bundle?.certificates;
    const install = certs?.install;
    if (!install?.clientCertPem || !install.userCaPem) {
        throw new Error('Certificate bundle was not issued for this profile');
    }
    return {
        expiresAt: plan.expiresAt,
        fingerprintSha256: certs?.fingerprintSha256 ?? null,
        clientCertPem: install.clientCertPem,
        clientKeyPem: install.clientKeyPem ?? null,
        userCaPem: install.userCaPem
    };
}

// Token bookkeeping: the backend stores every minted token (never the
// secret) with its lifecycle state and usage counters.
export interface EnrollmentTokenSummary {
    id: string;
    tokenPrefix: string;
    preferredProfileId: DeviceIngressProfileId | null;
    state: 'active' | 'consumed' | 'revoked';
    maxUses: number;
    useCount: number;
    notAfter: string;
    createdBy: string | null;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
}

export function listEnrollmentTokens(): Promise<
    IngressList<EnrollmentTokenSummary>
> {
    return sendRPC(TARGET, 'deviceIngress.EnrollmentToken.List', {});
}

export function revokeEnrollmentToken(id: string): Promise<{success: true}> {
    return sendRPC(TARGET, 'deviceIngress.EnrollmentToken.Revoke', {id});
}

// Device credential identities — which device connects with what.
export interface IngressIdentity {
    id: string;
    displayName: string;
    securityModel: string;
    transport: string;
    status: string;
    expectedExternalId: string | null;
    reportedExternalIds: string[];
    lastSeenAt: string | null;
    createdAt: string;
}

// The schema maximum, used only for the expiring-credentials lookup below.
const LIST_LIMIT = 500;

// Rows per page for the identity and rotation job tables.
export const PAGE_SIZE = 100;

export function listIdentities(page: {
    limit: number;
    offset: number;
}): Promise<IngressList<IngressIdentity>> {
    return sendRPC(TARGET, 'deviceIngress.Identity.List', page);
}

// Credentials nearing expiry, and identity enable/disable + rotation.
export interface ExpiringCredential {
    id: string;
    identityId: string;
    credentialType: string;
    state: string;
    tokenPrefix: string | null;
    notAfter: string | null;
    expectedExternalId: string | null;
}

export function listExpiringCredentials(
    days?: number
): Promise<IngressList<ExpiringCredential>> {
    return sendRPC(TARGET, 'deviceIngress.Credential.ListExpiring', {
        limit: LIST_LIMIT,
        ...(days ? {days} : {})
    });
}

export function enableIdentity(
    id: string
): Promise<{success: boolean; identity: IngressIdentity}> {
    return sendRPC(TARGET, 'deviceIngress.Identity.Enable', {id});
}

export function disableIdentity(
    id: string
): Promise<{success: boolean; identity: IngressIdentity}> {
    return sendRPC(TARGET, 'deviceIngress.Identity.Disable', {id});
}

export type RotationJobState =
    | 'queued'
    | 'sent'
    | 'waiting'
    | 'finalized'
    | 'failed'
    | 'cancelled';

export interface RotationJob {
    id: string;
    batchId: string;
    identityId: string;
    state: RotationJobState;
    errorCode: string | null;
    sentAt: string | null;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    // The device id the job rotates, so a job names its device without the
    // identity list. Null when the identity row is gone.
    expectedExternalId: string | null;
}

export function startRotation(
    identityIds: string[]
): Promise<{batchId: string; jobs: RotationJob[]}> {
    return sendRPC(TARGET, 'deviceIngress.Rotation.Start', {identityIds});
}

export function listRotationJobs(filter: {
    batchId?: string;
    state?: RotationJobState;
    limit: number;
    offset: number;
}): Promise<IngressList<RotationJob>> {
    return sendRPC(TARGET, 'deviceIngress.Rotation.List', filter);
}

export function cancelRotationJob(
    id: string
): Promise<{success: boolean; job: RotationJob}> {
    return sendRPC(TARGET, 'deviceIngress.Rotation.Cancel', {id});
}
