import {canUsePlatformAdmin} from '../../modules/authz/evaluator';
import {zitadelService} from '../../modules/zitadel/ZitadelService';
import type {DescribeOutput} from '../../rpc/describe';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    DOMAIN_POLICY_DESCRIBE,
    DOMAIN_POLICY_GET_INSTANCE_SCHEMA,
    DOMAIN_POLICY_INSTANCE_SET_SCHEMA,
    DOMAIN_POLICY_SCOPE_SCHEMA,
    DOMAIN_POLICY_SET_SCHEMA,
    type DomainPolicyGetInstanceParams,
    type DomainPolicyInstanceSetParams,
    type DomainPolicyScopeParams,
    type DomainPolicySetParams
} from '../../types/api/domain_policy';
import type CommandSender from '../CommandSender';
import {
    canManageOrganizationSettings,
    canReadOrganizationSettings
} from './authzPermissions';
import Component from './Component';

export default class DomainPolicyComponent extends Component {
    constructor() {
        super('domain_policy', {
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
        return DOMAIN_POLICY_DESCRIBE;
    }

    @Component.Expose('GetPolicy')
    @Component.CheckPermissions(canReadOrganizationSettings)
    async getPolicy(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<DomainPolicyScopeParams>(
            params,
            DOMAIN_POLICY_SCOPE_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        return (await zitadelService.getDomainPolicy(orgId)) ?? {};
    }

    @Component.Expose('SetPolicy')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async setPolicy(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<DomainPolicySetParams>(
            params,
            DOMAIN_POLICY_SET_SCHEMA
        );
        const {orgId: claimed, ...policy} = v;
        const orgId = requireOrganizationId(sender, {organizationId: claimed});
        await zitadelService.setDomainPolicy(orgId, policy);
        return {ok: true};
    }

    @Component.Expose('Reset')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async reset(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<DomainPolicyScopeParams>(
            params,
            DOMAIN_POLICY_SCOPE_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.resetDomainPolicy(orgId);
        return {ok: true};
    }

    // GetInstance / SetInstance touch Zitadel instance state — provider support only.
    @Component.Expose('GetInstance')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async getInstance(params: unknown) {
        validateOrThrow<DomainPolicyGetInstanceParams>(
            params,
            DOMAIN_POLICY_GET_INSTANCE_SCHEMA
        );
        return (await zitadelService.getInstanceDomainPolicy()) ?? {};
    }

    @Component.Expose('SetInstance')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async setInstance(params: unknown) {
        const v = validateOrThrow<DomainPolicyInstanceSetParams>(
            params,
            DOMAIN_POLICY_INSTANCE_SET_SCHEMA
        );
        await zitadelService.setInstanceDomainPolicy(v);
        return {ok: true};
    }
}
