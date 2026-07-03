import {tuning} from '../../config/tuning';
import RpcError from '../../rpc/RpcError';
import type {DeviceIngressProfileId} from '../../types/api/deviceIngress';
import type {
    CreateEnrollmentTokenInput,
    EnrollmentToken
} from './deviceIngressRepository';
import {requirePublicWsBaseUrl} from './publicWsBaseUrl';
import {createRawIngressToken, hashIngressToken} from './tokenHash';

// Sibling of tokenCredentials: mints a device-agnostic enrollment token. Reuses
// the same token primitives (pepper + hash SSOT) and the public WS endpoint;
// writes to the dedicated enrollment table (no identity).
export interface CreateEnrollmentTokenRepository {
    createEnrollmentToken(
        input: CreateEnrollmentTokenInput
    ): Promise<EnrollmentToken>;
}

export interface CreatedEnrollmentToken {
    token: EnrollmentToken;
    tokenOnce: string;
    url: string;
}

export async function createEnrollmentToken(input: {
    organizationId: string;
    validityMinutes: number;
    maxUses: number;
    preferredProfileId: DeviceIngressProfileId | null;
    createdBy: string | null;
    repository: CreateEnrollmentTokenRepository;
}): Promise<CreatedEnrollmentToken> {
    const raw = createRawIngressToken();
    const token = await insertEnrollmentToken({
        input,
        tokenHash: hashIngressToken(raw.token),
        tokenPrefix: raw.prefix
    });
    return {token, tokenOnce: raw.token, url: enrollmentUrl(raw.token)};
}

async function insertEnrollmentToken(params: {
    input: {
        organizationId: string;
        validityMinutes: number;
        maxUses: number;
        preferredProfileId: DeviceIngressProfileId | null;
        createdBy: string | null;
        repository: CreateEnrollmentTokenRepository;
    };
    tokenHash: string;
    tokenPrefix: string;
}): Promise<EnrollmentToken> {
    try {
        return await params.input.repository.createEnrollmentToken({
            organizationId: params.input.organizationId,
            tokenHash: params.tokenHash,
            tokenPrefix: params.tokenPrefix,
            preferredProfileId: params.input.preferredProfileId,
            maxUses: params.input.maxUses,
            notAfter: expiresAt(params.input.validityMinutes).toISOString(),
            createdBy: params.input.createdBy,
            activeCap: tuning.deviceIngress.enrollmentMaxActivePerOrg,
            validityMinutes: params.input.validityMinutes
        });
    } catch (error) {
        if (isActiveCapError(error)) throw activeCapError();
        throw error;
    }
}

function isActiveCapError(error: unknown): boolean {
    return (
        error instanceof Error &&
        error.message === 'enrollment_token_active_cap'
    );
}

function activeCapError(): RpcError {
    return RpcError.Domain('RateLimitExceeded', {
        details: {
            reason: 'enrollment_token_active_cap',
            limit: tuning.deviceIngress.enrollmentMaxActivePerOrg
        }
    });
}

// No device id — the device is unknown until it connects. Same public WS base
// the provisioning plan uses (SSOT), token-only query.
function enrollmentUrl(token: string): string {
    return `${requirePublicWsBaseUrl()}?token=${encodeURIComponent(token)}`;
}

function expiresAt(validityMinutes: number): Date {
    return new Date(Date.now() + validityMinutes * 60_000);
}
