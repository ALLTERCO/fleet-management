import {tuning} from '../../config/tuning';
import RpcError from '../../rpc/RpcError';
import type {DeviceIngressSetupPlanParams} from '../../types/api/deviceIngress';
import {createCertificateCredential} from './certificateCredentials';
import {type ConfigTemplate, selectConfigTemplate} from './configTemplates';
import type {
    CreateCredentialInput,
    CreateIdentityInput,
    CreateSetupSessionInput,
    DeviceIngressCredential,
    DeviceIngressIdentity,
    DeviceIngressSetupSession
} from './deviceIngressRepository';
import {requirePublicWsBaseUrl} from './publicWsBaseUrl';
import {
    attachCertificateInstallMaterial,
    type CertificateInstallMaterial,
    redactCertificateInstallMaterial
} from './setupInstallBundle';
import {createPendingTokenCredential} from './tokenCredentials';

export interface ProvisioningRepository {
    createIdentity(input: CreateIdentityInput): Promise<DeviceIngressIdentity>;
    createCredential(
        input: CreateCredentialInput
    ): Promise<DeviceIngressCredential>;
    createSetupSession(
        input: CreateSetupSessionInput
    ): Promise<DeviceIngressSetupSession>;
}

export interface CreateSetupPlanInput {
    organizationId: string;
    params: DeviceIngressSetupPlanParams;
    repository: ProvisioningRepository;
    certificateCredentials?: CertificateCredentialFactory;
    certificateInstallMaterial?: CertificateInstallMaterial | null;
}

export interface SetupPlanResult {
    sessionId: string;
    identity: DeviceIngressIdentity;
    credential: DeviceIngressCredential | null;
    profile: ConfigTemplate;
    preferredApplyMethod: string;
    expiresAt: string;
    bundle: Record<string, unknown>;
}

interface CertificateCredentialFactory {
    create(input: {
        organizationId: string;
        identityId: string;
        certificateId: string;
        state: 'active' | 'pending';
    }): Promise<DeviceIngressCredential>;
}

const defaultCertificateCredentials: CertificateCredentialFactory = {
    create: createCertificateCredential
};

export async function createSetupPlan(
    input: CreateSetupPlanInput
): Promise<SetupPlanResult> {
    const profile = selectRequiredTemplate(input.params);
    const identity = await createProvisioningIdentity(input, profile);
    const credential = await createProvisioningCredential(
        input,
        identity,
        profile
    );
    const publicBundle = publicProvisioningBundle(
        input,
        identity,
        credential,
        profile
    );
    const storedBundle = storedProvisioningBundle(publicBundle);
    const session = await input.repository.createSetupSession({
        organizationId: input.organizationId,
        reportedExternalId: input.params.reportedExternalId,
        profileId: profile.id,
        bundle: storedBundle,
        expiresAt: setupExpiresAt().toISOString()
    });
    return {
        sessionId: session.id,
        identity,
        credential,
        profile,
        preferredApplyMethod: profile.provisioning.preferredApplyMethod,
        expiresAt: session.expiresAt,
        bundle: {...publicBundle, sessionId: session.id}
    };
}

function selectRequiredTemplate(
    params: DeviceIngressSetupPlanParams
): ConfigTemplate {
    const hints = params.capabilities as
        | {
              modelFamily?: string;
              componentTypes?: string[];
              protocols?: string[];
          }
        | undefined;
    const template = selectConfigTemplate(
        {
            model: params.model,
            modelFamily: hints?.modelFamily,
            componentTypes: hints?.componentTypes,
            protocols: hints?.protocols
        },
        params.preferredProfileId
    );
    if (!template) throw RpcError.InvalidParams('no matching ingress profile');
    return template;
}

async function createProvisioningIdentity(
    input: CreateSetupPlanInput,
    profile: ConfigTemplate
): Promise<DeviceIngressIdentity> {
    return input.repository.createIdentity({
        organizationId: input.organizationId,
        subjectType:
            profile.securityModel === 'connector' ? 'connector' : 'device',
        subjectId: input.params.reportedExternalId,
        displayName: input.params.reportedExternalId,
        securityModel: profile.securityModel,
        transport: profile.transport,
        riskLevel: profile.riskLevel,
        status: 'pending',
        expectedExternalId: input.params.reportedExternalId
    });
}

async function createProvisioningCredential(
    input: CreateSetupPlanInput,
    identity: DeviceIngressIdentity,
    profile: ConfigTemplate
): Promise<DeviceIngressCredential | null> {
    if (profile.securityModel === 'certificate') {
        return createProvisioningCertificate(input, identity);
    }
    if (profile.securityModel !== 'direct_token') return null;
    return createPendingTokenCredential({
        organizationId: input.organizationId,
        identityId: identity.id,
        repository: input.repository
    });
}

async function createProvisioningCertificate(
    input: CreateSetupPlanInput,
    identity: DeviceIngressIdentity
): Promise<DeviceIngressCredential> {
    if (!input.params.certificateId) {
        throw RpcError.InvalidParams(
            'certificateId is required for certificate ingress profile'
        );
    }
    return (
        input.certificateCredentials ?? defaultCertificateCredentials
    ).create({
        organizationId: input.organizationId,
        identityId: identity.id,
        certificateId: input.params.certificateId,
        state: 'pending'
    });
}

function publicProvisioningBundle(
    input: CreateSetupPlanInput,
    identity: DeviceIngressIdentity,
    credential: (DeviceIngressCredential & {tokenOnce?: string}) | null,
    profile: ConfigTemplate
): Record<string, unknown> {
    return {
        organizationId: input.organizationId,
        identityId: identity.id,
        securityModel: profile.securityModel,
        transport: profile.transport,
        riskLevel: profile.riskLevel,
        applyMethod: profile.provisioning.preferredApplyMethod,
        deviceConfig: deviceConfig(input.params.reportedExternalId, credential),
        certificates: certificateBundle(
            credential,
            input.certificateInstallMaterial
        ),
        tokenOnce: credential?.tokenOnce,
        warnings: profile.warnings ?? [],
        requiresReboot: profile.provisioning.requiresReboot
    };
}

function storedProvisioningBundle(
    publicBundle: Record<string, unknown>
): Record<string, unknown> {
    const {tokenOnce: _secret, ...safe} = publicBundle;
    return redactCertificateInstallMaterial(safe);
}

function certificateBundle(
    credential: DeviceIngressCredential | null,
    installMaterial?: CertificateInstallMaterial | null
): Record<string, unknown> | undefined {
    if (!credential || credential.credentialType !== 'certificate') {
        return undefined;
    }
    const bundle = {
        certificateId: credential.certificateId,
        fingerprintSha256: credential.certificateFingerprint,
        notBefore: credential.notBefore,
        notAfter: credential.notAfter,
        requiresClientKey: installMaterial?.requiresClientKey === true
    };
    const material =
        installMaterial?.certificateId === credential.certificateId
            ? installMaterial
            : null;
    if (!material) return bundle;
    const withInstall = attachCertificateInstallMaterial(
        {certificates: bundle},
        material
    );
    return withInstall.certificates as Record<string, unknown>;
}

function deviceConfig(
    reportedExternalId: string,
    credential: (DeviceIngressCredential & {tokenOnce?: string}) | null
): Record<string, unknown> {
    if (credential?.credentialType === 'certificate') {
        return {
            ws: {
                enable: true,
                server: `${requirePublicWsBaseUrl()}?id=${encodeURIComponent(reportedExternalId)}`,
                ssl_ca: 'user_ca.pem'
            }
        };
    }
    const token = credential?.tokenOnce;
    return {
        ws: {
            enable: true,
            server: token
                ? `${requirePublicWsBaseUrl()}?id=${encodeURIComponent(reportedExternalId)}&token=${encodeURIComponent(token)}`
                : `${requirePublicWsBaseUrl()}?id=${encodeURIComponent(reportedExternalId)}`
        }
    };
}

function setupExpiresAt(): Date {
    return new Date(
        Date.now() + tuning.deviceIngress.provisioningSessionTtlMinutes * 60_000
    );
}
