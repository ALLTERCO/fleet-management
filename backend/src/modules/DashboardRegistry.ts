// Dashboard-specific Postgres operations. Extracted from Registry.ts in
// Group E3 so UI ownership lives outside the generic KV module.

import * as log4js from 'log4js';
import * as DeviceCollector from './DeviceCollector';
import {legacyToTyped, TYPE_TO_KIND} from './dashboardItemLegacyMap';
import {callMethod} from './PostgresProvider';
import {invalidateDbCache} from './Registry';

export type {TypedRefFields} from './dashboardItemLegacyMap';
// Re-export for internal callers that previously imported from this module.
export {legacyToTyped, TYPE_TO_KIND} from './dashboardItemLegacyMap';

import {
    getDetectsEntityTypes,
    normalizeStaticItems
} from './dashboardTemplateStaticItems';
import {resolveScopeShellyIDs} from './scopeResolver';

const logger = log4js.getLogger('DashboardRegistry');

export async function addDashboardItem(
    dashboard: number,
    type: number,
    item: number,
    order = 0,
    sub_item: string | null = null,
    size = '1x1'
): Promise<number> {
    invalidateDbCache('ui.dashboards');
    const kind = TYPE_TO_KIND[type] ?? 'widget';
    const typed = legacyToTyped(kind, item, sub_item);
    const {
        rows: [{fn_dashboard_item_add_v3: id}]
    } = await callMethod('ui.fn_dashboard_item_add_v3', {
        p_dashboard: dashboard,
        p_kind: kind,
        ...typed,
        p_order: order,
        p_size: size,
        p_mobile_layout: null
    });
    return id;
}

export async function updateDashboardItemSize(
    dashboard: number,
    itemId: number,
    size: string
): Promise<void> {
    const valid = ['1x1', '2x1', '2x2'];
    if (!valid.includes(size)) throw new Error(`Invalid size: ${size}`);
    invalidateDbCache('ui.dashboards');
    // expose-sql-methods requires every input arg by name; SQL DEFAULT NULL
    // on the function isn't recognised as optional on the JS side. Pass the
    // full 8-arg signature with null/false for fields we're not touching.
    await callMethod('ui.fn_dashboard_item_update_v3', {
        p_dashboard: dashboard,
        p_item_id: itemId,
        p_size: size,
        p_entity_sub_id: null,
        p_widget_config: null,
        p_order: null,
        p_mobile_layout: null,
        p_clear_mobile_layout: false
    });
}

export async function removeDashboardWidget(
    dashboard: number,
    itemId: number
): Promise<void> {
    invalidateDbCache('ui.dashboards');
    await callMethod('ui.fn_dashboard_item_remove_v3', {
        p_dashboard: dashboard,
        p_item_id: itemId
    });
}

export async function reorderDashboardItems(
    dashboard: number,
    itemIds: number[]
): Promise<void> {
    invalidateDbCache('ui.dashboards');
    await callMethod('ui.fn_dashboard_item_reorder_v3', {
        p_dashboard: dashboard,
        p_item_ids: itemIds
    });
}

export async function getUIConfig(): Promise<any[]> {
    const {rows} = await callMethod('ui.fn_config_fetch', {});
    return rows;
}

// Org-ownership check — throws-free existence probe.
export async function dashboardBelongsToOrg(
    dashboardId: number,
    organizationId: string
): Promise<boolean> {
    const {rows} = await callMethod('ui.fn_dashboard_belongs_to_org', {
        p_id: dashboardId,
        p_organization_id: organizationId
    });
    return rows[0]?.fn_dashboard_belongs_to_org === true;
}

interface DashboardRow {
    id: number;
    organization_id: string | null;
    name: string;
    dashboard_type: string;
    location_id: number | null;
    group_id: number | null;
    tag_id: number | null;
    created: Date | string;
    updated: Date | string | null;
}

// Scoped insert. Validates cross-org references and enforces at-most-one-axis
// via the dashboard_scope_single_axis CHECK on the table.
export async function createDashboardScoped(params: {
    organizationId: string;
    name: string;
    dashboardType: string;
    locationId?: number;
    groupId?: number;
    tagId?: number;
}): Promise<DashboardRow> {
    const {rows} = await callMethod('ui.fn_dashboard_add_scoped', {
        p_organization_id: params.organizationId,
        p_name: params.name,
        p_dashboard_type: params.dashboardType,
        p_location_id: params.locationId ?? null,
        p_group_id: params.groupId ?? null,
        p_tag_id: params.tagId ?? null
    });
    invalidateDbCache('ui.dashboards');
    return rows[0] as DashboardRow;
}

export interface MaterializedTemplateItems {
    items: any[];
    /** Unregistered in-scope devices; non-zero = partial result, surface it. */
    missingDevices: number;
}

// Materialize template seed against a scope. Returns DashboardItem-shaped
// objects (sans id) ready for insertion.
export async function materializeTemplateItems(
    seed: any,
    scope: {groupId?: number; locationId?: number; tagId?: number},
    organizationId: string
): Promise<MaterializedTemplateItems> {
    const items: any[] = normalizeStaticItems(seed);
    let order = items.length
        ? Math.max(...items.map((i) => i.order ?? 0)) + 1
        : 0;

    const detects = getDetectsEntityTypes(seed);
    if (detects.length === 0) return {items, missingDevices: 0};

    const {entities, missingDevices} = await fetchEntitiesInScope(
        scope,
        detects,
        organizationId
    );
    for (const e of entities) {
        items.push({
            kind: 'entity',
            deviceId: e.deviceId,
            entitySubId: e.subId,
            order: order++,
            size: '1x1',
            mobileLayout: null
        });
    }
    return {items, missingDevices};
}

async function fetchEntitiesInScope(
    scope: {groupId?: number; locationId?: number; tagId?: number},
    entityTypes: string[],
    organizationId: string
): Promise<{
    entities: Array<{deviceId: number; subId: string; type: string}>;
    missingDevices: number;
}> {
    const kind = scope.groupId
        ? 'group'
        : scope.locationId
          ? 'location'
          : scope.tagId
            ? 'tag'
            : null;
    const id = scope.groupId ?? scope.locationId ?? scope.tagId ?? null;
    if (!kind || id === null) return {entities: [], missingDevices: 0};

    const shellyIDs = await resolveScopeShellyIDs(organizationId, kind, id);
    const result = collectScopeEntities(
        shellyIDs,
        new Set(entityTypes),
        DeviceCollector.getDevice
    );

    // Aggregated to one warn — per-shellyID would be noisy at scale.
    if (result.missingDevices > 0) {
        logger.warn(
            'template materialization: %d/%d scope devices not in DeviceCollector ' +
                '(scope=%s id=%s organizationId=%s) — entities omitted from template',
            result.missingDevices,
            shellyIDs.length,
            kind,
            id,
            organizationId
        );
    }
    return result;
}

interface ScopeDevice {
    id: number;
    entities: ReadonlyArray<{id: string | number; type: string}>;
}

// Pure fold: resolve each scope shellyID through `lookup`, keep entities whose
// type was requested, and count the ones the lookup can't find. Injecting the
// lookup keeps this free of the device registry so the count + omit-on-miss
// rule is testable in isolation.
export function collectScopeEntities(
    shellyIDs: string[],
    wanted: Set<string>,
    lookup: (shellyID: string) => ScopeDevice | undefined
): {
    entities: Array<{deviceId: number; subId: string; type: string}>;
    missingDevices: number;
} {
    const entities: Array<{deviceId: number; subId: string; type: string}> = [];
    let missingDevices = 0;
    for (const shellyID of shellyIDs) {
        const dev = lookup(shellyID);
        if (!dev) {
            missingDevices++;
            continue;
        }
        for (const entity of dev.entities) {
            if (!wanted.has(entity.type)) continue;
            entities.push({
                deviceId: dev.id,
                subId: String(entity.id),
                type: entity.type
            });
        }
    }
    return {entities, missingDevices};
}
