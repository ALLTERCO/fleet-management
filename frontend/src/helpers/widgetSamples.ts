/**
 * Sample fixture configs for UI widgets — used by the add-widget catalog to
 * render a previewable thumbnail before the user has filled in real config.
 *
 * Each factory returns a config object that satisfies the widget's
 * `*WidgetConfig` shape with placeholder values. The widgets themselves
 * handle the no-data / empty-state path gracefully (skeleton or "no data"
 * empty card), so a fixture without live data still renders a meaningful
 * outline.
 *
 * NOTE: these are READ-ONLY samples. The catalog never persists them.
 */

import type {UiWidgetId} from '@/types/dashboard-entry';

/** Map of widget id → factory returning a minimal config for preview. */
export const WIDGET_SAMPLE_CONFIG: Record<
    UiWidgetId,
    () => Record<string, any>
> = {
    chart_widget: () => ({
        id: 'chart_widget',
        shellyId: '',
        metric: 'power',
        chartType: 'line'
    }),
    gauge_widget: () => ({
        id: 'gauge_widget',
        entityId: '',
        field: '',
        label: 'Power',
        unit: 'W',
        min: 0,
        max: 3500,
        thresholds: []
    }),
    stats_summary_widget: () => ({
        id: 'stats_summary_widget',
        entries: [],
        range: '24h'
    }),
    top_consumers_widget: () => ({
        id: 'top_consumers_widget',
        entityIds: [],
        range: '24h',
        limit: 5
    }),
    state_timeline_widget: () => ({
        id: 'state_timeline_widget',
        entities: [],
        range: '24h'
    }),
    activity_heatmap_widget: () => ({
        id: 'activity_heatmap_widget',
        shellyId: '',
        metric: 'power',
        days: 7
    }),
    energy_flow_sankey_widget: () => ({
        id: 'energy_flow_sankey_widget',
        sources: [],
        loads: [],
        showValues: true
    }),
    fleet_kpi_strip_widget: () => ({id: 'fleet_kpi_strip_widget'}),
    site_grid_widget: () => ({
        id: 'site_grid_widget',
        metric: 'power'
    }),
    maintenance_list_widget: () => ({
        id: 'maintenance_list_widget',
        severities: ['critical', 'warning'],
        maxItems: 8
    }),
    cross_site_bar_widget: () => ({
        id: 'cross_site_bar_widget',
        metric: 'power',
        limit: 8
    }),
    data_table_widget: () => ({
        id: 'data_table_widget',
        source: 'device_health',
        sortBy: 'name',
        maxRows: 12
    }),
    clock_widget: () => ({id: 'clock_widget'}),
    broken_widget: () => ({id: 'broken_widget'})
};

/** Catalogue metadata for the picker tile (icon, name, short description). */
export const UI_WIDGET_META: Record<
    UiWidgetId,
    {icon: string; name: string; description: string}
> = {
    clock_widget: {
        icon: 'fas fa-clock',
        name: 'Clock',
        description: 'Live clock widget'
    },
    chart_widget: {
        icon: 'fas fa-chart-line',
        name: 'Chart',
        description: 'Time-series metric chart'
    },
    gauge_widget: {
        icon: 'fas fa-tachometer-alt',
        name: 'Gauge',
        description: 'Live radial gauge'
    },
    stats_summary_widget: {
        icon: 'fas fa-table-cells',
        name: 'Stats Summary',
        description: 'Min / Avg / Max table'
    },
    top_consumers_widget: {
        icon: 'fas fa-ranking-star',
        name: 'Top Consumers',
        description: 'Ranked energy usage'
    },
    state_timeline_widget: {
        icon: 'fas fa-timeline',
        name: 'State Timeline',
        description: 'On/off history bars'
    },
    activity_heatmap_widget: {
        icon: 'fas fa-grip',
        name: 'Activity Heatmap',
        description: 'Hour × day pattern grid'
    },
    energy_flow_sankey_widget: {
        icon: 'fas fa-circle-nodes',
        name: 'Energy Flow',
        description: 'Live power Sankey diagram'
    },
    fleet_kpi_strip_widget: {
        icon: 'fas fa-layer-group',
        name: 'Fleet KPIs',
        description: 'Sites, devices, power, alerts'
    },
    site_grid_widget: {
        icon: 'fas fa-grip',
        name: 'Site Grid',
        description: 'Status tile per site / group'
    },
    maintenance_list_widget: {
        icon: 'fas fa-triangle-exclamation',
        name: 'Maintenance',
        description: 'Offline, battery, alert issues'
    },
    cross_site_bar_widget: {
        icon: 'fas fa-chart-column',
        name: 'Cross-Site Chart',
        description: 'Compare energy across sites'
    },
    data_table_widget: {
        icon: 'fas fa-table-list',
        name: 'Device Health Table',
        description: 'Signal, battery, firmware status'
    },
    broken_widget: {
        icon: 'fas fa-triangle-exclamation',
        name: 'Widget Error',
        description: 'Widget config invalid'
    }
};

/** All widget IDs the catalog should display, in display order. */
export const CATALOG_UI_WIDGETS: UiWidgetId[] = [
    'clock_widget',
    'chart_widget',
    'gauge_widget',
    'stats_summary_widget',
    'top_consumers_widget',
    'state_timeline_widget',
    'activity_heatmap_widget',
    'energy_flow_sankey_widget',
    'fleet_kpi_strip_widget',
    'site_grid_widget',
    'maintenance_list_widget',
    'cross_site_bar_widget',
    'data_table_widget'
];
