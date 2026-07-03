// Branding namespace — runtime control of the Zitadel label policy + logo.
// All methods are admin-only.

import {zitadelService} from '../../modules/zitadel/ZitadelService';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    BRANDING_DELETE_LOGO_PARAMS_SCHEMA,
    BRANDING_DESCRIBE,
    BRANDING_GET_DEFAULT_PARAMS_SCHEMA,
    BRANDING_GET_POLICY_PARAMS_SCHEMA,
    BRANDING_SET_FONT_PARAMS_SCHEMA,
    BRANDING_SET_ICON_PARAMS_SCHEMA,
    BRANDING_SET_LOGO_PARAMS_SCHEMA,
    BRANDING_SET_MAIL_TEMPLATE_PARAMS_SCHEMA,
    BRANDING_SET_POLICY_PARAMS_SCHEMA,
    type BrandingDeleteLogoParams,
    type BrandingGetDefaultParams,
    type BrandingScopeParams,
    type BrandingSetFontParams,
    type BrandingSetIconParams,
    type BrandingSetLogoParams,
    type BrandingSetMailTemplateParams,
    type BrandingSetPolicyParams
} from '../../types/api/branding';
import type CommandSender from '../CommandSender';
import {
    canManageOrganizationSettings,
    canReadOrganizationSettings
} from './authzPermissions';
import Component from './Component';

export default class BrandingComponent extends Component {
    constructor() {
        super('branding', {
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
        return BRANDING_DESCRIBE;
    }

    @Component.Expose('GetPolicy')
    @Component.CheckPermissions(canReadOrganizationSettings)
    async getPolicy(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingScopeParams>(
            params,
            BRANDING_GET_POLICY_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        const policy = await zitadelService.getLabelPolicy(orgId);
        return policy ?? {};
    }

    @Component.Expose('GetPreview')
    @Component.CheckPermissions(canReadOrganizationSettings)
    async getPreview(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingScopeParams>(
            params,
            BRANDING_GET_POLICY_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        const policy = await zitadelService.getLabelPolicyPreview(orgId);
        return policy ?? {};
    }

    @Component.Expose('GetDefault')
    @Component.CheckPermissions(canReadOrganizationSettings)
    async getDefault(params: unknown) {
        validateOrThrow<BrandingGetDefaultParams>(
            params,
            BRANDING_GET_DEFAULT_PARAMS_SCHEMA
        );
        const policy = await zitadelService.getLabelPolicyDefault();
        return policy ?? {};
    }

    @Component.Expose('SetPolicy')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async setPolicy(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingSetPolicyParams>(
            params,
            BRANDING_SET_POLICY_PARAMS_SCHEMA
        );
        const {orgId: claimed, ...policy} = v;
        const orgId = requireOrganizationId(sender, {organizationId: claimed});
        await zitadelService.setLabelPolicy(orgId, policy);
        return {ok: true};
    }

    @Component.Expose('Activate')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async activate(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingScopeParams>(
            params,
            BRANDING_GET_POLICY_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.activateLabelPolicy(orgId);
        return {ok: true};
    }

    @Component.Expose('Reset')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async reset(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingScopeParams>(
            params,
            BRANDING_GET_POLICY_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.resetLabelPolicy(orgId);
        return {ok: true};
    }

    @Component.Expose('SetLogo')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async setLogo(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingSetLogoParams>(
            params,
            BRANDING_SET_LOGO_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        const buf = decodeBase64OrThrow(v.fileBase64, 'Branding.SetLogo');
        await zitadelService.setLabelLogo(orgId, buf, v.contentType, v.theme);
        return {ok: true};
    }

    @Component.Expose('DeleteLogo')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async deleteLogo(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingDeleteLogoParams>(
            params,
            BRANDING_DELETE_LOGO_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.deleteLabelLogo(orgId, v.theme);
        return {ok: true};
    }

    @Component.Expose('SetIcon')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async setIcon(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingSetIconParams>(
            params,
            BRANDING_SET_ICON_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        const buf = decodeBase64OrThrow(v.fileBase64, 'Branding.SetIcon');
        await zitadelService.setLabelIcon(orgId, buf, v.contentType, v.theme);
        return {ok: true};
    }

    @Component.Expose('DeleteIcon')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async deleteIcon(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingDeleteLogoParams>(
            params,
            BRANDING_DELETE_LOGO_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.deleteLabelIcon(orgId, v.theme);
        return {ok: true};
    }

    @Component.Expose('SetFont')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async setFont(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingSetFontParams>(
            params,
            BRANDING_SET_FONT_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        const buf = decodeBase64OrThrow(v.fileBase64, 'Branding.SetFont');
        await zitadelService.setLabelFont(orgId, buf, v.contentType);
        return {ok: true};
    }

    @Component.Expose('DeleteFont')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async deleteFont(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingScopeParams>(
            params,
            BRANDING_GET_POLICY_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.deleteLabelFont(orgId);
        return {ok: true};
    }

    @Component.Expose('GetMailTemplate')
    @Component.CheckPermissions(canReadOrganizationSettings)
    async getMailTemplate(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingScopeParams>(
            params,
            BRANDING_GET_POLICY_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        const tpl = await zitadelService.getCustomMailTemplate(orgId);
        return tpl ?? {template: '', isDefault: true};
    }

    @Component.Expose('SetMailTemplate')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async setMailTemplate(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingSetMailTemplateParams>(
            params,
            BRANDING_SET_MAIL_TEMPLATE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.setCustomMailTemplate(orgId, v.html);
        return {ok: true};
    }

    @Component.Expose('ResetMailTemplate')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async resetMailTemplate(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BrandingScopeParams>(
            params,
            BRANDING_GET_POLICY_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, {organizationId: v.orgId});
        await zitadelService.resetCustomMailTemplate(orgId);
        return {ok: true};
    }
}

function decodeBase64OrThrow(b64: string, label: string): Buffer {
    let buf: Buffer;
    try {
        buf = Buffer.from(b64, 'base64');
    } catch (err) {
        throw RpcError.InvalidParams(`${label}: bad base64 (${err})`);
    }
    if (buf.length === 0) {
        throw RpcError.InvalidParams(`${label}: empty file`);
    }
    return buf;
}
