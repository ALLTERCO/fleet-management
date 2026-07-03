/** Dashboard namespace — UI-composition layer. Create + item-layout CRUD. */

import * as log4js from 'log4js';
import {tuning} from '../../config';
import {dashboardDefaults} from '../../config/dashboardDefaults';
import * as DashboardActivityStore from '../../modules/DashboardActivityStore';
import * as DashboardRegistry from '../../modules/DashboardRegistry';
import {createDashboardScoped} from '../../modules/DashboardRegistry';
import {
    fromFmJson,
    fromGrafana,
    toGrafana
} from '../../modules/dashboardGrafanaCodec';
import * as EventDistributor from '../../modules/EventDistributor';
import * as PostgresProvider from '../../modules/PostgresProvider';
import {translatePgError} from '../../rpc/dbErrors';
import type {DescribeOutput} from '../../rpc/describe';
import {toIso} from '../../rpc/pgRows';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    DASHBOARD_ACTIVITY_LIST_PARAMS_SCHEMA,
    DASHBOARD_ADD_ITEM_PARAMS_SCHEMA,
    DASHBOARD_CLEAR_DEFAULT_PARAMS_SCHEMA,
    DASHBOARD_CLONE_PARAMS_SCHEMA,
    DASHBOARD_CREATE_PARAMS_SCHEMA,
    DASHBOARD_DELETE_BULK_PARAMS_SCHEMA,
    DASHBOARD_DELETE_PARAMS_SCHEMA,
    DASHBOARD_DESCRIBE,
    DASHBOARD_EXPORT_PARAMS_SCHEMA,
    DASHBOARD_GET_DEFAULT_PARAMS_SCHEMA,
    DASHBOARD_GET_PARAMS_SCHEMA,
    DASHBOARD_GET_SETTINGS_PARAMS_SCHEMA,
    DASHBOARD_GET_UI_CONFIG_PARAMS_SCHEMA,
    DASHBOARD_IMPORT_PARAMS_SCHEMA,
    DASHBOARD_ITEM_ADD_BULK_PARAMS_SCHEMA,
    DASHBOARD_ITEM_ADD_PARAMS_SCHEMA,
    DASHBOARD_ITEM_LIST_PARAMS_SCHEMA,
    DASHBOARD_ITEM_REMOVE_PARAMS_SCHEMA,
    DASHBOARD_ITEM_REORDER_PARAMS_SCHEMA,
    DASHBOARD_ITEM_SET_ALL_PARAMS_SCHEMA,
    DASHBOARD_ITEM_UPDATE_PARAMS_SCHEMA,
    DASHBOARD_LIST_PARAMS_SCHEMA,
    DASHBOARD_LIST_PINNED_PARAMS_SCHEMA,
    DASHBOARD_PIN_PARAMS_SCHEMA,
    DASHBOARD_REMOVE_ITEM_PARAMS_SCHEMA,
    DASHBOARD_REORDER_ITEMS_PARAMS_SCHEMA,
    DASHBOARD_REORDER_PARAMS_SCHEMA,
    DASHBOARD_REORDER_PINS_PARAMS_SCHEMA,
    DASHBOARD_SET_DEFAULT_PARAMS_SCHEMA,
    DASHBOARD_SET_SETTINGS_PARAMS_SCHEMA,
    DASHBOARD_TEMPLATE_CREATE_PARAMS_SCHEMA,
    DASHBOARD_TEMPLATE_DELETE_PARAMS_SCHEMA,
    DASHBOARD_TEMPLATE_GET_PARAMS_SCHEMA,
    DASHBOARD_TEMPLATE_LIST_PARAMS_SCHEMA,
    DASHBOARD_TEMPLATE_PREVIEW_PARAMS_SCHEMA,
    DASHBOARD_TEMPLATE_SAVE_FROM_DASHBOARD_PARAMS_SCHEMA,
    DASHBOARD_TEMPLATE_UPDATE_PARAMS_SCHEMA,
    DASHBOARD_UNPIN_PARAMS_SCHEMA,
    DASHBOARD_UPDATE_ITEM_SIZE_PARAMS_SCHEMA,
    DASHBOARD_UPDATE_PARAMS_SCHEMA,
    type Dashboard,
    type DashboardType,
    type PvMeterRef,
    type TariffMode,
    type TariffWindow
} from '../../types/api/dashboard';
import type CommandSender from '../CommandSender';
import {resolveCanonicalOrder} from '../dashboard/canonicalOrder';
import {
    rowToDashboard,
    rowToDashboardItem,
    rowToDashboardTemplate
} from '../dashboard/rowTransform';
import {stripIgnoredTariffFields} from '../dashboard/tariffStripping';
import {validateTariffSettings} from '../dashboard/tariffValidation';
import {pvRefsOverlap, pvRefsSelfOverlap} from '../report/pvEnergy';
import Component from './Component';

function _isAddItem(params: any) {
    return (
        params &&
        typeof params === 'object' &&
        typeof params.dashboard === 'number' &&
        typeof params.type === 'number' &&
        typeof params.item === 'number' &&
        (params.order === undefined || typeof params.order === 'number') &&
        (params.sub_item === undefined ||
            typeof params.sub_item === 'string' ||
            params.sub_item === null)
    );
}

function _isRemoveWidget(params: any) {
    return (
        params &&
        typeof params === 'object' &&
        typeof params.dashboard === 'number' &&
        typeof params.itemId === 'number'
    );
}

function _isReorderItems(params: any) {
    return (
        params &&
        typeof params === 'object' &&
        typeof params.dashboard === 'number' &&
        Array.isArray(params.itemIds) &&
        params.itemIds.length > 0 &&
        params.itemIds.length <= 500 &&
        params.itemIds.every((id: any) => typeof id === 'number') &&
        new Set(params.itemIds).size === params.itemIds.length
    );
}

// Pulls numeric ids for one ref kind out of a batch, dedup + skip nulls.
function collectRefIds<
    K extends 'deviceId' | 'groupId' | 'locationId' | 'tagId' | 'actionId'
>(items: ReadonlyArray<{[P in K]?: number | null}>, key: K): readonly number[] {
    const seen = new Set<number>();
    for (const item of items) {
        const id = item[key];
        if (typeof id === 'number') seen.add(id);
    }
    return [...seen];
}

// A meter cannot be both grid and generation — that would double-count it.
// Whole-device and per-channel refs for the same device overlap too.
function assertPvRefsDisjoint(
    gridRefs?: PvMeterRef[] | null,
    generationRefs?: PvMeterRef[] | null
): void {
    assertPvRefsNoSelfOverlap(gridRefs, 'grid');
    assertPvRefsNoSelfOverlap(generationRefs, 'generation');
    if (!gridRefs?.length || !generationRefs?.length) return;
    const clash = pvRefsOverlap(gridRefs, generationRefs);
    if (clash) {
        throw RpcError.Domain('ValidationFailed', {
            message: `PV meter ${clash.device} cannot be both grid and generation`
        });
    }
}

// A whole-device ref and a channel ref of the same device (or an exact dup)
// within one role array would count that energy twice. Reject it — the client
// is trusted here and the modal dedups, but a raw RPC caller is not.
function assertPvRefsNoSelfOverlap(
    refs: PvMeterRef[] | null | undefined,
    role: string
): void {
    if (!refs?.length) return;
    const dup = pvRefsSelfOverlap(refs);
    if (dup) {
        throw RpcError.Domain('ValidationFailed', {
            message: `PV ${role} meter ${dup.device} is listed more than once`
        });
    }
}

const ORG_SCOPED_TABLES = {
    'device.list': 'device.list',
    'organization.groups': 'organization.groups',
    'organization.locations': 'organization.locations',
    'organization.tags': 'organization.tags',
    'ui.dashboard_item_action': 'ui.dashboard_item_action'
} as const;

type OrgScopedTable = keyof typeof ORG_SCOPED_TABLES;

export default class DashboardComponent extends Component {
    constructor() {
        super('dashboard', {
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
        return DASHBOARD_DESCRIBE;
    }

    // Idempotent org bootstrap via fn_profile_ensure (single SoT).
    async #ensureBootstrapped(orgId: string): Promise<void> {
        await PostgresProvider.callMethod('organization.fn_profile_ensure', {
            p_id: orgId,
            p_default_dashboard_name: tuning.dashboard.dashboardName,
            p_default_dashboard_type: tuning.dashboard.dashboardType
        });
    }

    // Cross-org guard. CRUD permissions don't check org, so ALL-scope
    // dashboard 'update' would otherwise leak across tenants.
    async #assertOwnedBySenderOrg(
        dashboardId: number,
        sender: CommandSender
    ): Promise<void> {
        const orgId = requireOrganizationId(sender);
        const owns = await DashboardRegistry.dashboardBelongsToOrg(
            dashboardId,
            orgId
        );
        if (!owns) {
            throw RpcError.NotFound('dashboard', String(dashboardId));
        }
    }

    async #assertDashboardItemRefsBelongToOrg(
        orgId: string,
        item: {
            deviceId?: number | null;
            groupId?: number | null;
            locationId?: number | null;
            tagId?: number | null;
            actionId?: number | null;
        }
    ): Promise<void> {
        await this.#assertDashboardItemRefsBatchBelongToOrg(orgId, [item]);
    }

    // Batched org-membership check for any number of items. At most one
    // query per ref-kind (devices / groups / locations / tags / actions)
    // regardless of item count. Throws RpcError.NotFound on first missing
    // ref so the error shape matches the per-item path.
    async #assertDashboardItemRefsBatchBelongToOrg(
        orgId: string,
        items: ReadonlyArray<{
            deviceId?: number | null;
            groupId?: number | null;
            locationId?: number | null;
            tagId?: number | null;
            actionId?: number | null;
        }>
    ): Promise<void> {
        const deviceIds = collectRefIds(items, 'deviceId');
        const groupIds = collectRefIds(items, 'groupId');
        const locationIds = collectRefIds(items, 'locationId');
        const tagIds = collectRefIds(items, 'tagId');
        const actionIds = collectRefIds(items, 'actionId');

        await Promise.all([
            this.#assertOrgRowsBatch('device.list', deviceIds, orgId, 'device'),
            this.#assertOrgRowsBatch(
                'organization.groups',
                groupIds,
                orgId,
                'organization.groups'
            ),
            this.#assertOrgRowsBatch(
                'organization.locations',
                locationIds,
                orgId,
                'organization.locations'
            ),
            this.#assertOrgRowsBatch(
                'organization.tags',
                tagIds,
                orgId,
                'organization.tags'
            ),
            this.#assertOrgRowsBatch(
                'ui.dashboard_item_action',
                actionIds,
                orgId,
                'ui.dashboard_item_action'
            )
        ]);
    }

    async #assertOrgRowsBatch(
        table: OrgScopedTable,
        ids: readonly number[],
        orgId: string,
        notFoundKind: string
    ): Promise<void> {
        if (ids.length === 0) return;
        const tableName = ORG_SCOPED_TABLES[table];
        const rows = await PostgresProvider.queryRows<{id: number}>(
            `SELECT id FROM ${tableName}
              WHERE organization_id = $1 AND id = ANY($2::bigint[])`,
            [orgId, [...ids]]
        );
        const found = new Set(rows.map((r) => r.id));
        for (const id of ids) {
            if (!found.has(id)) throw RpcError.NotFound(notFoundKind);
        }
    }

    // Org-scoped list. Device is the SoT for device data; the org's own
    // ui.dashboard rows are the SoT for what the user may view.
    @Component.NoAudit
    @Component.Expose('List')
    @Component.CrudPermission('dashboards', 'read')
    async list(
        params: unknown,
        sender: CommandSender
    ): Promise<{items: Dashboard[]; total: number}> {
        const p = validateOrThrow<{organizationId?: string}>(
            params,
            DASHBOARD_LIST_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, p);
        await this.#ensureBootstrapped(orgId);
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_fetch_v2',
            {
                p_organization_id: orgId,
                p_user_id: sender.getUser()?.username ?? null
            }
        );
        const items = (res?.rows ?? []).map(rowToDashboard);
        return {items, total: items.length};
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CrudPermission('dashboards', 'read', (p) => p?.id)
    async get(params: unknown, sender: CommandSender): Promise<Dashboard> {
        const p = validateOrThrow<{id: number}>(
            params,
            DASHBOARD_GET_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        await this.#ensureBootstrapped(orgId);
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_fetch_v2',
            {
                p_organization_id: orgId,
                p_user_id: sender.getUser()?.username ?? null
            }
        );
        const row = (res?.rows ?? []).find((r: any) => r.id === p.id);
        if (!row) throw RpcError.NotFound('dashboard', String(p.id));
        return rowToDashboard(row);
    }

    @Component.NoAudit
    @Component.Expose('GetSettings')
    @Component.CrudPermission(
        'dashboards',
        'read',
        (params) => params?.dashboardId
    )
    async getSettings(rawParams: unknown, sender: CommandSender) {
        const {dashboardId} = validateOrThrow<{dashboardId: number}>(
            rawParams,
            DASHBOARD_GET_SETTINGS_PARAMS_SCHEMA
        );
        await this.#assertOwnedBySenderOrg(dashboardId, sender);

        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_settings_fetch',
            {p_dashboard_id: dashboardId}
        );

        const settings = res?.rows?.[0];
        if (!settings) {
            return DASHBOARD_SETTINGS_DEFAULTS(dashboardId);
        }

        return {
            dashboardId,
            tariff: settings.tariff,
            currency: settings.currency,
            defaultRange: settings.default_range,
            refreshInterval: settings.refresh_interval,
            enabledMetrics: settings.enabled_metrics,
            chartSettings: settings.chart_settings,
            tariffMode: settings.tariff_mode ?? 'single',
            dayRate:
                settings.day_rate !== null ? Number(settings.day_rate) : null,
            nightRate:
                settings.night_rate !== null
                    ? Number(settings.night_rate)
                    : null,
            dayStart: settings.day_start ?? '07:00:00',
            dayEnd: settings.day_end ?? '23:00:00',
            tariffId: settings.tariff_id ?? null,
            peakDeviceIds: settings.peak_device_ids ?? null,
            pvMode: settings.pv_mode ?? null,
            pvGridRefs: settings.pv_grid_refs ?? null,
            pvGenerationRefs: settings.pv_generation_refs ?? null
        };
    }

    @Component.Expose('SetSettings')
    @Component.CrudPermission(
        'dashboards',
        'update',
        (params) => params?.dashboardId
    )
    async setSettings(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<{
            dashboardId: number;
            tariff?: number;
            currency?: string;
            defaultRange?: string;
            refreshInterval?: number;
            enabledMetrics?: string[];
            chartSettings?: Record<string, unknown>;
            tariffMode?: TariffMode;
            dayRate?: number | null;
            nightRate?: number | null;
            dayStart?: string;
            dayEnd?: string;
            tariffTimezone?: string | null;
            tariffWindows?: TariffWindow[] | null;
            tariffWeekendOverride?: TariffWindow[] | null;
            tariffHolidays?: string[] | null;
            emissionFactorGPerKWh?: number | null;
            emissionFactorMbmGPerKWh?: number | null;
            co2BudgetKg?: number | null;
            tariffId?: number | null;
            peakDeviceIds?: string[] | null;
            pvMode?: 'parallel' | 'backup' | 'balcony' | null;
            pvGridRefs?: PvMeterRef[] | null;
            pvGenerationRefs?: PvMeterRef[] | null;
        }>(rawParams, DASHBOARD_SET_SETTINGS_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(params.dashboardId, sender);
        const orgId = requireOrganizationId(sender);

        this.#assertTariffSettings(params);
        const stripped = stripIgnoredTariffFields({
            tariffMode: params.tariffMode ?? 'single',
            tariffWindows: params.tariffWindows,
            tariffWeekendOverride: params.tariffWeekendOverride,
            tariffHolidays: params.tariffHolidays
        });

        await PostgresProvider.callMethod('ui.fn_dashboard_settings_update', {
            p_dashboard_id: params.dashboardId,
            p_tariff: params.tariff ?? null,
            p_currency: params.currency ?? null,
            p_default_range: params.defaultRange ?? null,
            p_refresh_interval: params.refreshInterval ?? null,
            p_enabled_metrics: params.enabledMetrics
                ? JSON.stringify(params.enabledMetrics)
                : null,
            p_chart_settings: params.chartSettings
                ? JSON.stringify(params.chartSettings)
                : null,
            p_tariff_mode: params.tariffMode ?? null,
            p_day_rate: params.dayRate ?? null,
            p_night_rate: params.nightRate ?? null,
            p_day_start: params.dayStart ?? null,
            p_day_end: params.dayEnd ?? null,
            p_tariff_timezone: params.tariffTimezone ?? null,
            p_tariff_windows: stripped.tariffWindows
                ? JSON.stringify(stripped.tariffWindows)
                : null,
            p_tariff_weekend_override: stripped.tariffWeekendOverride
                ? JSON.stringify(stripped.tariffWeekendOverride)
                : null,
            p_tariff_holidays: stripped.tariffHolidays
                ? JSON.stringify(stripped.tariffHolidays)
                : null,
            p_emission_factor_g_per_kwh: params.emissionFactorGPerKWh ?? null,
            p_emission_factor_mbm_g_per_kwh:
                params.emissionFactorMbmGPerKWh ?? null,
            p_co2_budget_kg: params.co2BudgetKg ?? null
        });

        if (params.tariffId !== undefined) {
            await PostgresProvider.callMethod(
                'ui.fn_dashboard_settings_set_tariff_id',
                {
                    p_dashboard_id: params.dashboardId,
                    p_tariff_id: params.tariffId ?? null
                }
            );
        }

        if (params.peakDeviceIds !== undefined) {
            await PostgresProvider.callMethod(
                'ui.fn_dashboard_settings_set_peak_devices',
                {
                    p_dashboard_id: params.dashboardId,
                    p_peak_device_ids: params.peakDeviceIds
                        ? JSON.stringify(params.peakDeviceIds)
                        : null
                }
            );
        }

        if (params.pvMode !== undefined) {
            // Refs are logical-meter roles now. A mode-only write (refs omitted)
            // must not clobber the legacy fallback refs.
            const refsProvided =
                params.pvGridRefs !== undefined ||
                params.pvGenerationRefs !== undefined;
            if (refsProvided) {
                assertPvRefsDisjoint(
                    params.pvGridRefs,
                    params.pvGenerationRefs
                );
                await PostgresProvider.callMethod(
                    'ui.fn_dashboard_settings_set_pv',
                    {
                        p_dashboard_id: params.dashboardId,
                        p_pv_mode: params.pvMode ?? null,
                        p_pv_grid_refs: params.pvGridRefs
                            ? JSON.stringify(params.pvGridRefs)
                            : null,
                        p_pv_generation_refs: params.pvGenerationRefs
                            ? JSON.stringify(params.pvGenerationRefs)
                            : null
                    }
                );
            } else {
                await PostgresProvider.callMethod(
                    'ui.fn_dashboard_settings_set_pv_mode',
                    {
                        p_dashboard_id: params.dashboardId,
                        p_pv_mode: params.pvMode ?? null
                    }
                );
            }
        }

        EventDistributor.emitDashboardSettingsChanged(
            params.dashboardId,
            orgId
        );
        return {success: true, dashboardId: params.dashboardId};
    }

    #assertTariffSettings(params: {
        tariffMode?: TariffMode;
        tariffTimezone?: string | null;
        tariffWindows?: TariffWindow[] | null;
        tariffWeekendOverride?: TariffWindow[] | null;
    }): void {
        const failure = validateTariffSettings({
            tariffMode: params.tariffMode ?? 'single',
            tariffTimezone: params.tariffTimezone ?? null,
            tariffWindows: params.tariffWindows ?? null,
            tariffWeekendOverride: params.tariffWeekendOverride ?? null
        });
        if (!failure) return;
        const message = failure.field
            ? `${failure.error} at ${failure.field}`
            : failure.error;
        throw RpcError.InvalidParams(message);
    }

    @Component.Expose('Create')
    @Component.CrudPermission('dashboards', 'create')
    async create(params: unknown, sender: CommandSender): Promise<Dashboard> {
        const p = validateOrThrow<{
            organizationId?: string;
            name: string;
            dashboardType: DashboardType;
            scope?: {
                locationId?: number;
                groupId?: number;
                tagId?: number;
            };
        }>(params, DASHBOARD_CREATE_PARAMS_SCHEMA);
        const orgId = requireOrganizationId(sender, p);
        const scope = p.scope ?? {};

        try {
            const row = await createDashboardScoped({
                organizationId: orgId,
                name: p.name.trim(),
                dashboardType: p.dashboardType,
                locationId: scope.locationId,
                groupId: scope.groupId,
                tagId: scope.tagId
            });
            EventDistributor.emitDashboardCreated(row.id, row.name, orgId);
            await this.#recordActivity({
                dashboardId: row.id,
                organizationId: orgId,
                actorUserId: sender.getUser()?.username ?? null,
                eventKind: 'created',
                detail: {name: row.name}
            });
            // Freshly-created dashboards have no items.
            return rowToDashboard({...row, items: []});
        } catch (err: unknown) {
            throw translatePgError(err, 'dashboard create');
        }
    }

    @Component.Expose('Update')
    @Component.CrudPermission('dashboards', 'update', (p) => p?.id)
    async update(params: unknown, sender: CommandSender): Promise<Dashboard> {
        const p = validateOrThrow<{
            id: number;
            name?: string;
            dashboardType?: DashboardType;
            scope?: {
                locationId?: number;
                groupId?: number;
                tagId?: number;
            } | null;
        }>(params, DASHBOARD_UPDATE_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(p.id, sender);
        const orgId = requireOrganizationId(sender);
        const scope = p.scope ?? undefined;
        const clear = p.scope === null;
        try {
            await PostgresProvider.callMethod('ui.fn_dashboard_update', {
                p_id: p.id,
                p_organization_id: orgId,
                p_name: p.name ?? null,
                p_dashboard_type: p.dashboardType ?? null,
                p_location_id: clear ? null : (scope?.locationId ?? null),
                p_group_id: clear ? null : (scope?.groupId ?? null),
                p_tag_id: clear ? null : (scope?.tagId ?? null),
                p_clear_scope: clear
            });
        } catch (err: unknown) {
            throw translatePgError(err, 'dashboard update');
        }
        const fresh = await this.#fetchOne(p.id, sender);
        EventDistributor.emitDashboardUpdated(fresh.id, fresh.name, orgId);
        await this.#recordActivity({
            dashboardId: fresh.id,
            organizationId: orgId,
            actorUserId: sender.getUser()?.username ?? null,
            eventKind: 'updated',
            detail: {name: fresh.name}
        });
        return fresh;
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('dashboards', 'delete', (p) => p?.id)
    async delete(
        params: unknown,
        sender: CommandSender
    ): Promise<{deleted: number}> {
        const p = validateOrThrow<{id: number}>(
            params,
            DASHBOARD_DELETE_PARAMS_SCHEMA
        );
        await this.#assertOwnedBySenderOrg(p.id, sender);
        const orgId = requireOrganizationId(sender);
        await PostgresProvider.callMethod('ui.fn_dashboard_remove', {
            p_id: p.id
        });
        EventDistributor.emitDashboardDeleted(p.id, orgId);
        return {deleted: p.id};
    }

    // Bulk delete in ONE round-trip. The per-dashboard client loop was N
    // sequential Delete RPCs, each with its own ownership probe + unindexed
    // item scan. Here a single org-scoped DB call removes every owned id and
    // returns which ones it deleted; cross-org ids are ignored, not errored.
    @Component.Expose('DeleteBulk')
    @Component.CrudPermission('dashboards', 'delete')
    async deleteBulk(
        params: unknown,
        sender: CommandSender
    ): Promise<{deleted: number[]}> {
        const p = validateOrThrow<{ids: number[]}>(
            params,
            DASHBOARD_DELETE_BULK_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_remove_bulk',
            {p_ids: p.ids, p_organization_id: orgId}
        );
        const deleted: number[] = (res?.rows ?? []).map(
            (r: {deleted_id: number}) => r.deleted_id
        );
        for (const id of deleted) {
            EventDistributor.emitDashboardDeleted(id, orgId);
        }
        return {deleted};
    }

    async #fetchDashboardRow(
        id: number,
        sender: CommandSender
    ): Promise<Record<string, unknown> | undefined> {
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_fetch_v2',
            {
                p_organization_id: requireOrganizationId(sender),
                p_user_id: sender.getUser()?.username ?? null
            }
        );
        return (res?.rows ?? []).find((r: any) => r.id === id);
    }

    async #fetchOne(id: number, sender: CommandSender): Promise<Dashboard> {
        const row = await this.#fetchDashboardRow(id, sender);
        if (!row) throw RpcError.NotFound('dashboard', String(id));
        return rowToDashboard(row);
    }

    @Component.Expose('AddItem')
    @Component.CrudPermission(
        'dashboards',
        'update',
        (params) => params?.dashboard
    )
    async addItem(rawParams: unknown, sender: CommandSender) {
        const {
            dashboard,
            type,
            item,
            order = 0,
            sub_item = null,
            size = '1x1'
        } = validateOrThrow<{
            dashboard: number;
            type: number;
            item: number;
            order?: number;
            sub_item?: string | null;
            size?: string;
        }>(rawParams, DASHBOARD_ADD_ITEM_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(dashboard, sender);
        const orgId = requireOrganizationId(sender);
        const newId = await DashboardRegistry.addDashboardItem(
            dashboard,
            type,
            item,
            order,
            sub_item,
            size
        );
        EventDistributor.emitDashboardItemsChanged(dashboard, orgId);
        return {id: newId};
    }

    @Component.Expose('UpdateItemSize')
    @Component.CrudPermission(
        'dashboards',
        'update',
        (params) => params?.dashboard
    )
    async updateItemSize(rawParams: unknown, sender: CommandSender) {
        const {dashboard, itemId, size} = validateOrThrow<{
            dashboard: number;
            itemId: number;
            size: string;
        }>(rawParams, DASHBOARD_UPDATE_ITEM_SIZE_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(dashboard, sender);
        const orgId = requireOrganizationId(sender);
        await DashboardRegistry.updateDashboardItemSize(
            dashboard,
            itemId,
            size
        );
        EventDistributor.emitDashboardItemsChanged(dashboard, orgId);
        return {updated: itemId, size};
    }

    @Component.Expose('RemoveItem')
    @Component.CrudPermission(
        'dashboards',
        'update',
        (params) => params?.dashboard
    )
    async removeItem(rawParams: unknown, sender: CommandSender) {
        const {dashboard, itemId} = validateOrThrow<{
            dashboard: number;
            itemId: number;
        }>(rawParams, DASHBOARD_REMOVE_ITEM_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(dashboard, sender);
        const orgId = requireOrganizationId(sender);
        await DashboardRegistry.removeDashboardWidget(dashboard, itemId);
        EventDistributor.emitDashboardItemsChanged(dashboard, orgId);
        return {removed: itemId};
    }

    @Component.Expose('ReorderItems')
    @Component.CrudPermission(
        'dashboards',
        'update',
        (params) => params?.dashboard
    )
    async reorderItems(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<{
            dashboard: number;
            itemIds: number[];
        }>(rawParams, DASHBOARD_REORDER_ITEMS_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(params.dashboard, sender);
        const orgId = requireOrganizationId(sender);
        await DashboardRegistry.reorderDashboardItems(
            params.dashboard,
            params.itemIds
        );
        EventDistributor.emitDashboardItemsChanged(params.dashboard, orgId);
        return {reordered: params.itemIds.length};
    }

    @Component.Expose('Reorder')
    @Component.CrudPermission('dashboards', 'update')
    async reorder(rawParams: unknown, sender: CommandSender) {
        const {ids} = validateOrThrow<{ids: number[]}>(
            rawParams,
            DASHBOARD_REORDER_PARAMS_SCHEMA
        );
        const userId = sender.getUser()?.username;
        if (!userId) throw RpcError.Unauthorized();
        const orgId = requireOrganizationId(sender);
        const canonicalIds = await this.#resolveCanonicalOrder(orgId, ids);
        await PostgresProvider.callMethod('ui.fn_dashboard_reorder', {
            p_user_id: userId,
            p_ids: canonicalIds
        });
        EventDistributor.emitDashboardOrderChanged(userId, orgId, canonicalIds);
        return {ok: true, ids: canonicalIds};
    }

    async #resolveCanonicalOrder(
        orgId: string,
        callerIds: number[]
    ): Promise<number[]> {
        await this.#ensureBootstrapped(orgId);
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_fetch_v2',
            {p_organization_id: orgId, p_user_id: null}
        );
        const visibleIds = (res?.rows ?? []).map((r: {id: number}) => r.id);
        return resolveCanonicalOrder(visibleIds, callerIds);
    }

    @Component.Expose('GetUIConfig')
    @Component.NoPermissions
    async getUIConfig(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            DASHBOARD_GET_UI_CONFIG_PARAMS_SCHEMA
        );
        return await DashboardRegistry.getUIConfig();
    }

    // ==== Phase 2: Item.* sub-namespace + new structured types ========

    @Component.NoAudit
    @Component.Expose('Item.List')
    @Component.CrudPermission('dashboards', 'read', (p) => p?.dashboardId)
    async itemList(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{dashboardId: number}>(
            params,
            DASHBOARD_ITEM_LIST_PARAMS_SCHEMA
        );
        await this.#assertOwnedBySenderOrg(p.dashboardId, sender);
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_fetch_v2',
            {
                p_organization_id: requireOrganizationId(sender),
                p_user_id: sender.getUser()?.username ?? null
            }
        );
        const row = (res?.rows ?? []).find((r: any) => r.id === p.dashboardId);
        if (!row) throw RpcError.Domain('DashboardNotFound');
        const items = Array.isArray(row.items) ? row.items : [];
        return {items: items.map(rowToDashboardItem)};
    }

    @Component.Expose('Item.Add')
    @Component.CrudPermission('dashboards', 'update', (p) => p?.dashboardId)
    async itemAdd(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            dashboardId: number;
            kind: string;
            deviceId?: number | null;
            entitySubId?: string | null;
            groupId?: number | null;
            locationId?: number | null;
            tagId?: number | null;
            actionId?: number | null;
            widgetKind?: string | null;
            widgetConfig?: Record<string, unknown> | null;
            order?: number;
            size?: string;
            mobileLayout?: object | null;
        }>(params, DASHBOARD_ITEM_ADD_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(p.dashboardId, sender);
        const orgId = requireOrganizationId(sender);
        await this.#assertDashboardItemRefsBelongToOrg(orgId, p);
        // Budget enforced atomically inside the SQL function; pass the cap
        // via tuning so it stays env-driven.
        await PostgresProvider.callMethod('ui.fn_dashboard_item_add_v3', {
            p_dashboard: p.dashboardId,
            p_kind: p.kind,
            p_device_id: p.deviceId ?? null,
            p_entity_sub_id: p.entitySubId ?? null,
            p_group_id: p.groupId ?? null,
            p_location_id: p.locationId ?? null,
            p_tag_id: p.tagId ?? null,
            p_action_id: p.actionId ?? null,
            p_widget_kind: p.widgetKind ?? null,
            p_widget_config: p.widgetConfig ?? null,
            p_order: p.order ?? 0,
            p_size: p.size ?? '1x1',
            p_mobile_layout: p.mobileLayout ?? null,
            p_max_items: tuning.dashboard.maxItems
        });
        EventDistributor.emitDashboardItemsChanged(p.dashboardId, orgId);
        return await this.#fetchDashboard(p.dashboardId, sender);
    }

    @Component.Expose('Item.AddBulk')
    @Component.CrudPermission('dashboards', 'update', (p) => p?.dashboardId)
    async itemAddBulk(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            dashboardId: number;
            items: Array<{
                kind: string;
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order?: number;
                size?: string;
                mobileLayout?: object | null;
            }>;
        }>(params, DASHBOARD_ITEM_ADD_BULK_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(p.dashboardId, sender);
        const orgId = requireOrganizationId(sender);
        await this.#assertDashboardItemRefsBatchBelongToOrg(orgId, p.items);
        // Budget enforced atomically inside the SQL function.
        await PostgresProvider.callMethod('ui.fn_dashboard_item_add_bulk', {
            p_dashboard: p.dashboardId,
            p_items: JSON.stringify(p.items),
            p_max_items: tuning.dashboard.maxItems
        });
        EventDistributor.emitDashboardItemsChanged(p.dashboardId, orgId);
        return await this.#fetchDashboard(p.dashboardId, sender);
    }

    @Component.Expose('Item.Update')
    @Component.CrudPermission('dashboards', 'update', (p) => p?.dashboardId)
    async itemUpdate(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            dashboardId: number;
            itemId: number;
            size?: string;
            entitySubId?: string | null;
            widgetConfig?: Record<string, unknown> | null;
            order?: number;
            mobileLayout?: object | null;
        }>(params, DASHBOARD_ITEM_UPDATE_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(p.dashboardId, sender);
        const orgId = requireOrganizationId(sender);
        const clearMobile =
            Object.hasOwn(p, 'mobileLayout') && p.mobileLayout === null;
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_item_update_v3',
            {
                p_dashboard: p.dashboardId,
                p_item_id: p.itemId,
                p_size: p.size ?? null,
                p_entity_sub_id: p.entitySubId ?? null,
                p_widget_config: p.widgetConfig ?? null,
                p_order: p.order ?? null,
                p_mobile_layout: clearMobile ? null : (p.mobileLayout ?? null),
                p_clear_mobile_layout: clearMobile
            }
        );
        const ok = res?.rows?.[0]?.fn_dashboard_item_update_v3 ?? false;
        if (!ok) throw RpcError.Domain('DashboardItemNotFound');
        EventDistributor.emitDashboardItemsChanged(p.dashboardId, orgId);
        return await this.#fetchDashboard(p.dashboardId, sender);
    }

    @Component.Expose('Item.Remove')
    @Component.CrudPermission('dashboards', 'update', (p) => p?.dashboardId)
    async itemRemove(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{dashboardId: number; itemId: number}>(
            params,
            DASHBOARD_ITEM_REMOVE_PARAMS_SCHEMA
        );
        await this.#assertOwnedBySenderOrg(p.dashboardId, sender);
        const orgId = requireOrganizationId(sender);
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_item_remove_v3',
            {p_dashboard: p.dashboardId, p_item_id: p.itemId}
        );
        const ok = res?.rows?.[0]?.fn_dashboard_item_remove_v3 ?? false;
        if (!ok) throw RpcError.Domain('DashboardItemNotFound');
        EventDistributor.emitDashboardItemsChanged(p.dashboardId, orgId);
        return await this.#fetchDashboard(p.dashboardId, sender);
    }

    @Component.Expose('Item.Reorder')
    @Component.CrudPermission('dashboards', 'update', (p) => p?.dashboardId)
    async itemReorder(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{dashboardId: number; itemIds: number[]}>(
            params,
            DASHBOARD_ITEM_REORDER_PARAMS_SCHEMA
        );
        await this.#assertOwnedBySenderOrg(p.dashboardId, sender);
        const orgId = requireOrganizationId(sender);
        await PostgresProvider.callMethod('ui.fn_dashboard_item_reorder_v3', {
            p_dashboard: p.dashboardId,
            p_item_ids: p.itemIds
        });
        EventDistributor.emitDashboardItemsChanged(p.dashboardId, orgId);
        return await this.#fetchDashboard(p.dashboardId, sender);
    }

    @Component.Expose('Item.SetAll')
    @Component.CrudPermission('dashboards', 'update', (p) => p?.dashboardId)
    async itemSetAll(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            dashboardId: number;
            items: Array<{
                kind: string;
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order?: number;
                size?: string;
                mobileLayout?: object | null;
            }>;
        }>(params, DASHBOARD_ITEM_SET_ALL_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(p.dashboardId, sender);
        const orgId = requireOrganizationId(sender);
        if (p.items.length > tuning.dashboard.maxItems) {
            throw RpcError.InvalidParams(
                `items exceeds max (${tuning.dashboard.maxItems})`
            );
        }
        await this.#assertDashboardItemRefsBatchBelongToOrg(orgId, p.items);
        await PostgresProvider.callMethod('ui.fn_dashboard_item_set_all', {
            p_dashboard: p.dashboardId,
            p_items: JSON.stringify(p.items)
        });
        EventDistributor.emitDashboardItemsChanged(p.dashboardId, orgId);
        return await this.#fetchDashboard(p.dashboardId, sender);
    }

    // Read-after-write helper. Single SQL pass; callers don't refetch.
    async #fetchDashboard(dashboardId: number, sender: CommandSender) {
        const row = await this.#fetchDashboardRow(dashboardId, sender);
        if (!row) throw RpcError.Domain('DashboardNotFound');
        return rowToDashboard(row);
    }

    // ==== Phase 3: Templates =========================================

    @Component.NoAudit
    @Component.Expose('Template.List')
    @Component.CrudPermission('dashboards', 'read')
    async templateList(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            dashboardType?: string;
            includeBuiltin?: boolean;
            organizationId?: string;
        }>(params, DASHBOARD_TEMPLATE_LIST_PARAMS_SCHEMA);
        const orgId = requireOrganizationId(sender, p);
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_template_list',
            {
                p_organization_id: orgId,
                p_dashboard_type: p.dashboardType ?? null,
                p_include_builtin: p.includeBuiltin ?? true
            }
        );
        return {items: (res?.rows ?? []).map(rowToDashboardTemplate)};
    }

    @Component.NoAudit
    @Component.Expose('Template.Get')
    @Component.CrudPermission('dashboards', 'read')
    async templateGet(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{key: string; organizationId?: string}>(
            params,
            DASHBOARD_TEMPLATE_GET_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, p);
        const row = await this.#fetchTemplate(p.key, orgId);
        return rowToDashboardTemplate(row);
    }

    @Component.NoAudit
    @Component.Expose('Template.Preview')
    @Component.CrudPermission('dashboards', 'read')
    async templatePreview(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            key: string;
            scope?: {groupId?: number; locationId?: number; tagId?: number};
            organizationId?: string;
        }>(params, DASHBOARD_TEMPLATE_PREVIEW_PARAMS_SCHEMA);
        const orgId = requireOrganizationId(sender, p);
        const tpl = await this.#fetchTemplate(p.key, orgId);
        const {items, missingDevices} =
            await DashboardRegistry.materializeTemplateItems(
                tpl.seed,
                p.scope ?? {},
                orgId
            );
        return {items, missingDevices};
    }

    @Component.Expose('Template.Create')
    @Component.CrudPermission('dashboards', 'create')
    async templateCreate(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            key: string;
            label: string;
            description?: string | null;
            dashboardType: string;
            seed: object;
            organizationId?: string;
        }>(params, DASHBOARD_TEMPLATE_CREATE_PARAMS_SCHEMA);
        const orgId = requireOrganizationId(sender, p);
        await this.#assertTemplateBudget(orgId);
        try {
            const res = await PostgresProvider.callMethod(
                'ui.fn_dashboard_template_create',
                {
                    p_key: p.key,
                    p_label: p.label,
                    p_description: p.description ?? null,
                    p_dashboard_type: p.dashboardType,
                    p_seed: JSON.stringify(p.seed),
                    p_organization_id: orgId,
                    p_is_builtin: false
                }
            );
            return rowToDashboardTemplate(res?.rows?.[0]);
        } catch (err) {
            throw translatePgError(err, 'dashboard template create');
        }
    }

    @Component.Expose('Template.Update')
    @Component.CrudPermission('dashboards', 'update')
    async templateUpdate(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            key: string;
            label?: string;
            description?: string | null;
            seed?: object;
            organizationId?: string;
        }>(params, DASHBOARD_TEMPLATE_UPDATE_PARAMS_SCHEMA);
        const orgId = requireOrganizationId(sender, p);
        const existing = await this.#fetchTemplate(p.key, orgId);
        if (existing.is_builtin && existing.organization_id === null) {
            throw RpcError.Domain('DashboardTemplateBuiltinReadonly');
        }
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_template_update',
            {
                p_key: p.key,
                p_organization_id: orgId,
                p_label: p.label ?? null,
                p_description:
                    p.description === undefined ? null : p.description,
                p_seed: p.seed ? JSON.stringify(p.seed) : null
            }
        );
        return rowToDashboardTemplate(res?.rows?.[0]);
    }

    @Component.Expose('Template.Delete')
    @Component.CrudPermission('dashboards', 'delete')
    async templateDelete(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{key: string; organizationId?: string}>(
            params,
            DASHBOARD_TEMPLATE_DELETE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, p);
        const existing = await this.#fetchTemplate(p.key, orgId);
        if (existing.is_builtin && existing.organization_id === null) {
            throw RpcError.Domain('DashboardTemplateBuiltinReadonly');
        }
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_template_delete',
            {p_key: p.key, p_organization_id: orgId}
        );
        const deleted = res?.rows?.[0]?.deleted;
        if (!deleted) throw RpcError.Domain('DashboardTemplateNotFound');
        return {deleted};
    }

    @Component.Expose('Template.SaveFromDashboard')
    @Component.CrudPermission('dashboards', 'create', (p) => p?.dashboardId)
    async templateSaveFromDashboard(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            dashboardId: number;
            key: string;
            label: string;
            description?: string | null;
            organizationId?: string;
        }>(params, DASHBOARD_TEMPLATE_SAVE_FROM_DASHBOARD_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(p.dashboardId, sender);
        const orgId = requireOrganizationId(sender, p);
        await this.#assertTemplateBudget(orgId);
        const dash = await this.#fetchDashboard(p.dashboardId, sender);
        const seed = {
            staticItems: dash.items.map((it) => ({
                kind: it.kind,
                deviceId: it.deviceId,
                entitySubId: it.entitySubId,
                groupId: it.groupId,
                locationId: it.locationId,
                tagId: it.tagId,
                actionId: it.actionId,
                widgetKind: it.widgetKind,
                widgetConfig: it.widgetConfig,
                order: it.order,
                size: it.size,
                mobileLayout: it.mobileLayout
            })),
            settings: dash.settings
        };
        try {
            const res = await PostgresProvider.callMethod(
                'ui.fn_dashboard_template_create',
                {
                    p_key: p.key,
                    p_label: p.label,
                    p_description: p.description ?? null,
                    p_dashboard_type: dash.dashboardType,
                    p_seed: JSON.stringify(seed),
                    p_organization_id: orgId,
                    p_is_builtin: false
                }
            );
            return rowToDashboardTemplate(res?.rows?.[0]);
        } catch (err) {
            throw translatePgError(err, 'dashboard template save');
        }
    }

    async #fetchTemplate(key: string, orgId: string): Promise<any> {
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_template_get',
            {p_key: key, p_organization_id: orgId}
        );
        const row = res?.rows?.[0];
        if (!row) throw RpcError.Domain('DashboardTemplateNotFound');
        return row;
    }

    async #assertTemplateBudget(orgId: string): Promise<void> {
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_template_list',
            {
                p_organization_id: orgId,
                p_dashboard_type: null,
                p_include_builtin: false
            }
        );
        const count = (res?.rows ?? []).length;
        if (count >= tuning.dashboard.maxTemplatesPerOrg) {
            throw RpcError.InvalidParams(
                `org template count would exceed max (${tuning.dashboard.maxTemplatesPerOrg})`
            );
        }
    }

    // ==== Phase 4: Default landing + Pinning + Clone =================

    @Component.NoAudit
    @Component.Expose('GetDefault')
    @Component.CrudPermission('dashboards', 'read')
    async getDefault(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string}>(
            params,
            DASHBOARD_GET_DEFAULT_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, p);
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_get_default',
            {p_organization_id: orgId}
        );
        const id = res?.rows?.[0]?.id;
        return {id: typeof id === 'number' ? id : null};
    }

    @Component.Expose('SetDefault')
    @Component.CrudPermission('dashboards', 'update', (p) => p?.id)
    async setDefault(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{id: number; organizationId?: string}>(
            params,
            DASHBOARD_SET_DEFAULT_PARAMS_SCHEMA
        );
        await this.#assertOwnedBySenderOrg(p.id, sender);
        const orgId = requireOrganizationId(sender, p);
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_set_default',
            {p_dashboard_id: p.id, p_organization_id: orgId}
        );
        const ok = res?.rows?.[0]?.fn_dashboard_set_default ?? false;
        if (!ok) throw RpcError.Domain('DashboardNotFound');
        return {id: p.id};
    }

    @Component.Expose('ClearDefault')
    @Component.CrudPermission('dashboards', 'update')
    async clearDefault(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string}>(
            params,
            DASHBOARD_CLEAR_DEFAULT_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender, p);
        await PostgresProvider.callMethod('ui.fn_dashboard_clear_default', {
            p_organization_id: orgId
        });
        return {};
    }

    @Component.NoAudit
    @Component.Expose('ListPinned')
    @Component.CrudPermission('dashboards', 'read')
    async listPinned(params: unknown, sender: CommandSender) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            DASHBOARD_LIST_PINNED_PARAMS_SCHEMA
        );
        const userId = sender.getUser()?.username;
        if (!userId) throw RpcError.Unauthorized();
        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_list_pinned',
            {p_user_id: userId}
        );
        const items = (res?.rows ?? []).map((r: any) => ({
            dashboardId: r.dashboard_id,
            sortOrder: r.sort_order,
            pinnedAt: toIso(r.pinned_at) ?? ''
        }));
        return {items};
    }

    // Pins are per-user UI state, so 'read' is the right authority, not 'update'.
    @Component.Expose('Pin')
    @Component.CrudPermission('dashboards', 'read', (p) => p?.id)
    async pin(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{id: number; sortOrder?: number}>(
            params,
            DASHBOARD_PIN_PARAMS_SCHEMA
        );
        await this.#assertOwnedBySenderOrg(p.id, sender);
        const userId = sender.getUser()?.username;
        if (!userId) throw RpcError.Unauthorized();
        const countRes = await PostgresProvider.callMethod(
            'ui.fn_dashboard_list_pinned',
            {p_user_id: userId}
        );
        if ((countRes?.rows ?? []).length >= tuning.dashboard.maxPinsPerUser) {
            throw RpcError.InvalidParams(
                `pin count would exceed max (${tuning.dashboard.maxPinsPerUser})`
            );
        }
        await PostgresProvider.callMethod('ui.fn_dashboard_pin', {
            p_user_id: userId,
            p_dashboard_id: p.id,
            p_sort_order: p.sortOrder ?? null
        });
        return {pinned: true};
    }

    @Component.Expose('Unpin')
    @Component.CrudPermission('dashboards', 'read', (p) => p?.id)
    async unpin(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{id: number}>(
            params,
            DASHBOARD_UNPIN_PARAMS_SCHEMA
        );
        const userId = sender.getUser()?.username;
        if (!userId) throw RpcError.Unauthorized();
        await PostgresProvider.callMethod('ui.fn_dashboard_unpin', {
            p_user_id: userId,
            p_dashboard_id: p.id
        });
        return {unpinned: true};
    }

    @Component.Expose('ReorderPins')
    @Component.CrudPermission('dashboards', 'read')
    async reorderPins(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{ids: number[]}>(
            params,
            DASHBOARD_REORDER_PINS_PARAMS_SCHEMA
        );
        const userId = sender.getUser()?.username;
        if (!userId) throw RpcError.Unauthorized();
        await PostgresProvider.callMethod('ui.fn_dashboard_reorder_pins', {
            p_user_id: userId,
            p_ids: p.ids
        });
        return {};
    }

    // ==== Phase 6: Grafana export / import ===========================

    @Component.NoAudit
    @Component.Expose('Export')
    @Component.CrudPermission('dashboards', 'read', (p) => p?.id)
    async exportDashboard(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            id: number;
            format?: 'fm' | 'grafana';
        }>(params, DASHBOARD_EXPORT_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(p.id, sender);
        const dash = await this.#fetchDashboard(p.id, sender);
        const format = p.format ?? 'fm';
        const json = format === 'grafana' ? toGrafana(dash) : dash;
        return {format, json};
    }

    @Component.Expose('Import')
    @Component.CrudPermission('dashboards', 'create')
    async importDashboard(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            json: any;
            format?: 'fm' | 'grafana';
            name?: string;
            scope?: {groupId?: number; locationId?: number; tagId?: number};
            organizationId?: string;
        }>(params, DASHBOARD_IMPORT_PARAMS_SCHEMA);
        const orgId = requireOrganizationId(sender, p);
        const imported =
            (p.format ?? 'fm') === 'grafana'
                ? fromGrafana(p.json)
                : fromFmJson(p.json);
        const name = (p.name ?? imported.name).trim();
        const scope = p.scope ?? imported.scope;
        try {
            const row = await createDashboardScoped({
                organizationId: orgId,
                name,
                dashboardType: imported.dashboardType,
                locationId: scope.locationId,
                groupId: scope.groupId,
                tagId: scope.tagId
            });
            if (imported.items.length > 0) {
                await this.#assertDashboardItemRefsBatchBelongToOrg(
                    orgId,
                    imported.items
                );
                await PostgresProvider.callMethod(
                    'ui.fn_dashboard_item_set_all',
                    {
                        p_dashboard: row.id,
                        p_items: JSON.stringify(imported.items)
                    }
                );
            }
            EventDistributor.emitDashboardCreated(row.id, name, orgId);
            return await this.#fetchDashboard(row.id, sender);
        } catch (err) {
            if (err instanceof RpcError) throw err;
            throw translatePgError(err, 'dashboard import');
        }
    }

    @Component.Expose('Clone')
    @Component.CrudPermission('dashboards', 'create', (p) => p?.id)
    async clone(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            id: number;
            name: string;
            scope?: {groupId?: number; locationId?: number; tagId?: number};
        }>(params, DASHBOARD_CLONE_PARAMS_SCHEMA);
        await this.#assertOwnedBySenderOrg(p.id, sender);
        const orgId = requireOrganizationId(sender);
        const scope = p.scope ?? {};
        try {
            const res = await PostgresProvider.callMethod(
                'ui.fn_dashboard_clone',
                {
                    p_source_id: p.id,
                    p_organization_id: orgId,
                    p_name: p.name.trim(),
                    p_group_id: scope.groupId ?? null,
                    p_location_id: scope.locationId ?? null,
                    p_tag_id: scope.tagId ?? null
                }
            );
            const newId = res?.rows?.[0]?.fn_dashboard_clone;
            if (typeof newId !== 'number') {
                throw RpcError.Domain('DashboardNotFound');
            }
            EventDistributor.emitDashboardCreated(newId, p.name, orgId);
            await this.#recordActivity({
                dashboardId: newId,
                organizationId: orgId,
                actorUserId: sender.getUser()?.username ?? null,
                eventKind: 'cloned',
                detail: {sourceId: p.id, name: p.name.trim()}
            });
            return await this.#fetchDashboard(newId, sender);
        } catch (err) {
            if (err instanceof RpcError) throw err;
            throw translatePgError(err, 'dashboard clone');
        }
    }

    // Read-only activity feed for the share/detail drawer. Asserts org
    // ownership before reading so a caller in org A can't peek at log
    // entries on org B's dashboards.
    @Component.Expose('Activity.List')
    @Component.CrudPermission('dashboards', 'read', (p) => p?.dashboardId)
    async activityList(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{dashboardId: number; limit?: number}>(
            params,
            DASHBOARD_ACTIVITY_LIST_PARAMS_SCHEMA
        );
        await this.#assertOwnedBySenderOrg(p.dashboardId, sender);
        const items = await DashboardActivityStore.listActivity({
            dashboardId: p.dashboardId,
            limit: p.limit
        });
        return {items};
    }

    // Best-effort activity logging. Failures here must not break the user
    // action that triggered them — the dashboard mutation already
    // succeeded against the database. Error handling extracted so the
    // mutation methods read as pure business logic.
    async #recordActivity(input: {
        dashboardId: number;
        organizationId: string;
        actorUserId: string | null;
        eventKind: DashboardActivityStore.DashboardActivityKind;
        detail?: Record<string, unknown>;
    }): Promise<void> {
        try {
            await DashboardActivityStore.appendActivity(input);
        } catch (err) {
            activityLogger.error(
                `Failed to record dashboard activity ${input.eventKind}`,
                err
            );
        }
    }
}

const activityLogger = log4js.getLogger('DashboardActivity');

function DASHBOARD_SETTINGS_DEFAULTS(dashboardId: number) {
    const d = dashboardDefaults();
    return {
        dashboardId,
        tariff: d.tariff,
        currency: d.currency,
        defaultRange: d.defaultRange,
        refreshInterval: d.refreshIntervalMs,
        enabledMetrics: [...d.enabledMetrics],
        chartSettings: {},
        tariffMode: 'single',
        dayRate: null,
        nightRate: null,
        dayStart: '07:00:00',
        dayEnd: '23:00:00',
        tariffId: null,
        peakDeviceIds: null,
        pvMode: null,
        pvGridRefs: null,
        pvGenerationRefs: null
    };
}
