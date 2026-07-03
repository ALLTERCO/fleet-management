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
