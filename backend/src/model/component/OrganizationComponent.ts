import * as log4js from 'log4js';
import * as EventDistributor from '../../modules/EventDistributor';
import {
    buildOrganizationScopeModel,
    getOrganizationProfile,
    readOrganizationProfile,
    rowToOrganizationProfile
} from '../../modules/organizationModel';
import {assertValidProfilePatch} from '../../modules/organizationProfileValidation';
import * as postgres from '../../modules/PostgresProvider';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ORGANIZATION_DESCRIBE,
    ORGANIZATION_GET_DEFAULTS_PARAMS,
    ORGANIZATION_GET_PROFILE_PARAMS,
    ORGANIZATION_GET_SCOPE_MODEL_PARAMS,
    ORGANIZATION_SET_PROFILE_PARAMS,
    type OrganizationDefaults,
    type OrganizationProfile,
    type OrganizationScopeModel
} from '../../types/api/organization';
import type CommandSender from '../CommandSender';
import Component from './Component';

const logger = log4js.getLogger('OrganizationComponent');

export default class OrganizationComponent extends Component {
    constructor() {
        super('organization', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: true
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return ORGANIZATION_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('GetProfile')
    @Component.NoPermissions
    async getProfile(
        params: unknown,
        sender: CommandSender
    ): Promise<OrganizationProfile> {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            ORGANIZATION_GET_PROFILE_PARAMS
        );
        const orgId = requireOrganizationId(sender);
        return await getOrganizationProfile(orgId);
    }

    @Component.Expose('SetProfile')
    @Component.CrudPermission('organizations', 'update')
    async setProfile(
        params: unknown,
        sender: CommandSender
    ): Promise<OrganizationProfile> {
        const p = validateOrThrow<{
            patch: {
                displayName?: string | null;
                timezoneDefault?: string | null;
                localeDefault?: string | null;
                currencyDefault?: string | null;
                unitSystemDefault?: 'metric' | 'imperial' | null;
                metadata?: Record<string, unknown>;
            };
        }>(params, ORGANIZATION_SET_PROFILE_PARAMS);
        const orgId = requireOrganizationId(sender);
        const patch = p.patch ?? {};
        assertValidProfilePatch(patch);
        const clearDisplay = patch.displayName === null;
        const clearTimezone = patch.timezoneDefault === null;
        const clearLocale = patch.localeDefault === null;
        const clearCurrency = patch.currencyDefault === null;
        const clearUnitSystem = patch.unitSystemDefault === null;

        try {
            const result = await postgres.callMethod(
                'organization.fn_profile_update',
                {
                    p_id: orgId,
                    p_display_name: clearDisplay
                        ? null
                        : (patch.displayName ?? null),
                    p_clear_display_name: clearDisplay,
                    p_timezone_default: clearTimezone
                        ? null
                        : (patch.timezoneDefault ?? null),
                    p_clear_timezone: clearTimezone,
                    p_locale_default: clearLocale
                        ? null
                        : (patch.localeDefault ?? null),
                    p_clear_locale: clearLocale,
                    p_currency_default: clearCurrency
                        ? null
                        : (patch.currencyDefault ?? null),
                    p_clear_currency: clearCurrency,
                    p_unit_system_default: clearUnitSystem
                        ? null
                        : (patch.unitSystemDefault ?? null),
                    p_clear_unit_system: clearUnitSystem,
                    p_metadata: patch.metadata ?? null
                }
            );
            const row = result?.rows?.[0] as
                | Parameters<typeof rowToOrganizationProfile>[0]
                | undefined;
            if (!row) throw RpcError.OperationFailed('organization setProfile');
            EventDistributor.emitOrganizationProfileUpdated(orgId);
            return rowToOrganizationProfile(row);
        } catch (err: unknown) {
            if (err instanceof RpcError) throw err;
            logger.error('organization setProfile failed: %s', err);
            throw RpcError.OperationFailed('organization setProfile', err);
        }
    }

    @Component.NoAudit
    @Component.Expose('GetDefaults')
    @Component.NoPermissions
    async getDefaults(
        params: unknown,
        sender: CommandSender
    ): Promise<OrganizationDefaults> {
        validateOrThrow<Record<string, never>>(
            params,
            ORGANIZATION_GET_DEFAULTS_PARAMS
        );
        const orgId = requireOrganizationId(sender);
        const existing = await readOrganizationProfile(orgId);
        return {
            timezoneDefault: existing?.timezoneDefault ?? null,
            localeDefault: existing?.localeDefault ?? null
        };
    }

    @Component.NoAudit
    @Component.Expose('GetScopeModel')
    @Component.NoPermissions
    async getScopeModel(params: unknown): Promise<OrganizationScopeModel> {
        validateOrThrow<Record<string, never>>(
            params,
            ORGANIZATION_GET_SCOPE_MODEL_PARAMS
        );
        return buildOrganizationScopeModel();
    }
}
