import {tuning} from '../../config/tuning';
import {readFmCaCertificatePem} from '../../modules/certificate/fmCaSigner';
import {
    type DeviceIngressAuditKind,
    logDeviceIngressAudit
} from '../../modules/deviceIngress/audit';
import {availableAuthMethods} from '../../modules/deviceIngress/authMethods';
import {createCertificateCredential} from '../../modules/deviceIngress/certificateCredentials';
import {
    getConfigTemplate,
    listConfigTemplates
} from '../../modules/deviceIngress/configTemplates';
import {
    closeConnection,
    closeIdentityConnections
} from '../../modules/deviceIngress/connectionRegistry';
import * as repository from '../../modules/deviceIngress/deviceIngressRepository';
import {invalidateIdentity} from '../../modules/deviceIngress/deviceTrustCache';
import {createEnrollmentToken} from '../../modules/deviceIngress/enrollmentTokens';
import {
    recordCertificateBindingMetric,
    recordProvisioningSessionMetric,
    recordTokenRotationMetric
} from '../../modules/deviceIngress/metrics';
import {createSetupPlan} from '../../modules/deviceIngress/provisioningPlan';
import {enforceDeviceIngressRateLimit} from '../../modules/deviceIngress/rateLimits';
import {resolveRejection} from '../../modules/deviceIngress/rejections';
import {
    riskForIngress,
    riskMatchesIngress
} from '../../modules/deviceIngress/riskPolicy';
import {
    attachCertificateInstallMaterial,
    type CertificateInstallMaterial
} from '../../modules/deviceIngress/setupInstallBundle';
import {
    cancelCredentialRotation,
    createTokenCredential,
    finalizeCredentialRotation,
    revokeCredential,
    rotateTokenCredential
} from '../../modules/deviceIngress/tokenCredentials';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {CertificateResponse} from '../../types/api/certificate';
import {
    DEVICE_INGRESS_CONNECTION_DISCONNECT_PARAMS_SCHEMA,
    DEVICE_INGRESS_CONNECTION_GET_PARAMS_SCHEMA,
    DEVICE_INGRESS_CONNECTION_LIST_PARAMS_SCHEMA,
    DEVICE_INGRESS_CREDENTIAL_CREATE_TOKEN_PARAMS_SCHEMA,
    DEVICE_INGRESS_CREDENTIAL_ID_PARAMS_SCHEMA,
    DEVICE_INGRESS_CREDENTIAL_ROTATE_PARAMS_SCHEMA,
    DEVICE_INGRESS_DESCRIBE,
    DEVICE_INGRESS_EMPTY_PARAMS_SCHEMA,
    DEVICE_INGRESS_ENROLLMENT_TOKEN_CREATE_PARAMS_SCHEMA,
    DEVICE_INGRESS_ENROLLMENT_TOKEN_REVOKE_PARAMS_SCHEMA,
    DEVICE_INGRESS_IDENTITY_CREATE_PARAMS_SCHEMA,
    DEVICE_INGRESS_IDENTITY_GET_PARAMS_SCHEMA,
    DEVICE_INGRESS_IDENTITY_LIST_PARAMS_SCHEMA,
    DEVICE_INGRESS_IDENTITY_UPDATE_PARAMS_SCHEMA,
    DEVICE_INGRESS_REJECTION_LIST_PARAMS_SCHEMA,
    DEVICE_INGRESS_REJECTION_RESOLVE_PARAMS_SCHEMA,
    DEVICE_INGRESS_SETUP_BUNDLE_PARAMS_SCHEMA,
    DEVICE_INGRESS_SETUP_PLAN_PARAMS_SCHEMA,
    DEVICE_INGRESS_SETUP_REPORT_APPLY_PARAMS_SCHEMA,
    type DeviceIngressConnectionDisconnectParams,
    type DeviceIngressConnectionGetParams,
    type DeviceIngressConnectionListParams,
    type DeviceIngressCredentialCreateTokenParams,
    type DeviceIngressCredentialIdParams,
    type DeviceIngressCredentialRotateParams,
    type DeviceIngressEnrollmentTokenCreateParams,
    type DeviceIngressEnrollmentTokenRevokeParams,
    type DeviceIngressIdentityCreateParams,
    type DeviceIngressIdentityGetParams,
    type DeviceIngressIdentityListParams,
    type DeviceIngressIdentityUpdateParams,
    type DeviceIngressRejectionListParams,
    type DeviceIngressRejectionResolveParams,
    type DeviceIngressSetupBundleParams,
    type DeviceIngressSetupPlanParams,
    type DeviceIngressSetupReportApplyParams
} from '../../types/api/deviceIngress';
import type CommandSender from '../CommandSender';
import {canManageAuthz} from './authzPermissions';
import CertificateComponent from './CertificateComponent';
import Component from './Component';

const DEVICE_INGRESS_COLLECTION = () => undefined;

interface DeviceIngressDeps {
    repository: typeof repository;
    certificates: DeviceIngressCertificateIssuer;
    certificateCredentials?: DeviceIngressCertificateCredentialFactory;
    readUserCaPem: () => string;
}

interface DeviceIngressCertificateIssuer {
    signCsr(
        params: unknown,
        sender: CommandSender
    ): Promise<CertificateResponse>;
    issueDeviceCert(
        params: unknown,
        sender: CommandSender
    ): Promise<CertificateResponse>;
    issueProvisioningDeviceCert(
        params: unknown,
        sender: CommandSender
    ): Promise<CertificateResponse>;
    export(
        params: unknown,
        sender: CommandSender
    ): Promise<DeviceIngressCertificateExport>;
}

interface DeviceIngressCertificateExport {
    id: string;
    name: string;
    pem: string;
    privateKeyPem?: string;
}

interface DeviceIngressCertificateCredentialFactory {
    create(input: {
        organizationId: string;
        identityId: string;
        certificateId: string;
        state: 'active' | 'pending';
    }): Promise<repository.DeviceIngressCredential>;
}

const defaultDeps: DeviceIngressDeps = {
    repository,
    certificates: new CertificateComponent(),
    readUserCaPem: readFmCaCertificatePem
};

export default class DeviceIngressComponent extends Component {
    private readonly deps: DeviceIngressDeps;

    constructor(deps: Partial<DeviceIngressDeps> = {}) {
        super('deviceIngress', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: false
        });
        this.deps = {
            repository: deps.repository ?? defaultDeps.repository,
            certificates: deps.certificates ?? defaultDeps.certificates,
            certificateCredentials: deps.certificateCredentials,
            readUserCaPem: deps.readUserCaPem ?? defaultDeps.readUserCaPem
        };
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe() {
        return DEVICE_INGRESS_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('Profile.List')
    @Component.CrudPermission('devices', 'read', DEVICE_INGRESS_COLLECTION)
    listProfiles(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params,
            DEVICE_INGRESS_EMPTY_PARAMS_SCHEMA
        );
        return {items: listConfigTemplates()};
    }

    // Single source of truth for the UI: which auth methods this deployment
    // accepts. Certificate is always false — stock Shelly WS has no client cert.
    @Component.NoAudit
    @Component.Expose('AuthMethods')
    @Component.CrudPermission('devices', 'read', DEVICE_INGRESS_COLLECTION)
    authMethods(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params,
            DEVICE_INGRESS_EMPTY_PARAMS_SCHEMA
        );
        return availableAuthMethods(tuning.deviceIngress.enforcementMode);
    }

    @Component.Expose('Identity.Create')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    @Component.RateLimit('expensive')
    async createIdentity(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Identity.Create');
        const p = validateOrThrow<DeviceIngressIdentityCreateParams>(
            params,
            DEVICE_INGRESS_IDENTITY_CREATE_PARAMS_SCHEMA
        );
        assertRiskPolicy(p);
        const identity = await this.deps.repository.createIdentity({
            organizationId: requireOrganizationId(sender),
            ...p
        });
        await this.audit(sender, 'identity_created', identity.id, {
            securityModel: identity.securityModel,
            transport: identity.transport,
            riskLevel: identity.riskLevel,
            subjectType: identity.subjectType
        });
        return identity;
    }

    @Component.NoAudit
    @Component.Expose('Identity.Get')
    @Component.CrudPermission('devices', 'read', DEVICE_INGRESS_COLLECTION)
    async getIdentity(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<DeviceIngressIdentityGetParams>(
            params,
            DEVICE_INGRESS_IDENTITY_GET_PARAMS_SCHEMA
        );
        const identity = await this.deps.repository.getIdentity({
            organizationId: requireOrganizationId(sender),
            id: p.id
        });
        if (!identity) throw RpcError.NotFound('deviceIngress.identity', p.id);
        return identity;
    }

    @Component.Expose('Identity.Update')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    async updateIdentity(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Identity.Update');
        const p = validateOrThrow<DeviceIngressIdentityUpdateParams>(
            params,
            DEVICE_INGRESS_IDENTITY_UPDATE_PARAMS_SCHEMA
        );
        const identity = await this.deps.repository.updateIdentity({
            organizationId: requireOrganizationId(sender),
            id: p.id,
            displayName: p.displayName,
            expectedExternalId: p.expectedExternalId
        });
        if (!identity) throw RpcError.NotFound('deviceIngress.identity', p.id);
        await this.audit(sender, 'identity_updated', identity.id, {
            securityModel: identity.securityModel,
            transport: identity.transport,
            riskLevel: identity.riskLevel
        });
        return identity;
    }

    @Component.Expose('Identity.Disable')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    async disableIdentity(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Identity.Disable');
        const p = validateOrThrow<DeviceIngressIdentityGetParams>(
            params,
            DEVICE_INGRESS_IDENTITY_GET_PARAMS_SCHEMA
        );
        const identity = await this.deps.repository.updateIdentityStatus({
            organizationId: requireOrganizationId(sender),
            id: p.id,
            status: 'disabled'
        });
        if (!identity) throw RpcError.NotFound('deviceIngress.identity', p.id);
        await invalidateIdentity(identity.id);
        closeIdentityConnections(p.id, 'identity_disabled');
        await this.audit(sender, 'identity_disabled', identity.id, {
            status: identity.status
        });
        return {success: true, identity};
    }

    @Component.NoAudit
    @Component.Expose('Identity.List')
    @Component.CrudPermission('devices', 'read', DEVICE_INGRESS_COLLECTION)
    async listIdentities(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<DeviceIngressIdentityListParams>(
            params,
            DEVICE_INGRESS_IDENTITY_LIST_PARAMS_SCHEMA
        );
        const page = await this.deps.repository.listIdentities({
            organizationId: requireOrganizationId(sender),
            status: p.status,
            securityModel: p.securityModel,
            transport: p.transport,
            limit: p.limit ?? defaultListLimit(),
            offset: p.offset ?? 0
        });
        return buildListResponse(
            page.items,
            page.total,
            p.limit ?? defaultListLimit(),
            p.offset ?? 0
        );
    }

    @Component.Expose('Credential.CreateToken')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    @Component.RateLimit('expensive')
    async createToken(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Credential.CreateToken');
        const p = validateOrThrow<DeviceIngressCredentialCreateTokenParams>(
            params,
            DEVICE_INGRESS_CREDENTIAL_CREATE_TOKEN_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        await this.requireIdentity(orgId, p.identityId);
        const credential = await createTokenCredential({
            organizationId: orgId,
            identityId: p.identityId,
            validityDays: p.validityDays,
            repository: this.deps.repository
        });
        await invalidateIdentity(p.identityId);
        recordTokenRotationMetric('created');
        await this.audit(sender, 'credential_created', credential.id, {
            identityId: credential.identityId,
            credentialType: credential.credentialType,
            state: credential.state
        });
        return credential;
    }

    @Component.Expose('EnrollmentToken.Create')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    @Component.RateLimit('expensive')
    async mintEnrollmentToken(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'EnrollmentToken.Create');
        const p = validateOrThrow<DeviceIngressEnrollmentTokenCreateParams>(
            params,
            DEVICE_INGRESS_ENROLLMENT_TOKEN_CREATE_PARAMS_SCHEMA
        );
        assertEnrollmentLimits(p);
        const created = await createEnrollmentToken({
            organizationId: requireOrganizationId(sender),
            validityMinutes: p.validityMinutes,
            maxUses: p.maxUses ?? 1,
            preferredProfileId: p.preferredProfileId ?? null,
            createdBy: actorFor(sender),
            repository: this.deps.repository
        });
        await this.audit(sender, 'enrollment_token_created', created.token.id, {
            maxUses: created.token.maxUses,
            notAfter: created.token.notAfter,
            preferredProfileId: created.token.preferredProfileId
        });
        return {
            url: created.url,
            tokenOnce: created.tokenOnce,
            expiresAt: created.token.notAfter
        };
    }

    @Component.Expose('EnrollmentToken.List')
    @Component.CrudPermission('devices', 'read', DEVICE_INGRESS_COLLECTION)
    async listEnrollmentTokens(params: unknown, sender: CommandSender) {
        validateOrThrow<Record<string, never>>(
            params,
            DEVICE_INGRESS_EMPTY_PARAMS_SCHEMA
        );
        const items = await this.deps.repository.listEnrollmentTokens({
            organizationId: requireOrganizationId(sender)
        });
        return {items};
    }

    @Component.Expose('EnrollmentToken.Revoke')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    @Component.RateLimit('expensive')
    async revokeEnrollmentToken(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'EnrollmentToken.Revoke');
        const p = validateOrThrow<DeviceIngressEnrollmentTokenRevokeParams>(
            params,
            DEVICE_INGRESS_ENROLLMENT_TOKEN_REVOKE_PARAMS_SCHEMA
        );
        const token = await this.deps.repository.revokeEnrollmentToken({
            organizationId: requireOrganizationId(sender),
            id: p.id
        });
        if (!token) {
            throw RpcError.NotFound('deviceIngress.enrollmentToken', p.id);
        }
        await this.audit(sender, 'enrollment_token_revoked', token.id, {});
        return {success: true};
    }

    @Component.Expose('Credential.Rotate')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    @Component.RateLimit('expensive')
    async rotateCredential(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Credential.Rotate');
        const p = validateOrThrow<DeviceIngressCredentialRotateParams>(
            params,
            DEVICE_INGRESS_CREDENTIAL_ROTATE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        await this.requireIdentity(orgId, p.identityId);
        if (p.credentialType === 'token') {
            const credential = await rotateTokenCredential({
                organizationId: orgId,
                params: p,
                repository: this.deps.repository
            });
            await invalidateIdentity(credential.identityId);
            recordTokenRotationMetric('rotated');
            await this.audit(sender, 'credential_rotated', credential.id, {
                identityId: credential.identityId,
                credentialType: credential.credentialType,
                state: credential.state
            });
            return credential;
        }
        const credential = await this.rotateCertificate(orgId, p);
        await invalidateIdentity(credential.identityId);
        recordCertificateBindingMetric('rotated');
        await this.audit(sender, 'credential_rotated', credential.id, {
            identityId: credential.identityId,
            credentialType: credential.credentialType,
            state: credential.state
        });
        return credential;
    }

    @Component.Expose('Credential.FinalizeRotation')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    async finalizeRotation(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Credential.FinalizeRotation');
        const p = validateOrThrow<DeviceIngressCredentialIdParams>(
            params,
            DEVICE_INGRESS_CREDENTIAL_ID_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const credential = await finalizeCredentialRotation({
            organizationId: orgId,
            params: p,
            repository: this.deps.repository
        });
        recordTokenRotationMetric('finalized');
        await this.audit(sender, 'credential_finalized', credential.id, {
            identityId: credential.identityId,
            credentialType: credential.credentialType
        });
        return {success: true, credential};
    }

    @Component.Expose('Credential.CancelRotation')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    async cancelRotation(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Credential.CancelRotation');
        const p = validateOrThrow<DeviceIngressCredentialIdParams>(
            params,
            DEVICE_INGRESS_CREDENTIAL_ID_PARAMS_SCHEMA
        );
        const credential = await cancelCredentialRotation({
            organizationId: requireOrganizationId(sender),
            params: p,
            repository: this.deps.repository
        });
        recordTokenRotationMetric('cancelled');
        await this.audit(sender, 'credential_cancelled', credential.id, {
            identityId: credential.identityId,
            credentialType: credential.credentialType
        });
        return {success: true, credential};
    }

    @Component.Expose('Credential.Revoke')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    async revokeCredential(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Credential.Revoke');
        const p = validateOrThrow<DeviceIngressCredentialIdParams>(
            params,
            DEVICE_INGRESS_CREDENTIAL_ID_PARAMS_SCHEMA
        );
        const credential = await revokeCredential({
            organizationId: requireOrganizationId(sender),
            params: p,
            repository: this.deps.repository
        });
        recordTokenRotationMetric('revoked');
        await this.audit(sender, 'credential_revoked', credential.id, {
            identityId: credential.identityId,
            credentialType: credential.credentialType
        });
        return {success: true, credential};
    }

    @Component.NoAudit
    @Component.Expose('Connection.List')
    @Component.CrudPermission('devices', 'read', DEVICE_INGRESS_COLLECTION)
    async listConnections(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<DeviceIngressConnectionListParams>(
            params,
            DEVICE_INGRESS_CONNECTION_LIST_PARAMS_SCHEMA
        );
        const limit = p.limit ?? defaultListLimit();
        const offset = p.offset ?? 0;
        const page = await this.deps.repository.listConnections({
            organizationId: requireOrganizationId(sender),
            identityId: p.identityId,
            result: p.result,
            limit,
            offset
        });
        return buildListResponse(page.items, page.total, limit, offset);
    }

    @Component.NoAudit
    @Component.Expose('Connection.Get')
    @Component.CrudPermission('devices', 'read', DEVICE_INGRESS_COLLECTION)
    async getConnection(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<DeviceIngressConnectionGetParams>(
            params,
            DEVICE_INGRESS_CONNECTION_GET_PARAMS_SCHEMA
        );
        const connection = await this.deps.repository.getConnection({
            organizationId: requireOrganizationId(sender),
            id: p.id
        });
        if (!connection) {
            throw RpcError.NotFound('deviceIngress.connection', p.id);
        }
        return connection;
    }

    @Component.Expose('Connection.Disconnect')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    async disconnectConnection(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Connection.Disconnect');
        const p = validateOrThrow<DeviceIngressConnectionDisconnectParams>(
            params,
            DEVICE_INGRESS_CONNECTION_DISCONNECT_PARAMS_SCHEMA
        );
        const reason = p.reason ?? 'operator_disconnect';
        // Verify the connection belongs to the caller's org before touching the
        // live socket — closeConnection is registry-wide and unscoped.
        const connection =
            await this.deps.repository.markConnectionDisconnected({
                organizationId: requireOrganizationId(sender),
                id: p.id,
                reason
            });
        if (!connection) {
            throw RpcError.NotFound('deviceIngress.connection', p.id);
        }
        closeConnection(p.id, reason);
        await this.audit(sender, 'connection_disconnected', connection.id, {
            reason,
            identityId: connection.identityId
        });
        return {success: true, connection};
    }

    @Component.NoAudit
    @Component.Expose('Rejection.List')
    @Component.CrudPermission('devices', 'read', DEVICE_INGRESS_COLLECTION)
    async listRejections(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<DeviceIngressRejectionListParams>(
            params,
            DEVICE_INGRESS_REJECTION_LIST_PARAMS_SCHEMA
        );
        const limit = p.limit ?? defaultListLimit();
        const offset = p.offset ?? 0;
        const page = await this.deps.repository.listRejections({
            organizationId: requireOrganizationId(sender),
            severity: p.severity,
            reasonCode: p.reasonCode,
            limit,
            offset
        });
        return buildListResponse(page.items, page.total, limit, offset);
    }

    @Component.Expose('Rejection.Resolve')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    async resolveRejection(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Rejection.Resolve');
        const p = validateOrThrow<DeviceIngressRejectionResolveParams>(
            params,
            DEVICE_INGRESS_REJECTION_RESOLVE_PARAMS_SCHEMA
        );
        const resolvedBy = sender.getUser()?.username ?? 'unknown';
        const rejection = await resolveRejection({
            organizationId: requireOrganizationId(sender),
            params: p,
            actor: resolvedBy,
            repository: this.deps.repository
        });
        await this.audit(sender, 'rejection_resolved', rejection.id, {
            reasonCode: rejection.reasonCode
        });
        return {success: true, rejection};
    }

    @Component.Expose('Setup.Plan')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    @Component.RateLimit('expensive')
    async planSetup(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Setup.Plan');
        const p = validateOrThrow<DeviceIngressSetupPlanParams>(
            params,
            DEVICE_INGRESS_SETUP_PLAN_PARAMS_SCHEMA
        );
        const setup = await this.withResolvedCertificate(p, sender);
        const plan = await createSetupPlan({
            organizationId: requireOrganizationId(sender),
            params: setup.params,
            repository: this.deps.repository,
            certificateCredentials: this.deps.certificateCredentials,
            certificateInstallMaterial: setup.certificateInstallMaterial
        });
        recordProvisioningSessionMetric({
            outcome: 'planned',
            profile: plan.profile.id
        });
        if (plan.credential?.credentialType === 'certificate') {
            recordCertificateBindingMetric('created');
        }
        await this.audit(sender, 'setup_plan_created', plan.sessionId, {
            identityId: plan.identity.id,
            profileId: plan.profile.id,
            securityModel: plan.profile.securityModel,
            transport: plan.profile.transport
        });
        return plan;
    }

    @Component.Expose('Setup.Bundle')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    async setupBundle(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Setup.Bundle');
        const p = validateOrThrow<DeviceIngressSetupBundleParams>(
            params,
            DEVICE_INGRESS_SETUP_BUNDLE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        await this.assertCanFetchSetupBundle({
            organizationId,
            sessionId: p.sessionId,
            sender
        });
        const session = await this.deps.repository.fetchSetupBundle({
            organizationId,
            sessionId: p.sessionId,
            maxFetches: tuning.deviceIngress.provisioningMaxBundleFetches
        });
        if (!session) {
            throw RpcError.NotFound('deviceIngress.setupSession', p.sessionId);
        }
        const enrichedSession = await this.withSetupInstallMaterial(
            session,
            sender
        );
        await this.audit(sender, 'setup_bundle_fetched', session.id, {
            profileId: session.profileId,
            fetchCount: session.bundleFetchCount
        });
        return enrichedSession;
    }

    @Component.Expose('Setup.ReportApply')
    @Component.CrudPermission('devices', 'update', DEVICE_INGRESS_COLLECTION)
    async reportSetupApply(params: unknown, sender: CommandSender) {
        await this.limitMutation(sender, 'Setup.ReportApply');
        const p = validateOrThrow<DeviceIngressSetupReportApplyParams>(
            params,
            DEVICE_INGRESS_SETUP_REPORT_APPLY_PARAMS_SCHEMA
        );
        const session = await this.deps.repository.reportSetupApply({
            organizationId: requireOrganizationId(sender),
            sessionId: p.sessionId,
            status: p.status,
            applyMethod: p.applyMethod,
            errorCode: p.errorCode,
            errorMessage: p.errorMessage
        });
        if (!session) {
            throw RpcError.NotFound('deviceIngress.setupSession', p.sessionId);
        }
        recordProvisioningSessionMetric({
            outcome: session.status,
            profile: session.profileId
        });
        await this.audit(sender, 'setup_apply_reported', session.id, {
            profileId: session.profileId,
            status: session.status,
            applyMethod: session.applyMethod
        });
        return {success: true, session};
    }

    private async requireIdentity(organizationId: string, id: string) {
        const identity = await this.deps.repository.getIdentity({
            organizationId,
            id
        });
        if (!identity) throw RpcError.NotFound('deviceIngress.identity', id);
        return identity;
    }

    private async limitMutation(
        sender: CommandSender,
        scope: string
    ): Promise<void> {
        await enforceDeviceIngressRateLimit({
            scope,
            actor: actorFor(sender),
            capacityPerMinute: tuning.deviceIngress.mutationsPerActorPerMinute
        });
    }

    private async audit(
        sender: CommandSender,
        kind: DeviceIngressAuditKind,
        subjectId: string,
        details: Record<string, unknown>
    ): Promise<void> {
        await logDeviceIngressAudit({
            kind,
            organizationId: requireOrganizationId(sender),
            actor: actorFor(sender),
            subjectId,
            details
        });
    }

    private async rotateCertificate(
        organizationId: string,
        params: DeviceIngressCredentialRotateParams
    ) {
        if (!params.certificateId) {
            throw RpcError.InvalidParams('certificateId is required');
        }
        return createCertificateCredential({
            organizationId,
            identityId: params.identityId,
            state: 'pending',
            certificateId: params.certificateId
        });
    }

    private async withResolvedCertificate(
        params: DeviceIngressSetupPlanParams,
        sender: CommandSender
    ): Promise<{
        params: DeviceIngressSetupPlanParams;
        certificateInstallMaterial?: CertificateInstallMaterial;
    }> {
        assertCertificateProvisioningRequest(params);
        if (!usesCertificateProvisioning(params)) return {params};
        assertCanManageCertificateSetup(sender);
        const source = await this.resolveCertificateSource(params, sender);
        return {
            params: source.params,
            certificateInstallMaterial: await this.certificateInstallMaterial({
                certificateId: source.certificateId,
                sender,
                requireClientKey: source.requireClientKey
            })
        };
    }

    // Each cert source resolves to a certificateId; the single caller above
    // builds the install material once. requireClientKey is true only when FM
    // generated the key pair (the device needs it; an imported/CSR cert does not).
    private async resolveCertificateSource(
        params: DeviceIngressSetupPlanParams,
        sender: CommandSender
    ): Promise<{
        params: DeviceIngressSetupPlanParams;
        certificateId: string;
        requireClientKey: boolean;
    }> {
        if (params.certificateId) {
            return {
                params,
                certificateId: params.certificateId,
                requireClientKey: false
            };
        }
        if (params.certificateCsrPem) {
            const certificate = await this.deps.certificates.signCsr(
                {
                    csrPem: params.certificateCsrPem,
                    validityDays: params.certificateValidityDays,
                    name: params.certificateName
                },
                sender
            );
            return {
                params: {...params, certificateId: certificate.id},
                certificateId: certificate.id,
                requireClientKey: false
            };
        }
        if (!tuning.deviceIngress.provisioningAllowFmIssuedPrivateKey) {
            throw RpcError.InvalidParams(
                'FM-issued certificate provisioning is disabled'
            );
        }
        const certificate =
            await this.deps.certificates.issueProvisioningDeviceCert(
                {
                    shellyId: params.reportedExternalId,
                    validityDays: params.certificateValidityDays,
                    name: params.certificateName
                },
                sender
            );
        return {
            params: {...params, certificateId: certificate.id},
            certificateId: certificate.id,
            requireClientKey: true
        };
    }

    private async withSetupInstallMaterial(
        session: repository.DeviceIngressSetupSession,
        sender: CommandSender
    ): Promise<repository.DeviceIngressSetupSession> {
        const certificateId = certificateIdFromBundle(session.bundle);
        if (!certificateId) return session;
        assertCanManageCertificateSetup(sender);
        const material = await this.certificateInstallMaterial({
            certificateId,
            sender,
            requireClientKey: certificateRequiresClientKeyFromBundle(
                session.bundle
            )
        });
        return {
            ...session,
            bundle: attachCertificateInstallMaterial(session.bundle, material)
        };
    }

    private async assertCanFetchSetupBundle(input: {
        organizationId: string;
        sessionId: string;
        sender: CommandSender;
    }): Promise<void> {
        const session = await this.deps.repository.getSetupSession({
            organizationId: input.organizationId,
            sessionId: input.sessionId
        });
        if (!session || setupSessionExpired(session)) return;
        if (certificateIdFromBundle(session.bundle)) {
            assertCanManageCertificateSetup(input.sender);
        }
    }

    private async certificateInstallMaterial(input: {
        certificateId: string;
        sender: CommandSender;
        requireClientKey: boolean;
    }): Promise<CertificateInstallMaterial> {
        const certificate = await this.deps.certificates.export(
            {id: input.certificateId, includePrivateKey: true},
            input.sender
        );
        assertCertificatePrivateKey(certificate, input);
        return {
            certificateId: input.certificateId,
            userCaPem: this.deps.readUserCaPem(),
            clientCertPem: certificate.pem,
            clientKeyPem: certificate.privateKeyPem,
            requiresClientKey: input.requireClientKey
        };
    }
}

function certificateIdFromBundle(
    bundle: Record<string, unknown>
): string | null {
    const certificates = bundle.certificates;
    if (
        !certificates ||
        typeof certificates !== 'object' ||
        Array.isArray(certificates)
    ) {
        return null;
    }
    const certificateId = (certificates as {certificateId?: unknown})
        .certificateId;
    return typeof certificateId === 'string' ? certificateId : null;
}

function certificateRequiresClientKeyFromBundle(
    bundle: Record<string, unknown>
): boolean {
    const certificates = bundle.certificates;
    if (
        !certificates ||
        typeof certificates !== 'object' ||
        Array.isArray(certificates)
    ) {
        return false;
    }
    return (
        (certificates as {requiresClientKey?: unknown}).requiresClientKey ===
        true
    );
}

function setupSessionExpired(
    session: repository.DeviceIngressSetupSession
): boolean {
    return Date.parse(session.expiresAt) < Date.now();
}

function actorFor(sender: CommandSender): string {
    return sender.getUser()?.username ?? sender.getUser()?.userId ?? 'unknown';
}

function assertCanManageCertificateSetup(sender: CommandSender): void {
    if (!canManageAuthz(sender)) throw RpcError.Unauthorized();
}

function assertCertificatePrivateKey(
    certificate: DeviceIngressCertificateExport,
    options: {requireClientKey: boolean}
): void {
    if (options.requireClientKey && !certificate.privateKeyPem) {
        throw RpcError.InvalidParams(
            'certificate private key is required for install bundle'
        );
    }
}

// Static schema bounds are the ceiling; deployment can tighten via env.
function assertEnrollmentLimits(
    p: DeviceIngressEnrollmentTokenCreateParams
): void {
    if (p.validityMinutes > tuning.deviceIngress.enrollmentMaxValidityMinutes) {
        throw RpcError.InvalidParams(
            'validityMinutes exceeds the configured maximum'
        );
    }
    if ((p.maxUses ?? 1) > tuning.deviceIngress.enrollmentMaxUses) {
        throw RpcError.InvalidParams('maxUses exceeds the configured maximum');
    }
}

function assertRiskPolicy(input: DeviceIngressIdentityCreateParams): void {
    if (riskMatchesIngress(input)) return;
    throw RpcError.InvalidParams(
        `riskLevel must be ${riskForIngress(input)} for ${input.securityModel}/${input.transport}`
    );
}

function defaultListLimit(): number {
    return tuning.deviceIngress.listLimit;
}

function shouldIssueCertificate(params: DeviceIngressSetupPlanParams): boolean {
    return params.issueCertificate === true;
}

function usesCertificateProvisioning(
    params: DeviceIngressSetupPlanParams
): boolean {
    return Boolean(
        params.certificateId ||
            params.certificateCsrPem ||
            shouldIssueCertificate(params)
    );
}

function assertCertificateProvisioningRequest(
    params: DeviceIngressSetupPlanParams
): void {
    if (!usesCertificateProvisioning(params)) return;
    if (!params.preferredProfileId) {
        throw RpcError.InvalidParams(
            'certificate provisioning requires a certificate ingress profile'
        );
    }
    const profile = getConfigTemplate(params.preferredProfileId);
    if (profile.securityModel !== 'certificate') {
        throw RpcError.InvalidParams(
            'certificate provisioning requires a certificate ingress profile'
        );
    }
    if (certificateSourceCount(params) <= 1) return;
    throw RpcError.InvalidParams(
        'choose one certificate source: certificateId, certificateCsrPem, or issueCertificate'
    );
}

function certificateSourceCount(params: DeviceIngressSetupPlanParams): number {
    return [
        Boolean(params.certificateId),
        Boolean(params.certificateCsrPem),
        shouldIssueCertificate(params)
    ].filter(Boolean).length;
}
