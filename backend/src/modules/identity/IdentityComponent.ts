// Identity admin RPCs: signing-key rotation, IdP CRUD, SCIM toggle.

import {randomBytes} from 'node:crypto';
import {envStr} from '../../config/envReader';
import Component from '../../model/component/Component';
import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    IDENTITY_ADD_OIDC_IDP_SCHEMA,
    IDENTITY_DELETE_IDP_SCHEMA,
    IDENTITY_DESCRIBE,
    IDENTITY_GET_JWT_INTENT_SCHEMA,
    IDENTITY_GET_SCIM_SCHEMA,
    IDENTITY_GET_SMTP_SETTINGS_SCHEMA,
    IDENTITY_LIST_IDPS_SCHEMA,
    IDENTITY_ROTATE_SCHEMA,
    IDENTITY_SET_SCIM_SCHEMA,
    IDENTITY_SET_SMTP_SETTINGS_SCHEMA,
    IDENTITY_TEST_SMTP_SETTINGS_SCHEMA,
    type IdentityAddOidcIdpParams,
    type IdentityDeleteIdpParams,
    type IdentityGetJwtIntentParams,
    type IdentityGetScimParams,
    type IdentityGetSmtpSettingsParams,
    type IdentityListIdpsParams,
    type IdentityRotateParams,
    type IdentitySetScimParams,
    type IdentitySetSmtpSettingsParams,
    type IdentityTestSmtpSettingsParams
} from '../../types/api/identity';
import {canUsePlatformAdmin} from '../authz/evaluator';
import {zitadelService} from '../zitadel/ZitadelService';
import {
    ZITADEL_TARGET_SUFFIXES,
    ZITADEL_USER_EVENTS
} from '../zitadelActions/eventNames';
import {
    getRotatedAt,
    getScimEnabled,
    rotateKeys,
    setScimEnabled
} from '../zitadelActions/runtimeKeys';

function projectName(): string {
    return envStr('ZITADEL_PROJECT_NAME', 'fleet-management');
}

function gdprTargetName(): string {
    return `${projectName()}${ZITADEL_TARGET_SUFFIXES.userRemoved}`;
}

function grantTargetName(): string {
    return `${projectName()}${ZITADEL_TARGET_SUFFIXES.grantRemoved}`;
}

function gdprWebhookEndpoint(): string {
    return envStr(
        'FM_GDPR_WEBHOOK_ENDPOINT',
        'http://fleet-manager:7011/api/zitadel/actions/user-removed'
    );
}

function grantWebhookEndpoint(): string {
    return envStr(
        'FM_GRANT_WEBHOOK_ENDPOINT',
        'http://fleet-manager:7011/api/zitadel/actions/grant-removed'
    );
}

function actionWebhookTimeout(): string {
    return envStr('FM_ACTION_WEBHOOK_TIMEOUT', '5s');
}

export default class IdentityComponent extends Component {
    constructor() {
        super('identity', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return IDENTITY_DESCRIBE;
    }

    @Component.Expose('RotateActionSigningKeys')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async rotateActionSigningKeys(params: unknown) {
        validateOrThrow<IdentityRotateParams>(params, IDENTITY_ROTATE_SCHEMA);

        const gdprName = gdprTargetName();
        const grantName = grantTargetName();

        // Snapshot existing targets by canonical name; delete all by id post-swap.
        const oldGdprs = await zitadelService.searchAllActionTargets(gdprName);
        const oldGrants =
            await zitadelService.searchAllActionTargets(grantName);

        // Canonical name; Zitadel allows duplicate names during the swap.
        const newGdpr = await zitadelService.createActionTarget({
            name: gdprName,
            endpoint: gdprWebhookEndpoint(),
            timeout: actionWebhookTimeout()
        });
        const newGrant = await zitadelService.createActionTarget({
            name: grantName,
            endpoint: grantWebhookEndpoint(),
            timeout: actionWebhookTimeout()
        });

        // Persist BEFORE rebinding so a failed write leaves the old flow intact.
        const rotatedAt = new Date().toISOString();
        await rotateKeys({
            grantSigningKey: newGrant.signingKey,
            gdprSigningKey: newGdpr.signingKey,
            rotatedAt
        });

        // FM dual-key verifier covers the brief swap window.
        await zitadelService.bindEventExecution(
            ZITADEL_USER_EVENTS.humanRemoved,
            newGdpr.id
        );
        await zitadelService.bindEventExecution(
            ZITADEL_USER_EVENTS.grantRemoved,
            newGrant.id
        );
        await zitadelService.bindEventExecution(
            ZITADEL_USER_EVENTS.grantCascadeRemoved,
            newGrant.id
        );

        // Best-effort cleanup; new bindings already won.
        const stale = [
            ...oldGdprs.filter((t) => t.id !== newGdpr.id),
            ...oldGrants.filter((t) => t.id !== newGrant.id)
        ];
        for (const t of stale) {
            try {
                await zitadelService.deleteActionTarget(t.id);
            } catch {
                // Operator can prune later.
            }
        }

        return {
            gdprTargetId: newGdpr.id,
            grantTargetId: newGrant.id,
            rotatedAt,
            correlationId: randomBytes(8).toString('hex')
        };
    }

    @Component.Expose('ListIdentityProviders')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async listIdentityProviders(params: unknown) {
        validateOrThrow<IdentityListIdpsParams>(
            params,
            IDENTITY_LIST_IDPS_SCHEMA
        );
        return await zitadelService.listIdentityProviders();
    }

    @Component.Expose('AddOidcProvider')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async addOidcIdentityProvider(params: unknown) {
        const v = validateOrThrow<IdentityAddOidcIdpParams>(
            params,
            IDENTITY_ADD_OIDC_IDP_SCHEMA
        );
        await zitadelService.addOidcIdentityProvider(v);
        return {ok: true};
    }

    @Component.Expose('DeleteIdentityProvider')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async deleteIdentityProvider(params: unknown) {
        const v = validateOrThrow<IdentityDeleteIdpParams>(
            params,
            IDENTITY_DELETE_IDP_SCHEMA
        );
        await zitadelService.deleteIdentityProvider(v.id);
        return {ok: true};
    }

    @Component.Expose('GetScimSettings')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async getScimSettings(params: unknown) {
        validateOrThrow<IdentityGetScimParams>(
            params,
            IDENTITY_GET_SCIM_SCHEMA
        );
        const baseUrl = envStr('ZITADEL_PUBLIC_URL', '');
        return {
            enabled: await getScimEnabled(),
            endpoint: baseUrl ? `${baseUrl}/scim/v2/` : '/scim/v2/',
            managementApiHint:
                'Zitadel exposes SCIM v2 at /scim/v2/. Token auth via PAT. See https://zitadel.com/docs/apis/scim2.',
            rotatedAt: await getRotatedAt()
        };
    }

    @Component.Expose('SetScimEnabled')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async setScimEnabled(params: unknown) {
        const v = validateOrThrow<IdentitySetScimParams>(
            params,
            IDENTITY_SET_SCIM_SCHEMA
        );
        await setScimEnabled(v.enabled);
        return {ok: true};
    }

    @Component.Expose('GetJwtIntentSettings')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async getJwtIntentSettings(params: unknown) {
        validateOrThrow<IdentityGetJwtIntentParams>(
            params,
            IDENTITY_GET_JWT_INTENT_SCHEMA
        );
        const baseUrl = envStr('ZITADEL_PUBLIC_URL', '');
        return {
            enabled: true,
            tokenEndpoint: baseUrl
                ? `${baseUrl}/oauth/v2/token`
                : '/oauth/v2/token',
            grantType: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            documentation:
                'Zitadel supports the JWT bearer grant. Service-to-service callers POST a signed JWT to /oauth/v2/token to exchange it for an access token. See https://zitadel.com/docs/guides/integrate/service-users/jwt-idp.'
        };
    }

    @Component.Expose('GetSmtpSettings')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async getSmtpSettings(params: unknown) {
        validateOrThrow<IdentityGetSmtpSettingsParams>(
            params,
            IDENTITY_GET_SMTP_SETTINGS_SCHEMA
        );
        return await zitadelService.getIdentitySmtpSettings();
    }

    @Component.Expose('SetSmtpSettings')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async setSmtpSettings(params: unknown) {
        const v = validateOrThrow<IdentitySetSmtpSettingsParams>(
            params,
            IDENTITY_SET_SMTP_SETTINGS_SCHEMA
        );
        await zitadelService.setIdentitySmtpSettings(v);
        return {ok: true};
    }

    @Component.Expose('TestSmtpSettings')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async testSmtpSettings(params: unknown) {
        const v = validateOrThrow<IdentityTestSmtpSettingsParams>(
            params,
            IDENTITY_TEST_SMTP_SETTINGS_SCHEMA
        );
        await zitadelService.testIdentitySmtpSettings(v);
        return {ok: true};
    }
}
