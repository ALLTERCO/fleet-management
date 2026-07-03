<template>
    <div class="awm-editor__form">
        <AddWidgetCfgChart
            v-if="widget === 'chart_widget'"
            :cfg="chartCfg"
            :chart-device-list="chartDeviceList"
        />
        <AddWidgetCfgGauge
            v-else-if="widget === 'gauge_widget'"
            :cfg="gaugeCfg"
        />
        <AddWidgetCfgStats
            v-else-if="widget === 'stats_summary_widget'"
            :cfg="statsCfg"
            :chart-device-list="chartDeviceList"
        />
        <AddWidgetCfgTopConsumers
            v-else-if="widget === 'top_consumers_widget'"
            :cfg="topCfg"
        />
        <AddWidgetCfgStateTimeline
            v-else-if="widget === 'state_timeline_widget'"
            :cfg="timelineCfg"
            :chart-device-list="chartDeviceList"
        />
        <AddWidgetCfgActivityHeatmap
            v-else-if="widget === 'activity_heatmap_widget'"
            :cfg="heatmapCfg"
            :chart-device-list="chartDeviceList"
        />
        <AddWidgetCfgSiteGrid
            v-else-if="widget === 'site_grid_widget'"
            :cfg="siteGridCfg"
        />
        <AddWidgetCfgMaintenance
            v-else-if="widget === 'maintenance_list_widget'"
            :cfg="maintCfg"
        />
        <AddWidgetCfgCrossSiteBar
            v-else-if="widget === 'cross_site_bar_widget'"
            :cfg="crossBarCfg"
        />
        <AddWidgetCfgInfo v-else-if="widget === 'energy_flow_sankey_widget'">
            An empty Energy Flow card will be added. Configure sources and
            loads by editing the widget config.
        </AddWidgetCfgInfo>
        <AddWidgetCfgInfo v-else-if="widget === 'fleet_kpi_strip_widget'">
            Shows fleet-wide totals (sites, devices, live power, active
            alerts) — no configuration required.
        </AddWidgetCfgInfo>
        <AddWidgetCfgInfo v-else-if="widget === 'data_table_widget'">
            Shows all device health — signal, battery, firmware. No
            configuration required.
        </AddWidgetCfgInfo>
    </div>
</template>

<script setup lang="ts">
import type {
    ChartCfg,
    CrossBarCfg,
    GaugeCfg,
    HeatmapCfg,
    MaintCfg,
    SiteGridCfg,
    StatsCfg,
    TimelineCfg,
    TopCfg
} from '@/helpers/widgetBuilders';
import type {shelly_device_t} from '@/types';
import type {UiWidgetId} from '@/types/dashboard-entry';
import AddWidgetCfgActivityHeatmap from './AddWidgetCfgActivityHeatmap.vue';
import AddWidgetCfgChart from './AddWidgetCfgChart.vue';
import AddWidgetCfgCrossSiteBar from './AddWidgetCfgCrossSiteBar.vue';
import AddWidgetCfgGauge from './AddWidgetCfgGauge.vue';
import AddWidgetCfgInfo from './AddWidgetCfgInfo.vue';
import AddWidgetCfgMaintenance from './AddWidgetCfgMaintenance.vue';
import AddWidgetCfgSiteGrid from './AddWidgetCfgSiteGrid.vue';
import AddWidgetCfgStateTimeline from './AddWidgetCfgStateTimeline.vue';
import AddWidgetCfgStats from './AddWidgetCfgStats.vue';
import AddWidgetCfgTopConsumers from './AddWidgetCfgTopConsumers.vue';

// Each Cfg is a parent-owned reactive() object — Vue's reactivity tracks
// nested mutations through the prop so the parent stays the SoT without
// per-field v-model declarations. Adding a new widget = new
// AddWidgetCfg<Name>.vue + one v-else-if + one prop.
defineProps<{
    widget: UiWidgetId | '';
    chartDeviceList: shelly_device_t[];
    chartCfg: ChartCfg;
    gaugeCfg: GaugeCfg;
    statsCfg: StatsCfg;
    topCfg: TopCfg;
    timelineCfg: TimelineCfg;
    heatmapCfg: HeatmapCfg;
    siteGridCfg: SiteGridCfg;
    maintCfg: MaintCfg;
    crossBarCfg: CrossBarCfg;
}>();
</script>
