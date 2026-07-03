import {tuning} from '../../config/tuning';
import RpcError from '../../rpc/RpcError';
import type {
    DeviceIngressCredentialIdParams,
    DeviceIngressCredentialRotateParams
} from '../../types/api/deviceIngress';
import {
    closeCredentialConnections,
    closeIdentityConnections
} from './connectionRegistry';
import type {
    CreateCredentialInput,
    DeviceIngressCredential
} from './deviceIngressRepository';
import {invalidateCredential} from './deviceTrustCache';
import {createRawIngressToken, hashIngressToken} from './tokenHash';

export interface CreateTokenCredentialRepository {
    createCredential(
        input: CreateCredentialInput
    ): Promise<DeviceIngressCredential>;
}

export interface TokenCredentialRepository
    extends CreateTokenCredentialRepository {
    updateCredentialState(input: {
        organizationId: string;
        credentialId: string;
        state: DeviceIngressCredential['state'];
    }): Promise<DeviceIngressCredential | null>;
    finalizeCredentialRotation(input: {
        organizationId: string;
        credentialId: string;
    }): Promise<DeviceIngressCredential | null>;
}

export async function createTokenCredential(input: {
    organizationId: string;
    identityId: string;
    validityDays?: number;
    repository: CreateTokenCredentialRepository;
}): Promise<DeviceIngressCredential & {tokenOnce: string}> {
    const raw = createRawIngressToken();
    const credential = await input.repository.createCredential({
        organizationId: input.organizationId,
        identityId: input.identityId,
        credentialType: 'token',
        state: 'active',
        tokenHash: hashIngressToken(raw.token),
        tokenPrefix: raw.prefix,
        notAfter: expiresAt(input.validityDays).toISOString()
    });
    return {...credential, tokenOnce: raw.token};
}

export async function rotateTokenCredential(input: {
    organizationId: string;
    params: DeviceIngressCredentialRotateParams;
    repository: TokenCredentialRepository;
}): Promise<DeviceIngressCredential & {tokenOnce: string}> {
    return createPendingTokenCredential({
        organizationId: input.organizationId,
        identityId: input.params.identityId,
        validityDays: input.params.validityDays,
        repository: input.repository
    });
}

export async function createPendingTokenCredential(input: {
    organizationId: string;
    identityId: string;
    validityDays?: number;
    repository: CreateTokenCredentialRepository;
}): Promise<DeviceIngressCredential & {tokenOnce: string}> {
    const raw = createRawIngressToken();
    const credential = await input.repository.createCredential({
        organizationId: input.organizationId,
        identityId: input.identityId,
        credentialType: 'token',
        state: 'pending',
        tokenHash: hashIngressToken(raw.token),
        tokenPrefix: raw.prefix,
        notAfter: expiresAt(input.validityDays).toISOString()
    });
    return {...credential, tokenOnce: raw.token};
}

export async function finalizeCredentialRotation(input: {
    organizationId: string;
    params: DeviceIngressCredentialIdParams;
    repository: TokenCredentialRepository;
}): Promise<DeviceIngressCredential> {
    const credential = await input.repository.finalizeCredentialRotation({
        organizationId: input.organizationId,
        credentialId: input.params.credentialId
    });
    if (!credential) {
        throw RpcError.NotFound(
            'deviceIngress.credential',
            input.params.credentialId
        );
    }
    await invalidateCredential({
        credentialId: credential.id,
        identityId: credential.identityId
    });
    closeIdentityConnections(credential.identityId, 'credential_finalized');
    return credential;
}

export async function cancelCredentialRotation(input: {
    organizationId: string;
    params: DeviceIngressCredentialIdParams;
    repository: TokenCredentialRepository;
}): Promise<DeviceIngressCredential> {
    const credential = await setCredentialState(input, 'revoked');
    await invalidateCredential({
        credentialId: credential.id,
        identityId: credential.identityId
    });
    closeCredentialConnections(
        input.params.credentialId,
        'credential_rotation_cancelled'
    );
    return credential;
}

export async function revokeCredential(input: {
    organizationId: string;
    params: DeviceIngressCredentialIdParams;
    repository: TokenCredentialRepository;
}): Promise<DeviceIngressCredential> {
    const credential = await setCredentialState(input, 'revoked');
    await invalidateCredential({
        credentialId: credential.id,
        identityId: credential.identityId
    });
    closeCredentialConnections(input.params.credentialId, 'credential_revoked');
    return credential;
}

async function setCredentialState(
    input: {
        organizationId: string;
        params: DeviceIngressCredentialIdParams;
        repository: TokenCredentialRepository;
    },
    state: DeviceIngressCredential['state']
): Promise<DeviceIngressCredential> {
    const credential = await input.repository.updateCredentialState({
        organizationId: input.organizationId,
        credentialId: input.params.credentialId,
        state
    });
    if (!credential) {
        throw RpcError.NotFound(
            'deviceIngress.credential',
            input.params.credentialId
        );
    }
    return credential;
}

function expiresAt(validityDays: number | undefined): Date {
    const days = validityDays ?? tuning.deviceIngress.tokenValidityDays;
    return new Date(Date.now() + days * 86_400_000);
}
