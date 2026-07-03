// Strategy-map for AddWidgetModal save flow. Each widget type owns its own
// validation + payload shape. Adding a new widget is one entry; modal stays
// agnostic of widget-specific structure.

import type {UiWidgetId} from '@/types/dashboard-entry';

export interface ChartCfg {
    shellyId: string;
    metric: string;
    chartType: string;
}
export interface GaugeCfg {
    entityId: string;
    field: string;
    label: string;
    unit: string;
    min: number;
    max: number;
}
export interface StatsCfg {
    shellyId: string;
    metric: string;
    name: string;
}
export interface TopCfg {
    entityIdsRaw: string;
    limit: number;
}
export interface TimelineCfg {
    shellyId: string;
    field: string;
    name: string;
}
export interface HeatmapCfg {
    shellyId: string;
    metric: string;
}
export interface SiteGridCfg {
    metric: string;
}
export interface MaintCfg {
    maxItems: number;
}
export interface CrossBarCfg {
    metric: string;
    limit: number;
}

// One bundle so callers pass a single named owner instead of a 9-arg list.
export interface WidgetConfigBundle {
    chartCfg: ChartCfg;
    gaugeCfg: GaugeCfg;
    statsCfg: StatsCfg;
    topCfg: TopCfg;
    timelineCfg: TimelineCfg;
    heatmapCfg: HeatmapCfg;
    siteGridCfg: SiteGridCfg;
    maintCfg: MaintCfg;
    crossBarCfg: CrossBarCfg;
}

export type BuildResult =
    | {ok: true; data: Record<string, unknown>}
    | {ok: false; message: string};

// Backend stores widget data in a 245-char field — same cap the modal
// enforced inline.
const WIDGET_DATA_JSON_LIMIT = 245;

// Answer — is the assembled JSON under the persistence limit?
function withinJsonLimit(data: Record<string, unknown>): boolean {
    return JSON.stringify(data).length <= WIDGET_DATA_JSON_LIMIT;
}

// Answer — wrap a payload with the JSON-size guard so callers don't repeat.
function okIfFits(
    data: Record<string, unknown>,
    overSizeMessage: string
): BuildResult {
    return withinJsonLimit(data)
        ? {ok: true, data}
        : {ok: false, message: overSizeMessage};
}

type WidgetBuilder = (cfgs: WidgetConfigBundle) => BuildResult;

const WIDGET_BUILDERS: Partial<Record<UiWidgetId, WidgetBuilder>> = {
    chart_widget: ({chartCfg}) => {
        if (!chartCfg.shellyId) {
            return {ok: false, message: 'Select a device for the chart'};
        }
        return okIfFits(
            {
                id: 'chart_widget',
                shellyId: chartCfg.shellyId,
                metric: chartCfg.metric,
                chartType: chartCfg.chartType
            },
            'Device ID too long — cannot save widget'
        );
    },
    gauge_widget: ({gaugeCfg}) => {
        if (!gaugeCfg.entityId || !gaugeCfg.field) {
            return {
                ok: false,
                message: 'Select a device and field for the gauge'
            };
        }
        return okIfFits(
            {
                id: 'gauge_widget',
                entityId: gaugeCfg.entityId,
                field: gaugeCfg.field,
                label: gaugeCfg.label || gaugeCfg.field,
                unit: gaugeCfg.unit,
                min: gaugeCfg.min,
                max: gaugeCfg.max,
                thresholds: []
            },
            'Entity ID or field too long — cannot save widget'
        );
    },
    stats_summary_widget: ({statsCfg}) => {
        if (!statsCfg.shellyId) {
            return {ok: false, message: 'Select a device for stats'};
        }
        return okIfFits(
            {
                id: 'stats_summary_widget',
                entries: [
                    {
                        shellyId: statsCfg.shellyId,
                        metric: statsCfg.metric,
                        name: statsCfg.name || statsCfg.shellyId
                    }
                ],
                range: '24h'
            },
            'Device ID too long — cannot save widget'
        );
    },
    top_consumers_widget: ({topCfg}) => {
        const entityIds = topCfg.entityIdsRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        if (!entityIds.length) {
            return {ok: false, message: 'Enter at least one entity ID'};
        }
        return okIfFits(
            {
                id: 'top_consumers_widget',
                entityIds,
                range: '7d',
                limit: topCfg.limit
            },
            'Too many / too long entity IDs — reduce the list'
        );
    },
    state_timeline_widget: ({timelineCfg}) => {
        if (!timelineCfg.shellyId || !timelineCfg.field) {
            return {
                ok: false,
                message: 'Select a device and field for the timeline'
            };
        }
        return okIfFits(
            {
                id: 'state_timeline_widget',
                entities: [
                    {
                        shellyId: timelineCfg.shellyId,
                        field: timelineCfg.field,
                        name: timelineCfg.name || timelineCfg.field
                    }
                ]
            },
            'Device ID or field name too long — cannot save widget'
        );
    },
    activity_heatmap_widget: ({heatmapCfg}) => {
        if (!heatmapCfg.shellyId) {
            return {ok: false, message: 'Select a device for the heatmap'};
        }
        return okIfFits(
            {
                id: 'activity_heatmap_widget',
                shellyId: heatmapCfg.shellyId,
                metric: heatmapCfg.metric,
                days: 7
            },
            'Device ID too long — cannot save widget'
        );
    },
    energy_flow_sankey_widget: () => ({
        ok: true,
        data: {
            id: 'energy_flow_sankey_widget',
            sources: [],
            loads: [],
            showValues: true
        }
    }),
    fleet_kpi_strip_widget: () => ({
        ok: true,
        data: {id: 'fleet_kpi_strip_widget'}
    }),
    site_grid_widget: ({siteGridCfg}) => ({
        ok: true,
        data: {id: 'site_grid_widget', metric: siteGridCfg.metric}
    }),
    maintenance_list_widget: ({maintCfg}) => ({
        ok: true,
        data: {
            id: 'maintenance_list_widget',
            maxItems: maintCfg.maxItems,
            severities: ['critical', 'warning', 'info']
        }
    }),
    cross_site_bar_widget: ({crossBarCfg}) => ({
        ok: true,
        data: {
            id: 'cross_site_bar_widget',
            metric: crossBarCfg.metric,
            limit: crossBarCfg.limit
        }
    }),
    data_table_widget: () => ({
        ok: true,
        data: {
            id: 'data_table_widget',
            source: 'device_health',
            sortBy: 'name',
            maxRows: 100
        }
    })
};

// Answer — assemble a widget save payload, or describe why we can't.
// Returns a generic single-key fallback for widget IDs that don't have a
// specific builder (matches the old `else` branch).
export function buildWidgetPayload(
    widgetId: UiWidgetId,
    cfgs: WidgetConfigBundle
): BuildResult {
    const builder = WIDGET_BUILDERS[widgetId];
    if (builder) return builder(cfgs);
    return {ok: true, data: {id: widgetId}};
}
