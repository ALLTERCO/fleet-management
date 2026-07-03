// MessageText namespace — per-language email/SMS templates per Zitadel message type.

import {zitadelService} from '../../modules/zitadel/ZitadelService';
import type {DescribeOutput} from '../../rpc/describe';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    MESSAGE_TEXT_DESCRIBE,
    MESSAGE_TEXT_GET_DEFAULT_SCHEMA,
    MESSAGE_TEXT_SCOPE_SCHEMA,
    MESSAGE_TEXT_SET_SCHEMA,
    type MessageTextGetDefaultParams,
    type MessageTextScopeParams,
    type MessageTextSetParams
} from '../../types/api/message_text';
import type CommandSender from '../CommandSender';
import {
    canManageOrganizationSettings,
    canReadOrganizationSettings
} from './authzPermissions';
import Component from './Component';

export default class MessageTextComponent extends Component {
    constructor() {
        super('message_text', {
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
        return MESSAGE_TEXT_DESCRIBE;
    }

    @Component.Expose('GetText')
    @Component.CheckPermissions(canReadOrganizationSettings)
    async getText(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<MessageTextScopeParams>(
            params,
            MESSAGE_TEXT_SCOPE_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        return (
            (await zitadelService.getMessageText(orgId, v.type, v.language)) ??
            {}
        );
    }

    @Component.Expose('GetDefault')
    @Component.CheckPermissions(canReadOrganizationSettings)
    async getDefault(params: unknown) {
        const v = validateOrThrow<MessageTextGetDefaultParams>(
            params,
            MESSAGE_TEXT_GET_DEFAULT_SCHEMA
        );
        return (
            (await zitadelService.getMessageTextDefault(v.type, v.language)) ??
            {}
        );
    }

    @Component.Expose('SetText')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async setText(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<MessageTextSetParams>(
            params,
            MESSAGE_TEXT_SET_SCHEMA
        );
        const {orgId: claimed, type, language, ...body} = v;
        const orgId = requireOrganizationId(sender, {organizationId: claimed});
        await zitadelService.setMessageText(orgId, type, language, body);
        return {ok: true};
    }

    @Component.Expose('Reset')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async reset(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<MessageTextScopeParams>(
            params,
            MESSAGE_TEXT_SCOPE_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.resetMessageText(orgId, v.type, v.language);
        return {ok: true};
    }
}
