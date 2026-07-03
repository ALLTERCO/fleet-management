/**
 * Admin namespace — system introspection + operator tools that don't
 * belong to any domain component:
 *   - Admin.ListCommands — enumerate every registered RPC surface
 *   - Admin.PostgresCall — allowlisted DB function dispatcher (admin)
 *
 * Permissions: `mapLegacyComponentName('admin')` returns null so every
 * method carries an explicit decorator. PostgresCall requires admin;
 * ListCommands is @ReadOnly.
 *
 * Device RPC relay lives on `Device.Call` — Admin.SendRPC was removed.
 */

import {
    canUseAuthenticatedRead,
    canUsePlatformAdmin
} from '../../modules/authz/evaluator';
import * as Commander from '../../modules/Commander';
import * as PostgresProvider from '../../modules/PostgresProvider';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ADMIN_DESCRIBE,
    ADMIN_LIST_COMMANDS_PARAMS_SCHEMA,
    ADMIN_POSTGRES_CALL_PARAMS_SCHEMA,
    type AdminListCommandsParams,
    type AdminPostgresCallParams
} from '../../types/api/admin';
import Component from './Component';

const ALLOWED_POSTGRES_PROVIDER_METHODS = new Set([
    'device.fn_fetch',
    'device.fn_fetch_batch',
    'device.fn_fetch_batch_by_ids',
    'device_em.fn_last_sync',
    'organization.fn_group_get',
    'organization.fn_group_list',
    'organization.fn_group_find_by_member',
    'device_em.fn_report_stats',
    'device_em.fn_report_stats_by_phase',
    'logging.fn_audit_log_query',
    'ui.fn_config_fetch',
    'ui.fn_dashboard_fetch_v2',
    'ui.fn_dashboard_item_action_fetch',
    'ui.fn_dashboard_item_count',
    'ui.fn_dashboard_settings_fetch',
    'ui.fn_menuitem_fetch'
]);

export default class AdminComponent extends Component {
    constructor() {
        super('admin', {set_config_methods: false, auto_apply_config: false});
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return ADMIN_DESCRIBE;
    }

    @Component.Expose('ListCommands')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    listCommands(params: unknown) {
        validateOrThrow<AdminListCommandsParams>(
            params,
            ADMIN_LIST_COMMANDS_PARAMS_SCHEMA
        );
        const commands = Commander.listCommands();
        const arr = Array.isArray(commands) ? commands : [];
        return buildListResponse(arr, arr.length, 0, 0);
    }

    // provider support-only: allowlisted DB functions accept arbitrary args
    // (organizationId, device ids, audit filters) and most of them do
    // not defend against null/cross-org args themselves. Tenant admins
    // must reach this data through typed RPCs that route through
    // requireOrganizationId / per-device scope checks.
    @Component.Expose('PostgresCall')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async postgresCall(params: unknown) {
        const v = validateOrThrow<AdminPostgresCallParams>(
            params,
            ADMIN_POSTGRES_CALL_PARAMS_SCHEMA
        );
        if (!ALLOWED_POSTGRES_PROVIDER_METHODS.has(v.name)) {
            throw RpcError.InvalidRequest(
                `PostgresCall: "${v.name}" is not allowlisted`
            );
        }

        try {
            const raw = await PostgresProvider.callMethod(
                v.name,
                v.args ?? {},
                v.txId
            );
            const rows = Array.isArray(raw?.rows) ? raw.rows : raw;
            const safeRows = JSON.parse(JSON.stringify(rows));

            return {rows: safeRows};
        } catch (err: unknown) {
            throw RpcError.OperationFailed(`PostgresCall "${v.name}"`, err);
        }
    }
}
