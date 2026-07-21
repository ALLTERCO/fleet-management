/**
 * Single source of truth for "given a DashboardEntry, what component renders
 * it, and with what props?". Used by the live dashboard renderer
 * (pages/dash/[id].vue) and by the add-widget catalog/preview pane
 * (components/dashboard/CardPreview.vue) so the picker never drifts from
 * the dashboard.
 *
 * The resolver is intentionally pure: callers inject the stores/lookups it
 * needs through a context object, so it can be exercised without mounting
 * the live dashboard.
 */

import type {Component} from 'vue';
import CardValue_Action from '@/components/cards/CardValue_Action.vue';
import CardValue_ActivityHeatmap from '@/components/cards/CardValue_ActivityHeatmap.vue';
import CardValue_CrossSiteBarChart from '@/components/cards/CardValue_CrossSiteBarChart.vue';
import CardValue_DataTable from '@/components/cards/CardValue_DataTable.vue';
import CardValue_EnergyFlowSankey from '@/components/cards/CardValue_EnergyFlowSankey.vue';
import CardValue_FleetKPIStrip from '@/components/cards/CardValue_FleetKPIStrip.vue';
import CardValue_Gauge from '@/components/cards/CardValue_Gauge.vue';
import CardValue_Group from '@/components/cards/CardValue_Group.vue';
import CardValue_Location from '@/components/cards/CardValue_Location.vue';
import CardValue_MaintenanceList from '@/components/cards/CardValue_MaintenanceList.vue';
import CardValue_SiteGrid from '@/components/cards/CardValue_SiteGrid.vue';
import CardValue_StateTimeline from '@/components/cards/CardValue_StateTimeline.vue';
import CardValue_StatsSummary from '@/components/cards/CardValue_StatsSummary.vue';
import CardValue_Tag from '@/components/cards/CardValue_Tag.vue';
import CardValue_TimeSeriesChart from '@/components/cards/CardValue_TimeSeriesChart.vue';
import CardValue_TopConsumers from '@/components/cards/CardValue_TopConsumers.vue';
import DeviceWidget from '@/components/widgets/DeviceWidget.vue';
import EntityWidget from '@/components/widgets/EntityWidget.vue';
import ClockWidget from '@/components/widgets/IntegratedWidgets/ClockWidget.vue';
import {resolveEntityCard} from '@/composables/useEntityCardResolver';
import type {SensorVariant} from '@/config/bthome-presentation';
import {getBThomeVariant} from '@/config/bthome-presentation';
import {clampSizeForEntity} from '@/helpers/widgetCatalog';
import type {action_t, entity_t} from '@/types';
import type {DashboardEntry, UiWidgetId} from '@/types/dashboard-entry';

/** Cached entity record matching pages/dash/[id].vue's `entityCache` shape. */
export interface CachedEntity {
    entity: entity_t;
    type: string;
}

/** Lookups the resolver needs. Injected by the consumer so the resolver
 *  stays pure and testable. */
export interface ResolverContext {
    entityCache: Map<string, CachedEntity>;
    /** Fallback when the entity-card map doesn't have a mapping but the
     *  entity itself exists — used by the legacy `EntityWidget` branch. */
    rawEntity: (id: string) => entity_t | undefined;
    /** Group lookup by id. Resolver returns a missing tile if undefined. */
    group: (id: number) => unknown | undefined;
    /** Action lookup by id (action_t.id is a string). */
    action: (id: string) => action_t | undefined;
    /** Resolve the durable database id to the current hardware id. */
    deviceExternalId: (id: number) => string | undefined;
}

/** Component + props pair the consumer renders with `<component :is>`. */
export interface RenderedCard {
    kind: 'component';
    component: Component;
    props: Record<string, any>;
}

/** A placeholder the consumer renders inside a `CardShell` when the entry
 *  references data that hasn't loaded (or isn't recognised). */
export interface MissingCard {
    kind: 'missing';
    reason: MissingReason;
    /** Optional hint shown beneath the title (e.g. the failing entity id). */
    hint?: string;
    title: string;
    size: DashboardEntry['size'];
}

export type MissingReason =
    | 'entity-not-loaded'
    | 'device-not-found'
    | 'group-not-found'
    | 'action-not-found'
    | 'widget-broken'
    | 'unknown-type';

export type ResolvedEntry = RenderedCard | MissingCard;

const UI_WIDGET_COMPONENTS: Record<UiWidgetId, Component | null> = {
    chart_widget: CardValue_TimeSeriesChart,
    gauge_widget: CardValue_Gauge,
    stats_summary_widget: CardValue_StatsSummary,
    top_consumers_widget: CardValue_TopConsumers,
    state_timeline_widget: CardValue_StateTimeline,
    activity_heatmap_widget: CardValue_ActivityHeatmap,
    energy_flow_sankey_widget: CardValue_EnergyFlowSankey,
    fleet_kpi_strip_widget: CardValue_FleetKPIStrip,
    site_grid_widget: CardValue_SiteGrid,
    maintenance_list_widget: CardValue_MaintenanceList,
    cross_site_bar_widget: CardValue_CrossSiteBarChart,
    data_table_widget: CardValue_DataTable,
    clock_widget: null, // routed to ClockWidget — separate prop shape
    broken_widget: null // routed to MissingCard
};

/** Resolve a dashboard entry to a renderable card. */
export function resolveDashboardEntry(
    entry: DashboardEntry,
    ctx: ResolverContext,
    options: {editMode?: boolean; size?: DashboardEntry['size']} = {}
): ResolvedEntry {
    const editMode = options.editMode ?? false;
    // Defensive: legacy entries occasionally arrive without a size field.
    // Matches the old template's `size ?? '1x1'` defaults.
    const size: DashboardEntry['size'] = options.size ?? entry.size ?? '1x1';

    switch (entry.type) {
        case 'entity': {
            const cached = ctx.entityCache.get(entry.data.id);
            const mapping = cached
                ? resolveEntityCard(cached.type, cached.entity)
                : null;

            if (cached && mapping) {
                const extra: Record<string, any> = {};
                if (mapping.variant) extra.variant = mapping.variant;
                if (cached.type === 'bthomesensor') {
                    extra.variant = bthomeVariantFor(cached.entity);
                }
                return {
                    kind: 'component',
                    component: mapping.component,
                    props: {
                        entity: cached.entity,
                        // Downgrade a size the entity no longer allows (e.g. a
                        // battery tile saved at 2x2 before the cap) — self-heals
                        // old layouts on render, no migration.
                        size: clampSizeForEntity(size, cached.entity),
                        editMode,
                        ...extra
                    }
                };
            }

            const entity = ctx.rawEntity(entry.data.id);
            if (entity) {
                return {
                    kind: 'component',
                    component: EntityWidget,
                    props: {
                        entity,
                        editMode,
                        vertical: false,
                        rightCorner: false
                    }
                };
            }

            return {
                kind: 'missing',
                reason: 'entity-not-loaded',
                title: 'Entity not available',
                hint: entry.data?.id,
                size
            };
        }

        case 'device': {
            // New entries (mapItem) store the device id at `data.id`; legacy
            // entries used `data.shellyID`. Read both for back-compat.
            const deviceRef = entry.data?.id ?? entry.data?.shellyID;
            const deviceId =
                typeof deviceRef === 'number'
                    ? ctx.deviceExternalId(deviceRef)
                    : deviceRef;
            if (!deviceId) {
                return {
                    kind: 'missing',
                    reason: 'device-not-found',
                    title: 'Device not available',
                    hint: String(deviceRef ?? ''),
                    size
                };
            }
            return {
                kind: 'component',
                component: DeviceWidget,
                props: {
                    deviceId,
                    size,
                    editMode
                }
            };
        }

        case 'group': {
            const group = ctx.group(entry.data.id);
            if (!group) {
                return {
                    kind: 'missing',
                    reason: 'group-not-found',
                    title: 'Group not available',
                    hint: String(entry.data?.id ?? ''),
                    size
                };
            }
            return {
                kind: 'component',
                component: CardValue_Group,
                props: {group, size, editMode}
            };
        }

        case 'location':
            return {
                kind: 'component',
                component: CardValue_Location,
                props: {
                    locationId: entry.data.id,
                    size,
                    editMode
                }
            };

        case 'tag':
            return {
                kind: 'component',
                component: CardValue_Tag,
                props: {
                    tagId: entry.data.id,
                    size,
                    editMode
                }
            };

        case 'action': {
            const action = ctx.action(entry.data.id);
            if (!action) {
                return {
                    kind: 'missing',
                    reason: 'action-not-found',
                    title: 'Action not available',
                    hint: String(entry.data?.id ?? ''),
                    size
                };
            }
            return {
                kind: 'component',
                component: CardValue_Action,
                props: {action, size, editMode}
            };
        }

        case 'ui_widget': {
            const widgetId = entry.data?.id as UiWidgetId | undefined;
            if (widgetId === 'broken_widget') {
                return {
                    kind: 'missing',
                    reason: 'widget-broken',
                    title: 'Widget config invalid',
                    size
                };
            }
            if (widgetId && UI_WIDGET_COMPONENTS[widgetId]) {
                return {
                    kind: 'component',
                    component: UI_WIDGET_COMPONENTS[widgetId] as Component,
                    props: {
                        config: entry.data,
                        size,
                        editMode
                    }
                };
            }
            // Default ui_widget bucket (clock_widget or unrecognised id)
            return {
                kind: 'component',
                component: ClockWidget,
                props: {vertical: false, editMode}
            };
        }

        default:
            return {
                kind: 'missing',
                reason: 'unknown-type',
                title: 'This widget could not be loaded',
                hint: String(entry.type),
                size
            };
    }
}

function bthomeVariantFor(entity: entity_t): SensorVariant {
    return getBThomeVariant(entity?.properties?.objName);
}
