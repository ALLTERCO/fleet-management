<template>
    <div class="overview-dash" :class="{'overview-dash--kiosk': isKiosk}">

        <!-- Header -->
        <div class="od-header">
            <div>
                <h1 class="od-title">{{ dashboardName }}</h1>
                <p v-if="groupName" class="od-subtitle">{{ groupName }}</p>
            </div>
            <div class="od-header__chips">
                <DashboardScopePicker
                    :scope="scopeApi.current.value"
                    :groups="groupsList"
                    :tags="tagsList"
                    @change="scopeApi.setScope"
                />
                <DashFleetPulse
                    :current-count="onlineCount"
                    :history="onlineHistory"
                />
            </div>
        </div>

        <DashboardState
            v-if="error"
            state="error"
            title="Failed to load metrics"
            :error="error"
            @retry="load"
        />

        <DashboardState
            v-else-if="!hasData && !loading"
            state="empty"
            icon="fas fa-circle-nodes"
            title="No devices in fleet"
            message="Connect devices to this organization to start monitoring."
        />

        <!-- No group banner -->
        <div v-if="!groupId && allShellyIds.length" class="od-fleet-banner">
            <i class="fas fa-circle-info od-info-icon" />
            Showing all {{ allShellyIds.length }} fleet devices. Assign devices to groups for per-group filtering.
        </div>

        <template v-if="hasData">
            <!-- KPI strip -->
            <DashKpiStrip :metrics="kpis" />

            <!-- Insights row -->
            <DashInsights :insights="insights" />

            <!-- Power over time — full width hero -->
            <div class="od-panel od-panel--full">
                <h3 class="od-panel-title">Power over time</h3>
                <DashTimeChart
                    :data="histPowerData"
                    type="area"
                    :color="chartColors.primary"
                    unit="W"
                    :height="240"
                    :loading="loading"
                    zoom
                />
            </div>

            <!-- Voltage + Temperature — 50/50 -->
            <div v-if="!isKiosk" class="od-row-50-50">
                <div class="od-panel">
                    <h3 class="od-panel-title">Voltage</h3>
                    <DashTimeChart :data="histVoltageData" type="line" :color="chartColors.info" unit="V" :mark-area="{min: 207, max: 253}" :height="160" :loading="loading" zoom />
                </div>
                <div class="od-panel">
                    <h3 class="od-panel-title">Temperature</h3>
                    <DashTimeChart :data="histTemperatureData" type="line" :color="chartColors.warning" unit="°C" :height="160" :loading="loading" zoom />
                </div>
            </div>

            <!-- Status donut + Power by device + Fleet summary — 3 across -->
            <div v-if="!isKiosk" class="od-trio">
                <div class="od-panel">
                    <h3 class="od-panel-title">Device status</h3>
                    <DashStatusDonut :online="onlineCount" :offline="offlineCount" />
                </div>
                <div class="od-panel">
                    <h3 class="od-panel-title">Power by device</h3>
                    <DashPowerBar :devices="powerByDevice" unit="W" />
                </div>
                <div class="od-panel">
                    <h3 class="od-panel-title">Fleet summary</h3>
                    <DashFleetSummary
                        :total-devices="totalDeviceCount"
                        :online-devices="onlineCount"
                        :groups="groupCount"
                        :devices-by-type="devicesByType"
                        :loading="loading"
                    />
                </div>
            </div>

            <!-- Fleet bubble graph — size by power, color by status -->
            <div v-if="!isKiosk && fleetBubbleDevices.length > 0" class="od-panel od-panel--full">
                <h3 class="od-panel-title">Fleet at a glance</h3>
                <DashFleetBubbles
                    :devices="fleetBubbleDevices"
                    metric-unit="W"
                    metric-label="power"
                    @select="onFleetBubbleSelect"
                />
            </div>

            <!-- Device list + Uptime + Power comparison — 60/40 -->
            <div class="od-row-60-40">
                <div class="od-panel">
                    <h3 class="od-panel-title">Devices</h3>
                    <DashDeviceList
                        :devices="deviceRows"
                        :columns="deviceColumns"
                        :page-size="10"
                        :searchable="deviceRows.length > 10"
                        drill-down-metric="power"
                        :loading="loading"
                    />
                </div>
                <div class="od-stack">
                    <div class="od-panel">
                        <h3 class="od-panel-title">Power comparison</h3>
                        <DashPeriodComparison :current="currentPower" :previous="previousPower" unit="W" :loading="loading" />
                    </div>
                    <div class="od-panel">
                        <h3 class="od-panel-title">Uptime</h3>
                        <DashGauge :config="uptimeGauge" :loading="loading" />
                    </div>
                </div>
            </div>
        </template>

        <DashboardState
            v-if="loading && !liveMetrics && !error"
            state="loading"
            title="Loading overview"
        />

        <DashRenameModal
            :visible="renameVisible"
            :name="renameName"
            :saving="renameSaving"
            @save="saveRename"
            @close="renameVisible = false"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import DashboardScopePicker from '@/components/dashboard/DashboardScopePicker.vue';
import DashboardState from '@/components/dashboard/DashboardState.vue';
import DashDeviceList from '@/components/dashboard/DashDeviceList.vue';
import DashFleetBubbles from '@/components/dashboard/DashFleetBubbles.vue';
import DashFleetPulse from '@/components/dashboard/DashFleetPulse.vue';
import DashFleetSummary from '@/components/dashboard/DashFleetSummary.vue';
import DashGauge from '@/components/dashboard/DashGauge.vue';
import DashInsights from '@/components/dashboard/DashInsights.vue';
import DashKpiStrip from '@/components/dashboard/DashKpiStrip.vue';
import DashPeriodComparison from '@/components/dashboard/DashPeriodComparison.vue';
import DashPowerBar from '@/components/dashboard/DashPowerBar.vue';
import DashRenameModal from '@/components/dashboard/DashRenameModal.vue';
import DashStatusDonut from '@/components/dashboard/DashStatusDonut.vue';
import DashTimeChart from '@/components/dashboard/DashTimeChart.vue';
import {useDashboardScope} from '@/composables/useDashboardScope';
import {useDomainDashboardChrome} from '@/composables/useDomainDashboardChrome';
import {useRollingBuffer} from '@/composables/useRollingBuffer';
import {chartColors} from '@/helpers/chartUtils';
import {fetchDashboardRecordSummary} from '@/helpers/dashboardRecord';
import {filterByScope} from '@/helpers/dashboardScopeFilter';
import {classifyDeviceType} from '@/helpers/dashboardUtils';
import {formatDuration} from '@/helpers/format';
import {buildLiveMetricsFromDevices} from '@/helpers/liveMetrics';
import {logSettledRejections} from '@/helpers/promiseUtils';
import {useAuthStore} from '@/stores/auth';
import {useDashboardChromeStore} from '@/stores/dashboardChrome';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useTagsStore} from '@/stores/tags';
import * as ws from '@/tools/websocket';
import type {
    DashColumnDef,
    DashDeviceRow,
    DashGaugeConfig,
    DashInsight,
    DashKpiMetric,
    TimePoint
} from '@/types/dashboard-components';

// ── State ──

const isKiosk = document.body.classList.contains('kiosk');
const route = useRoute();
const groupsStore = useGroupsStore();
const tagsStore = useTagsStore();
const authStore = useAuthStore();

const scopeApi = useDashboardScope({
    scopeKey: () => authStore.currentUserId
});

const groupsList = computed(() => Object.values(groupsStore.groups));
const tagsList = computed(() => Object.values(tagsStore.tags));
const deviceStore = useDevicesStore();

const dashboardId = computed(() => Number((route.params as {id: string}).id));
const dashboardName = ref('Overview');
const groupId = ref<number | null>(null);
const loading = ref(false);
const liveMetrics = ref<any>(null);
const error = ref<string | null>(null);

const groupName = computed(() => {
    if (!groupId.value) return null;
    return groupsStore.groups[groupId.value]?.name ?? null;
});

const allShellyIds = computed(() => Object.keys(deviceStore.devices));
const hasData = computed(
    () => groupId.value !== null || allShellyIds.value.length > 0
);

// ── Derived metrics ──

const metrics = computed(() => liveMetrics.value?.metrics ?? {});
const allLiveDevices = computed(
    (): {id: number; shellyID: string; name: string; online?: boolean}[] =>
        liveMetrics.value?.devices ?? []
);

// devices() respects the scope picker — every downstream computed reads from
// this so the chart, bubble graph, and device table react together.
const devices = computed(() =>
    filterByScope(
        allLiveDevices.value,
        (d) => membershipOf(d.shellyID),
        scopeApi.current.value
    )
);

function membershipOf(shellyID: string) {
    const dev = deviceStore.devices[shellyID];
    if (!dev) return null;
    return {
        groupIds: dev.groupIds ?? [],
        tagIds: dev.tagIds ?? [],
        locationId: dev.locationId ?? null,
        shellyID
    };
}

const onlineCount = computed(
    () => devices.value.filter((device) => device.online).length
);

// Rolling history of online-device count — feeds the header fleet-pulse.
const {buffer: onlineBuffer, push: pushOnline} = useRollingBuffer(60);
watch(onlineCount, (count) => pushOnline(count), {immediate: true});
const onlineHistory = computed((): TimePoint[] =>
    onlineBuffer.value.map((entry) => {
        const d = new Date(entry.timestamp);
        const bucket = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        return {bucket, value: entry.value};
    })
);
const totalDeviceCount = computed(() => {
    if (groupId.value) {
        const group = groupsStore.groups[groupId.value];
        return group?.devices?.length ?? onlineCount.value;
    }
    return allShellyIds.value.length;
});
const offlineCount = computed(() => totalDeviceCount.value - onlineCount.value);

const groupCount = computed(() => Object.keys(groupsStore.groups).length);

const devicesByType = computed((): Record<string, number> => {
    const types: Record<string, number> = {};
    for (const shellyId of allShellyIds.value) {
        const dev = deviceStore.devices[shellyId];
        const app = dev?.info?.app ?? dev?.info?.jwt?.p ?? 'unknown';
        const type = classifyDeviceType(app);
        types[type] = (types[type] ?? 0) + 1;
    }
    return types;
});

// ── Power by device (for bar chart) ──

const powerByDevice = computed((): {name: string; value: number}[] => {
    if (!liveMetrics.value) return [];
    const m = metrics.value;
    const powerMap = new Map<number, number>();
    for (const v of m.power?.values ?? [])
        powerMap.set(v.deviceId, (powerMap.get(v.deviceId) ?? 0) + v.value);
    return devices.value
        .map((d) => ({name: d.name, value: powerMap.get(d.id) ?? 0}))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value);
});

// Fleet bubble graph — power-sized bubbles, status-colored.
const fleetBubbleDevices = computed(() => {
    if (!liveMetrics.value) return [];
    const m = metrics.value;
    const powerMap = new Map<number, number>();
    for (const v of m.power?.values ?? [])
        powerMap.set(v.deviceId, (powerMap.get(v.deviceId) ?? 0) + v.value);
    return devices.value.map((d) => ({
        id: d.id,
        name: d.name,
        metric: powerMap.get(d.id) ?? 0,
        status: d.online ? ('online' as const) : ('offline' as const)
    }));
});

function onFleetBubbleSelect(_id: number | string): void {
    // Click drilldown is wired in Phase 6 once we have a per-device detail view.
}

// ── Uptime helpers ──

function _computeUptimePercent(): number {
    const uptimeVals = metrics.value.uptime?.values ?? [];
    if (!uptimeVals.length) return 0;
    // Assume 30d max uptime for % — devices that have been up the full period
    const maxExpected = 30 * 86400;
    const avgUptime =
        uptimeVals.reduce((s: number, v: any) => s + v.value, 0) /
        uptimeVals.length;
    return Math.min(100, (avgUptime / maxExpected) * 100);
}

// ── KPIs (6 metrics) ──

const kpis = computed((): DashKpiMetric[] => [
    {
        key: 'online',
        label: 'Online',
        value: onlineCount.value,
        unit: 'devices',
        live: true,
        decimals: 0
    },
    {
        key: 'offline',
        label: 'Offline',
        value: offlineCount.value,
        unit: 'devices',
        decimals: 0
    },
    {
        key: 'power',
        label: 'Power',
        value: metrics.value.power?.total ?? null,
        unit: 'W',
        live: true,
        decimals: 0
    },
    {
        key: 'voltage',
        label: 'Voltage',
        value: metrics.value.voltage?.avg ?? null,
        unit: 'V',
        decimals: 1
    },
    {
        key: 'temp',
        label: 'Temp',
        value: metrics.value.temperature?.avg ?? null,
        unit: '°C',
        decimals: 1
    },
    {
        key: 'humidity',
        label: 'Humidity',
        value: metrics.value.humidity?.avg ?? null,
        unit: '%',
        decimals: 1
    }
]);

// ── Insights ──

const insights = computed((): DashInsight[] => {
    const list: DashInsight[] = [];
    if (offlineCount.value > 0) {
        list.push({
            key: 'offline',
            color: 'danger',
            text: `${offlineCount.value} device(s) offline`
        });
    }
    if (metrics.value.power?.total > 10000) {
        list.push({
            key: 'power',
            color: 'blue',
            text: `Fleet drawing ${Math.round(metrics.value.power.total).toLocaleString()} W total`
        });
    }
    return list;
});

// ── Device list ──

const deviceColumns: DashColumnDef[] = [
    {key: 'name', label: 'Device', align: 'left', sortable: true},
    {
        key: 'livePower',
        label: 'Power',
        format: (v: number) => (v != null ? `${Math.round(v)} W` : '\u2014'),
        sortable: true
    },
    {
        key: 'voltage',
        label: 'Voltage',
        format: (v: number) => (v != null ? `${v.toFixed(1)} V` : '\u2014'),
        sortable: true
    },
    {
        key: 'temperature',
        label: 'Temp',
        format: (v: number) => (v != null ? `${v.toFixed(1)}°C` : '\u2014'),
        sortable: true
    },
    {
        key: 'humidity',
        label: 'Humidity',
        format: (v: number) => (v != null ? `${v.toFixed(1)}%` : '\u2014'),
        sortable: true
    },
    {key: 'uptimeFormatted', label: 'Uptime', sortable: true}
];

const deviceRows = computed((): DashDeviceRow[] => {
    if (!liveMetrics.value) return [];
    const m = metrics.value;

    // Pre-build O(1) lookup maps — avoids O(n*m) .find() per device
    const uptimeMap = new Map<number, number>();
    for (const v of m.uptime?.values ?? []) uptimeMap.set(v.deviceId, v.value);

    const powerMap = new Map<number, number>();
    for (const v of m.power?.values ?? [])
        powerMap.set(v.deviceId, (powerMap.get(v.deviceId) ?? 0) + v.value);

    const voltageMap = new Map<number, number>();
    for (const v of m.voltage?.values ?? [])
        if (!voltageMap.has(v.deviceId)) voltageMap.set(v.deviceId, v.value);

    const tempMap = new Map<number, number>();
    for (const v of m.temperature?.values ?? [])
        if (!tempMap.has(v.deviceId)) tempMap.set(v.deviceId, v.value);

    const humMap = new Map<number, number>();
    for (const v of m.humidity?.values ?? [])
        if (!humMap.has(v.deviceId)) humMap.set(v.deviceId, v.value);

    return devices.value.map((d) => {
        const uptimeVal = uptimeMap.get(d.id) ?? null;
        return {
            id: d.id,
            shellyId: d.shellyID,
            name: d.name,
            online: d.online ?? false,
            livePower: powerMap.get(d.id) ?? null,
            voltage: voltageMap.get(d.id) ?? null,
            temperature: tempMap.get(d.id) ?? null,
            humidity: humMap.get(d.id) ?? null,
            uptimeFormatted:
                uptimeVal !== null ? formatDuration(uptimeVal) : '\u2014',
            _uptimeSeconds: uptimeVal ?? 0
        };
    });
});

// ── Power period comparison (live current vs historical avg) ──

const currentPower = computed(() => metrics.value.power?.total ?? 0);
const previousPower = computed(() => {
    if (!histPowerData.value.length) return currentPower.value;
    const sum = histPowerData.value.reduce((s, p) => s + p.value, 0);
    return sum / histPowerData.value.length;
});

// ── Gauges ──

const uptimeGauge = computed((): DashGaugeConfig => {
    const avgUptime = metrics.value.uptime?.avg ?? 0;
    return {
        value: Math.round(avgUptime / 3600),
        min: 0,
        max: Math.max(720, Math.ceil((avgUptime / 3600) * 1.2)),
        unit: 'h',
        label: 'Avg uptime',
        color: chartColors.success
    };
});

// ── Data fetching ──

async function fetchDashboardRecord() {
    const dashboard = await fetchDashboardRecordSummary(dashboardId.value);
    if (dashboard) {
        dashboardName.value = dashboard.name ?? 'Overview';
        groupId.value = dashboard.groupId;
    }
}

async function fetchLiveData() {
    if (groupId.value) {
        const metricsRes = await ws.sendRPC(
            'FLEET_MANAGER',
            'fleet.GetMetrics',
            {scope: {groupId: groupId.value}}
        );
        liveMetrics.value = metricsRes;
    } else if (allShellyIds.value.length > 0) {
        liveMetrics.value = buildLiveMetricsFromDevices(deviceStore.devices);
    }
}

// ── Historical data from DB ──

const histPowerData = ref<TimePoint[]>([]);
const histVoltageData = ref<TimePoint[]>([]);
const histTemperatureData = ref<TimePoint[]>([]);

async function fetchHistorical() {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const g = 'hour';

    const metricToTag: Record<string, string> = {
        power: 'power',
        voltage: 'voltage'
    };
    const granToBucket: Record<string, string> = {
        hour: '1 hour',
        day: '1 day',
        month: '1 month'
    };

    const fetcher = (metric: string) => {
        const params = {
            from,
            to,
            tags: [metricToTag[metric]],
            // AC grid electricity — exclude DC / other commodities.
            commodity: 'electricity',
            electricalSource: 'ac_mains',
            bucket: granToBucket[g]
        };
        return groupId.value
            ? ws.sendRPC<{items: any[]}>('FLEET_MANAGER', 'energy.query', {
                  ...params,
                  scope: {groupId: groupId.value}
              })
            : ws.sendRPC<{items: any[]}>(
                  'FLEET_MANAGER',
                  'energy.query',
                  params
              );
    };

    const [powerRes, voltageRes] = await Promise.all([
        fetcher('power').catch(() => null),
        fetcher('voltage').catch(() => null)
    ]);

    function mapData(res: any): TimePoint[] {
        if (!res?.items?.length) return [];
        const map = new Map<string, number>();
        for (const d of res.items) {
            map.set(d.bucket, (map.get(d.bucket) ?? 0) + Number(d.value ?? 0));
        }
        return [...map.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([bucket, value]) => ({bucket, value}));
    }

    histPowerData.value = mapData(powerRes);
    histVoltageData.value = mapData(voltageRes);

    // Temperature — env tag routes through energy.query too
    try {
        const tempParams = {
            from,
            to,
            tags: ['temperature']
        };
        const tempRes = groupId.value
            ? await ws.sendRPC<any>('FLEET_MANAGER', 'energy.query', {
                  ...tempParams,
                  scope: {groupId: groupId.value}
              })
            : await ws.sendRPC<any>(
                  'FLEET_MANAGER',
                  'energy.query',
                  tempParams
              );
        const tempPoints = (tempRes?.items ?? []).map((r: any) => ({
            bucket: r.bucket,
            value: Number(r.value ?? 0)
        }));
        const tempMap = new Map<string, {sum: number; count: number}>();
        for (const p of tempPoints) {
            const e = tempMap.get(p.bucket) ?? {sum: 0, count: 0};
            e.sum += p.value;
            e.count++;
            tempMap.set(p.bucket, e);
        }
        histTemperatureData.value = [...tempMap.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([bucket, {sum, count}]) => ({bucket, value: sum / count}));
    } catch {
        histTemperatureData.value = [];
    }
}

async function load() {
    loading.value = true;
    error.value = null;
    try {
        await fetchDashboardRecord();
    } catch (err) {
        console.error('[Overview] dashboard record load:', err);
        error.value = 'Failed to load dashboard data';
        loading.value = false;
        return;
    }
    // Live + historical degrade independently — one failure must not blank
    // the whole page when the rest loaded fine.
    const [live, hist] = await Promise.allSettled([
        fetchLiveData(),
        fetchHistorical()
    ]);
    logSettledRejections('Overview', {live, historical: hist});
    loading.value = false;
}

// ── Auto-refresh (60s) ──

let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startRefresh() {
    refreshTimer = setInterval(async () => {
        try {
            await fetchLiveData();
        } catch (err) {
            console.error('[Overview] refresh error:', err);
        }
    }, 60_000);
}

// ── Watchers ──

// Watch for device store population — handle case where dashboard loads before devices arrive
watch(
    allShellyIds,
    (ids) => {
        if (ids.length > 0 && !groupId.value && !liveMetrics.value) {
            load();
        }
    },
    {immediate: false}
);

// ── Lifecycle ──

onMounted(async () => {
    await load();
    startRefresh();
});

onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer);
    chrome.clear();
});

const chrome = useDashboardChromeStore();
const {renameVisible, renameSaving, renameName, saveRename} =
    useDomainDashboardChrome({
        dashboardId: () => dashboardId.value,
        loading: () => loading.value,
        currentName: () => dashboardName.value,
        onRenamed: (name) => {
            dashboardName.value = name;
        }
    });
</script>

<style scoped>
.overview-dash {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    background: var(--color-surface-bg);
    min-height: 100%;
}
.overview-dash--kiosk {
    padding: var(--space-3);
    gap: var(--space-3);
}

/* Header */
.od-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
}
.od-header__chips {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.od-title {
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
}
.od-subtitle {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.od-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* Banners */
.od-empty {
    border-radius: var(--radius-xl);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    padding: var(--space-8) var(--space-5);
    text-align: center;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.od-fleet-banner {
    border-radius: var(--radius-xl);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    padding: var(--space-3) var(--space-4);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* Panels */
.od-panel {
    border-radius: var(--radius-xl);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    padding: var(--space-4);
    min-width: 0;
    overflow: hidden;
    box-sizing: border-box;
    animation: panel-enter 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
    transition: border-color 0.2s ease, background 0.2s ease;
}
.od-panel:hover {
    border-color: var(--color-border-medium);
    background: var(--color-surface-3);
}
@keyframes panel-enter {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}
.od-panel--full {
    width: 100%;
}
.od-panel-title {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
    letter-spacing: 0.01em;
    margin-bottom: var(--space-3);
}

/* Layout grids */
.od-row-60-40 {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: stretch;
}
.od-row-50-50 {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: stretch;
}
.od-trio {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: stretch;
}
.od-quad {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: stretch;
}
.od-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: stretch;
}

.od-icon-btn {
    background: transparent;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-1-5) var(--space-2);
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;
    line-height: 1;
}
.od-icon-btn:hover:not(:disabled) {
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
}
.od-icon-btn:disabled {
    opacity: var(--state-disabled-opacity);
    cursor: not-allowed;
}
.od-info-icon {
    color: var(--color-primary);
    flex-shrink: 0;
}

.od-error-banner {
    border-radius: var(--radius-xl);
    border: 1px solid rgba(var(--color-danger-rgb), 0.15);
    background: rgba(var(--color-danger-rgb), 0.06);
    padding: var(--space-3) var(--space-4);
    font-size: var(--type-body);
    color: var(--color-danger-text);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
}
.od-error-banner button {
    background: none;
    border: 1px solid var(--color-danger-text);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-3);
    font-size: var(--type-body);
    color: var(--color-danger-text);
    cursor: pointer;
    white-space: nowrap;
}
.od-error-banner button:hover {
    background: rgba(var(--color-danger-rgb), 0.08);
}

@media (min-width: 1024px) {
    .od-row-60-40 {
        grid-template-columns: 3fr 2fr;
    }
    .od-row-50-50 {
        grid-template-columns: 1fr 1fr;
    }
    .od-trio {
        grid-template-columns: repeat(3, 1fr);
    }
    .od-quad {
        grid-template-columns: repeat(4, 1fr);
    }
}
@media (min-width: 768px) and (max-width: 1023px) {
    .od-quad {
        grid-template-columns: repeat(2, 1fr);
    }
    .od-trio {
        grid-template-columns: repeat(3, 1fr);
    }
    .od-row-50-50 {
        grid-template-columns: 1fr 1fr;
    }
}
</style>
