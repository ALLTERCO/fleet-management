// LoginText namespace — per-language UI strings on every login screen.

import {zitadelService} from '../../modules/zitadel/ZitadelService';
import type {DescribeOutput} from '../../rpc/describe';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    LOGIN_TEXT_DESCRIBE,
    LOGIN_TEXT_GET_DEFAULT_SCHEMA,
    LOGIN_TEXT_SCOPE_SCHEMA,
    LOGIN_TEXT_SET_SCHEMA,
    type LoginTextGetDefaultParams,
    type LoginTextScopeParams,
    type LoginTextSetParams
} from '../../types/api/login_text';
import type CommandSender from '../CommandSender';
import {
    canManageOrganizationSettings,
    canReadOrganizationSettings
} from './authzPermissions';
import Component from './Component';

export default class LoginTextComponent extends Component {
    constructor() {
        super('login_text', {
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
        return LOGIN_TEXT_DESCRIBE;
    }

    @Component.Expose('GetText')
    @Component.CheckPermissions(canReadOrganizationSettings)
    async getText(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<LoginTextScopeParams>(
            params,
            LOGIN_TEXT_SCOPE_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        return (await zitadelService.getLoginText(orgId, v.language)) ?? {};
    }

    @Component.Expose('GetDefault')
    @Component.CheckPermissions(canReadOrganizationSettings)
    async getDefault(params: unknown) {
        const v = validateOrThrow<LoginTextGetDefaultParams>(
            params,
            LOGIN_TEXT_GET_DEFAULT_SCHEMA
        );
        return (await zitadelService.getLoginTextDefault(v.language)) ?? {};
    }

    @Component.Expose('SetText')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async setText(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<LoginTextSetParams>(
            params,
            LOGIN_TEXT_SET_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.setLoginText(orgId, v.language, v.text);
        return {ok: true};
    }

    @Component.Expose('Reset')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async reset(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<LoginTextScopeParams>(
            params,
            LOGIN_TEXT_SCOPE_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.resetLoginText(orgId, v.language);
        return {ok: true};
    }
}
