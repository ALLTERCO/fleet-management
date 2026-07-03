import {zitadelService} from '../../modules/zitadel/ZitadelService';
import type {DescribeOutput} from '../../rpc/describe';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    NOTIFICATION_POLICY_DESCRIBE,
    NOTIFICATION_POLICY_SCOPE_SCHEMA,
    NOTIFICATION_POLICY_SET_SCHEMA,
    type NotificationPolicyScopeParams,
    type NotificationPolicySetParams
} from '../../types/api/notification_policy';
import type CommandSender from '../CommandSender';
import {
    canManageOrganizationSettings,
    canReadOrganizationSettings
} from './authzPermissions';
import Component from './Component';

export default class NotificationPolicyComponent extends Component {
    constructor() {
        super('notification_policy', {
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
        return NOTIFICATION_POLICY_DESCRIBE;
    }

    @Component.Expose('GetPolicy')
    @Component.CheckPermissions(canReadOrganizationSettings)
    async getPolicy(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<NotificationPolicyScopeParams>(
            params,
            NOTIFICATION_POLICY_SCOPE_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        return (await zitadelService.getNotificationPolicy(orgId)) ?? {};
    }

    @Component.Expose('SetPolicy')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async setPolicy(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<NotificationPolicySetParams>(
            params,
            NOTIFICATION_POLICY_SET_SCHEMA
        );
        const {orgId: claimed, ...policy} = v;
        const orgId = requireOrganizationId(sender, {organizationId: claimed});
        await zitadelService.setNotificationPolicy(orgId, policy);
        return {ok: true};
    }

    @Component.Expose('Reset')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async reset(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<NotificationPolicyScopeParams>(
            params,
            NOTIFICATION_POLICY_SCOPE_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.resetNotificationPolicy(orgId);
        return {ok: true};
    }
}
