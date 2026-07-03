<template>
    <div class="env-dash" :class="{'env-dash--kiosk': isKiosk}">

        <!-- Header -->
        <div class="env-header">
            <div>
                <h1 class="env-title">{{ dashboardName }}</h1>
                <p v-if="groupName" class="env-subtitle">{{ groupName }}</p>
            </div>
            <div class="env-header__chips">
                <DashboardScopePicker
                    :scope="scopeApi.current.value"
                    :groups="groupsList"
                    :tags="tagsList"
                    @change="scopeApi.setScope"
                />
            </div>
            <div class="env-actions">
                <DateRangeSelector v-model="dateRange" default-range="last_7_days" />
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
            icon="fas fa-temperature-half"
            title="No devices in fleet"
            message="Connect devices to this organization to start monitoring."
        />

        <!-- No group banner -->
        <div v-if="!groupId && allShellyIds.length" class="env-fleet-banner">
            <i class="fas fa-circle-info" style="color: var(--color-primary);" />
            Showing all {{ allShellyIds.length }} fleet devices. Assign devices to groups for per-group filtering.
        </div>

        <template v-if="hasData">
            <!-- KPI strip -->
            <DashKpiStrip :metrics="kpis" />

            <!-- Insights -->
            <DashInsights :insights="insights" />

            <!-- Temperature over time — full width -->
            <div class="env-panel env-panel--full">
                <h3 class="env-panel-title">Temperature over time</h3>
                <DashTimeChart
                    :data="temperatureTimeSeries"
                    type="area"
                    :color="chartColors.danger"
                    unit="°C"
                    :height="240"
                    :mark-area="{min: 15, max: 35}"
                    :loading="loading"
                    zoom
                    brush
                    @brush-end="onTemperatureBrushEnd"
                />
                <DashAttributionPanel
                    v-if="attribution.range.value"
                    :range="attribution.range.value"
                    :result="attribution.result.value"
                    :loading="attribution.loading.value"
                    :error="attribution.error.value"
                    closable
                    @close="attribution.setRange(null)"
                    @retry="onTemperatureBrushEnd(attribution.range.value!)"
                />
            </div>

            <!-- Humidity + Luminance — side by side -->
            <div v-if="!isKiosk" class="env-row-50-50">
                <div class="env-panel">
                    <h3 class="env-panel-title">Humidity over time</h3>
                    <DashTimeChart
                        :data="humidityTimeSeries"
                        type="area"
                        :color="chartColors.primary"
                        unit="%"
                        :height="160"
                        :loading="loading"
                        zoom
                    />
                </div>
                <div class="env-panel">
                    <h3 class="env-panel-title">Luminance over time</h3>
                    <DashTimeChart
                        :data="luminanceTimeSeries"
                        type="area"
                        :color="chartColors.warning"
                        unit="lux"
                        :height="160"
                        :loading="loading"
                        zoom
                    />
                </div>
            </div>

            <!-- Sensor list + Temperature gauge + Humidity gauge — 3 across -->
            <div class="env-trio">
                <div class="env-panel">
                    <h3 class="env-panel-title">Sensor devices</h3>
                    <DashDeviceList
                        :devices="deviceRows"
                        :columns="deviceColumns"
                        :page-size="8"
                        :searchable="deviceRows.length > 8"
                        :loading="loading"
                    />
                </div>
                <div class="env-panel">
                    <h3 class="env-panel-title">Temperature</h3>
                    <DashGauge :config="temperatureGauge" :loading="loading" />
                    <div class="env-comfort" :class="comfortClass">
                        <i :class="comfortIcon" />
                        {{ comfortLabel }}
                    </div>
                </div>
                <div class="env-panel">
                    <h3 class="env-panel-title">Humidity</h3>
                    <DashGauge :config="humidityGauge" :loading="loading" />
                </div>
            </div>
        </template>

        <DashboardState
            v-if="loading && !liveMetrics && !error"
            state="loading"
            title="Loading environment metrics"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch, watchEffect} from 'vue';
import {useRoute} from 'vue-router';
import DateRangeSelector from '@/components/analytics/DateRangeSelector.vue';
import DashAttributionPanel from '@/components/dashboard/DashAttributionPanel.vue';
import DashboardScopePicker from '@/components/dashboard/DashboardScopePicker.vue';
import DashboardState from '@/components/dashboard/DashboardState.vue';
import DashDeviceList from '@/components/dashboard/DashDeviceList.vue';
import DashGauge from '@/components/dashboard/DashGauge.vue';
import DashInsights from '@/components/dashboard/DashInsights.vue';
import DashKpiStrip from '@/components/dashboard/DashKpiStrip.vue';
import DashTimeChart from '@/components/dashboard/DashTimeChart.vue';
import {useDashboardNavigation} from '@/composables/useDashboardNavigation';
import {useDashboardScope} from '@/composables/useDashboardScope';
import {useWindowAttribution} from '@/composables/useWindowAttribution';
import {chartColors} from '@/helpers/chartUtils';
import {deviceMatchesScope} from '@/helpers/dashboardScopeFilter';
import {buildLiveMetricsFromDevices} from '@/helpers/liveMetrics';
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

// ── Types ──

interface EnvDataPoint {
    bucket: string;
    deviceId: number;
    value: number;
    min: number;
    max: number;
}

// ── State ──

const isKiosk = document.body.classList.contains('kiosk');
const route = useRoute();
const {goToManage} = useDashboardNavigation();
const groupsStore = useGroupsStore();
const deviceStore = useDevicesStore();
const tagsStore = useTagsStore();
const authStore = useAuthStore();

const scopeApi = useDashboardScope({scopeKey: () => authStore.currentUserId});
const groupsList = computed(() => Object.values(groupsStore.groups));
const tagsList = computed(() => Object.values(tagsStore.tags));

const dashboardId = computed(() => Number((route.params as {id: string}).id));
const dashboardName = ref('Environment');
const groupId = ref<number | null>(null);
const loading = ref(false);
const liveMetrics = ref<any>(null);
const error = ref<string | null>(null);

const temperatureHistory = ref<EnvDataPoint[]>([]);
const humidityHistory = ref<EnvDataPoint[]>([]);
const luminanceHistory = ref<EnvDataPoint[]>([]);

// ── Date range ──

const dateRange = ref({from: '', to: ''});

// ── Derived ──

const groupName = computed(() => {
    if (!groupId.value) return null;
    return groupsStore.groups[groupId.value]?.name ?? null;
});

// Scope predicate — every list below filters through this so the picker
// narrows the page (sensors, charts, KPIs, insights).
function inScope(shellyID: string): boolean {
    const dev = deviceStore.devices[shellyID];
    if (!dev) return false;
    return deviceMatchesScope(
        {
            groupIds: dev.groupIds ?? [],
            tagIds: dev.tagIds ?? [],
            locationId: dev.locationId ?? null,
            shellyID
        },
        scopeApi.current.value
    );
}

const allShellyIds = computed(() =>
    Object.keys(deviceStore.devices).filter(inScope)
);
const hasData = computed(
    () => groupId.value !== null || allShellyIds.value.length > 0
);

const metrics = computed(() => liveMetrics.value?.metrics ?? {});
const devices = computed((): {id: number; shellyID: string; name: string}[] =>
    (liveMetrics.value?.devices ?? []).filter((d: {shellyID: string}) =>
        inScope(d.shellyID)
    )
);

const sensorCount = computed(() => devices.value.length);

// Scope-narrowed device IDs — used to filter historical samples and
// per-device live metric values down to the picker's selection.
const scopedDeviceIds = computed(() => new Set(devices.value.map((d) => d.id)));

function inScopeRow(r: EnvDataPoint): boolean {
    if (scopeApi.current.value.kind === 'fleet') return true;
    return scopedDeviceIds.value.has(r.deviceId);
}

// ── Time series mapping ──

function mapToTimePoints(rows: EnvDataPoint[]): TimePoint[] {
    const bucketMap = new Map<string, {sum: number; count: number}>();
    for (const r of rows) {
        if (!inScopeRow(r)) continue;
        const entry = bucketMap.get(r.bucket) ?? {sum: 0, count: 0};
        entry.sum += r.value;
        entry.count++;
        bucketMap.set(r.bucket, entry);
    }
    return [...bucketMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucket, {sum, count}]) => ({bucket, value: sum / count}));
}

const temperatureTimeSeries = computed((): TimePoint[] =>
    mapToTimePoints(temperatureHistory.value)
);
const humidityTimeSeries = computed((): TimePoint[] =>
    mapToTimePoints(humidityHistory.value)
);
const luminanceTimeSeries = computed((): TimePoint[] =>
    mapToTimePoints(luminanceHistory.value)
);

// ── Brush-to-compare on the temperature chart ──
// Composable enforces input validation (ISO format + 90-day cap) so the
// page just forwards whatever the chart emitted.
const attribution = useWindowAttribution({
    metric: () => 'temperature',
    scope: () => scopeApi.current.value,
    topN: () => 10
});

function onTemperatureBrushEnd(range: {from: string; to: string}) {
    attribution.setRange(range);
}

// ── Averages from live metrics ──

// Filter per-device live values through the scope picker so KPIs match
// the charts. Fleet scope is a no-op fast path.
function scopedValues(
    vals: {deviceId: number; value: number}[]
): {deviceId: number; value: number}[] {
    if (scopeApi.current.value.kind === 'fleet') return vals;
    return vals.filter((v) => scopedDeviceIds.value.has(v.deviceId));
}

const avgTemperature = computed(() => {
    const vals = scopedValues(metrics.value.temperature?.values ?? []);
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + v.value, 0) / vals.length;
});

const avgHumidity = computed(() => {
    const vals = scopedValues(metrics.value.humidity?.values ?? []);
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + v.value, 0) / vals.length;
});

const avgLuminance = computed(() => {
    const vals = scopedValues(metrics.value.luminance?.values ?? []);
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + v.value, 0) / vals.length;
});

// ── KPIs ──

const kpis = computed((): DashKpiMetric[] => [
    {
        key: 'temp',
        label: 'Avg Temp',
        value: avgTemperature.value,
        unit: '°C',
        decimals: 1,
        live: true
    },
    {
        key: 'humidity',
        label: 'Avg Humidity',
        value: avgHumidity.value,
        unit: '%',
        decimals: 1,
        live: true
    },
    {
        key: 'lux',
        label: 'Avg Lux',
        value: avgLuminance.value,
        unit: 'lux',
        decimals: 0,
        live: true
    },
    {
        key: 'sensors',
        label: 'Sensors',
        value: sensorCount.value || null,
        unit: 'online',
        live: true,
        decimals: 0
    }
]);

// ── Insights ──

const insights = computed((): DashInsight[] => {
    const list: DashInsight[] = [];
    const tempVals = scopedValues(metrics.value.temperature?.values ?? []);
    const humVals = scopedValues(metrics.value.humidity?.values ?? []);

    for (const v of tempVals) {
        if (v.value > 40) {
            list.push({
                key: 'temp-high',
                color: 'danger',
                text: 'Temperature above 40°C on one or more devices'
            });
            break;
        }
    }
    for (const v of tempVals) {
        if (v.value < 5) {
            list.push({
                key: 'temp-low',
                color: 'warning',
                text: 'Temperature below 5°C on one or more devices'
            });
            break;
        }
    }
    for (const v of humVals) {
        if (v.value > 80) {
            list.push({
                key: 'hum-high',
                color: 'warning',
                text: 'Humidity above 80% on one or more devices'
            });
            break;
        }
    }
    for (const v of humVals) {
        if (v.value < 20) {
            list.push({
                key: 'hum-low',
                color: 'warning',
                text: 'Humidity below 20% on one or more devices'
            });
            break;
        }
    }
    return list;
});

// ── Device list ──

const deviceColumns: DashColumnDef[] = [
    {key: 'name', label: 'Device', align: 'left', sortable: true},
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
    {
        key: 'luminance',
        label: 'Lux',
        format: (v: number) => (v != null ? `${Math.round(v)} lux` : '\u2014'),
        sortable: true
    }
];

const deviceRows = computed((): DashDeviceRow[] => {
    if (!liveMetrics.value) return [];
    const m = metrics.value;

    const tempMap = new Map<number, number>();
    for (const v of m.temperature?.values ?? [])
        if (!tempMap.has(v.deviceId)) tempMap.set(v.deviceId, v.value);

    const humMap = new Map<number, number>();
    for (const v of m.humidity?.values ?? [])
        if (!humMap.has(v.deviceId)) humMap.set(v.deviceId, v.value);

    const lumMap = new Map<number, number>();
    for (const v of m.luminance?.values ?? [])
        if (!lumMap.has(v.deviceId)) lumMap.set(v.deviceId, v.value);

    return devices.value.map((d) => ({
        id: d.id,
        shellyId: d.shellyID,
        name: d.name,
        online: true,
        type: 'sensor' as const,
        temperature: tempMap.get(d.id) ?? null,
        humidity: humMap.get(d.id) ?? null,
        luminance: lumMap.get(d.id) ?? null
    }));
});

// ── Gauges ──

const temperatureGauge = computed(
    (): DashGaugeConfig => ({
        value: Number((avgTemperature.value ?? 0).toFixed(1)),
        min: -10,
        max: 50,
        unit: '°C',
        label: 'Avg temp',
        color: chartColors.danger
    })
);

const humidityGauge = computed(
    (): DashGaugeConfig => ({
        value: Number((avgHumidity.value ?? 0).toFixed(1)),
        min: 0,
        max: 100,
        unit: '%',
        label: 'Avg humidity',
        color: chartColors.primary
    })
);

// Comfort zone: 18-26°C and 30-60% humidity
const comfortLabel = computed(() => {
    const t = avgTemperature.value;
    const h = avgHumidity.value;
    if (t === null || h === null) return 'No data';
    const tempOk = t >= 18 && t <= 26;
    const humOk = h >= 30 && h <= 60;
    if (tempOk && humOk) return 'Comfortable';
    if (!tempOk && !humOk) return 'Outside comfort zone';
    if (!tempOk) return t < 18 ? 'Too cold' : 'Too warm';
    return h < 30 ? 'Too dry' : 'Too humid';
});

const comfortClass = computed(() => {
    const l = comfortLabel.value;
    if (l === 'Comfortable') return 'env-comfort--good';
    if (l === 'No data') return 'env-comfort--neutral';
    return 'env-comfort--warn';
});

const comfortIcon = computed(() => {
    const l = comfortLabel.value;
    if (l === 'Comfortable') return 'fas fa-check-circle';
    if (l === 'No data') return 'fas fa-circle-question';
    return 'fas fa-triangle-exclamation';
});

// ── Historical data ──

function mapEnvHistory(rows: any[]): EnvDataPoint[] {
    return rows.map((r) => ({
        bucket: r.bucket,
        deviceId: r.device,
        value: Number(r.value),
        min: Number(r.min ?? r.value),
        max: Number(r.max ?? r.value)
    }));
}

async function fetchHistory(gId: number, from: string, to: string) {
    const [tempRes, humRes, lumRes] = await Promise.all([
        ws.sendRPC<any>('FLEET_MANAGER', 'energy.query', {
            scope: {groupId: gId},
            from,
            to,
            tags: ['temperature']
        }),
        ws.sendRPC<any>('FLEET_MANAGER', 'energy.query', {
            scope: {groupId: gId},
            from,
            to,
            tags: ['humidity']
        }),
        ws.sendRPC<any>('FLEET_MANAGER', 'energy.query', {
            scope: {groupId: gId},
            from,
            to,
            tags: ['luminance']
        })
    ]);
    temperatureHistory.value = mapEnvHistory(tempRes?.items ?? []);
    humidityHistory.value = mapEnvHistory(humRes?.items ?? []);
    luminanceHistory.value = mapEnvHistory(lumRes?.items ?? []);
}

async function fetchFleetHistory(from: string, to: string) {
    const [tempRes, humRes, lumRes] = await Promise.all([
        ws.sendRPC<any>('FLEET_MANAGER', 'energy.query', {
            from,
            to,
            tags: ['temperature']
        }),
        ws.sendRPC<any>('FLEET_MANAGER', 'energy.query', {
            from,
            to,
            tags: ['humidity']
        }),
        ws.sendRPC<any>('FLEET_MANAGER', 'energy.query', {
            from,
            to,
            tags: ['luminance']
        })
    ]);
    temperatureHistory.value = mapEnvHistory(tempRes?.items ?? []);
    humidityHistory.value = mapEnvHistory(humRes?.items ?? []);
    luminanceHistory.value = mapEnvHistory(lumRes?.items ?? []);
}

function loadHistory() {
    if (!dateRange.value.from || !dateRange.value.to) return;
    if (groupId.value) {
        fetchHistory(
            groupId.value,
            dateRange.value.from,
            dateRange.value.to
        ).catch((err) => {
            console.error('[Environment] fetchHistory error:', err);
        });
    } else if (allShellyIds.value.length > 0) {
        fetchFleetHistory(dateRange.value.from, dateRange.value.to).catch(
            (err) => {
                console.error('[Environment] fetchFleetHistory error:', err);
            }
        );
    }
}

// ── Live metrics ──

async function fetchLiveMetrics() {
    if (groupId.value) {
        liveMetrics.value = await ws.sendRPC(
            'FLEET_MANAGER',
            'fleet.GetMetrics',
            {scope: {groupId: groupId.value}}
        );
    } else if (allShellyIds.value.length > 0) {
        liveMetrics.value = buildLiveMetricsFromDevices(deviceStore.devices);
    }
}

// ── Dashboard record ──

async function fetchDashboardRecord() {
    const dashboards = await ws.sendRPC<any[]>(
        'FLEET_MANAGER',
        'Storage.GetItem',
        {registry: 'ui', key: 'dashboards'}
    );
    const dashboard = (dashboards ?? []).find(
        (d: any) => d.id === dashboardId.value
    );
    if (dashboard) {
        dashboardName.value = dashboard.name ?? 'Environment';
        groupId.value = dashboard.scope?.groupId ?? null;
    }
}

// ── Load ──

async function load() {
    loading.value = true;
    error.value = null;
    try {
        await fetchDashboardRecord();
    } catch (err) {
        console.error('[Environment] dashboard record load:', err);
        error.value = 'Failed to load dashboard data';
        loading.value = false;
        return;
    }
    try {
        await fetchLiveMetrics();
    } catch (err) {
        console.warn('[Environment] live metrics fetch failed:', err);
    }
    try {
        loadHistory();
    } catch (err) {
        console.warn('[Environment] history load failed:', err);
    }
    loading.value = false;
}

// ── Auto-refresh (60s) ──

function rangeIsLive(to: string): boolean {
    return Math.abs(new Date(to).getTime() - Date.now()) < 2 * 60 * 60 * 1000;
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startRefresh() {
    refreshTimer = setInterval(async () => {
        try {
            await fetchLiveMetrics();
            // Advance "to" for live ranges so history re-fetches via watch
            if (dateRange.value.to && rangeIsLive(dateRange.value.to)) {
                dateRange.value = {
                    ...dateRange.value,
                    to: new Date().toISOString()
                };
            }
        } catch (err) {
            console.error('[Environment] refresh error:', err);
        }
    }, 60_000);
}

// ── Watchers ──

watch(
    dateRange,
    () => {
        loadHistory();
    },
    {deep: true}
);

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
watchEffect(() => {
    chrome.register({
        onRefresh: () => { void load(); },
        onShare: () => {},
        onToggleEdit: () => {},
        onAddWidget: () => {},
        onOpenManage: goToManage,
        canEdit: false,
        canShare: false,
        loading: loading.value
    });
});
</script>

<style scoped>
.env-dash {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    background: var(--color-surface-bg);
    min-height: 100%;
}
.env-dash--kiosk {
    padding: var(--space-3);
    gap: var(--space-3);
}

/* Header */
.env-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
}
.env-title {
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
}
.env-subtitle {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.env-header__chips {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.env-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}

/* Error banner */
.env-error-banner {
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
.env-error-banner button {
    background: none;
    border: 1px solid var(--color-danger-text);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-3);
    font-size: var(--type-body);
    color: var(--color-danger-text);
    cursor: pointer;
    white-space: nowrap;
}
.env-error-banner button:hover {
    background: rgba(var(--color-danger-rgb), 0.08);
}

/* Banners */
.env-empty {
    border-radius: var(--radius-xl);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    padding: var(--space-8) var(--space-5);
    text-align: center;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.env-fleet-banner {
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
.env-panel {
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
.env-panel:hover {
    border-color: var(--color-border-medium);
    background: var(--color-surface-2);
}
@keyframes panel-enter {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}
.env-panel--full {
    width: 100%;
}
.env-panel-title {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
    letter-spacing: 0.01em;
    margin-bottom: var(--space-3);
}

/* Layout grids */
.env-row-50-50 {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: stretch;
}
.env-trio {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: stretch;
}

/* Comfort zone indicator */
.env-comfort {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    margin-top: var(--gap-xs);
    padding: var(--gap-xs) var(--gap-sm);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
    font-weight: 500;
}
.env-comfort--good {
    color: var(--color-success-text);
    background: rgba(var(--color-success-rgb), 0.08);
}
.env-comfort--warn {
    color: var(--color-warning-text);
    background: rgba(var(--color-warning-rgb), 0.08);
}
.env-comfort--neutral {
    color: var(--color-text-tertiary);
    background: var(--state-hover-bg);
}
.env-row-60-40 {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: stretch;
}
.env-quad {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: stretch;
}
.env-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: stretch;
}

@media (min-width: 768px) {
    .env-row-50-50 {
        grid-template-columns: 1fr 1fr;
    }
    .env-trio {
        grid-template-columns: repeat(3, 1fr);
    }
    .env-quad {
        grid-template-columns: repeat(2, 1fr);
    }
}
@media (min-width: 1024px) {
    .env-row-60-40 {
        grid-template-columns: 3fr 2fr;
    }
    .env-quad {
        grid-template-columns: repeat(4, 1fr);
    }
}
</style>
