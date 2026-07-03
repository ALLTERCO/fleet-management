// Privacy namespace — ToS / privacy / support / help links per org.

import {zitadelService} from '../../modules/zitadel/ZitadelService';
import type {DescribeOutput} from '../../rpc/describe';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    PRIVACY_DESCRIBE,
    PRIVACY_SCOPE_PARAMS_SCHEMA,
    PRIVACY_SET_POLICY_PARAMS_SCHEMA,
    type PrivacyScopeParams,
    type PrivacySetPolicyParams
} from '../../types/api/privacy';
import type CommandSender from '../CommandSender';
import {
    canManageOrganizationSettings,
    canReadOrganizationSettings
} from './authzPermissions';
import Component from './Component';

export default class PrivacyComponent extends Component {
    constructor() {
        super('privacy', {set_config_methods: false, auto_apply_config: false});
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return PRIVACY_DESCRIBE;
    }

    @Component.Expose('GetPolicy')
    @Component.CheckPermissions(canReadOrganizationSettings)
    async getPolicy(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<PrivacyScopeParams>(
            params,
            PRIVACY_SCOPE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        return (await zitadelService.getPrivacyPolicy(orgId)) ?? {};
    }

    @Component.Expose('SetPolicy')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async setPolicy(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<PrivacySetPolicyParams>(
            params,
            PRIVACY_SET_POLICY_PARAMS_SCHEMA
        );
        const {orgId: claimed, ...policy} = v;
        const orgId = requireOrganizationId(sender, {organizationId: claimed});
        await zitadelService.setPrivacyPolicy(orgId, policy);
        return {ok: true};
    }

    @Component.Expose('Reset')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async reset(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<PrivacyScopeParams>(
            params,
            PRIVACY_SCOPE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.resetPrivacyPolicy(orgId);
        return {ok: true};
    }
}
