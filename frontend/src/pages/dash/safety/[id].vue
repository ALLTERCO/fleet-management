<template>
    <div class="safety-dash" :class="{'safety-dash--kiosk': isKiosk}">

        <!-- Header -->
        <div class="sd-header">
            <div>
                <h1 class="sd-title">{{ dashboardName }}</h1>
                <p v-if="groupName" class="sd-subtitle">{{ groupName }}</p>
            </div>
            <div class="sd-header__chips">
                <DashboardScopePicker
                    :scope="scopeApi.current.value"
                    :groups="groupsList"
                    :tags="tagsList"
                    @change="scopeApi.setScope"
                />
                <DashFleetPulse
                    :current-count="onlineCount"
                    :history="uptimeTrend"
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
            icon="fas fa-shield-halved"
            title="No devices in fleet"
            message="Connect devices to this organization to start monitoring."
        />

        <!-- No group banner -->
        <div v-if="!groupId && allShellyIds.length" class="sd-fleet-banner">
            <i class="fas fa-circle-info" style="color: var(--color-primary);" />
            Showing all {{ allShellyIds.length }} fleet devices. Assign devices to groups for per-group filtering.
        </div>

        <template v-if="hasData">
            <!-- KPI strip -->
            <DashKpiStrip :metrics="kpis" />

            <!-- Insights row -->
            <DashInsights :insights="insights" />

            <!-- Uptime % over time — full width -->
            <div class="sd-panel sd-panel--full">
                <h3 class="sd-panel-title">Uptime % over time</h3>
                <DashTimeChart
                    :data="uptimeTrend"
                    type="area"
                    :color="chartColors.success"
                    unit="%"
                    :height="240"
                    :loading="loading"
                    zoom
                />
            </div>

            <!-- Status donut + Uptime gauge + Offline list — 3 across -->
            <div v-if="!isKiosk" class="sd-trio">
                <div class="sd-panel">
                    <h3 class="sd-panel-title">Device status</h3>
                    <DashStatusDonut :online="onlineCount" :offline="offlineCount" />
                </div>
                <div class="sd-panel">
                    <h3 class="sd-panel-title">Availability</h3>
                    <DashGauge :config="uptimePercentGauge" :loading="loading" />
                </div>
                <div class="sd-panel">
                    <h3 class="sd-panel-title">Offline devices</h3>
                    <div v-if="offlineDeviceNames.length === 0" class="sd-all-healthy">
                        All devices healthy
                    </div>
                    <ul v-else class="sd-offline-list">
                        <li v-for="name in offlineDeviceNames" :key="name" class="sd-offline-item">
                            <span class="sd-offline-dot" />
                            {{ name }}
                        </li>
                    </ul>
                </div>
            </div>

            <!-- Fleet bubbles — size by alarm count, color by status -->
            <div
                v-if="!isKiosk && fleetBubbleDevices.length > 0"
                class="sd-panel sd-panel--full"
            >
                <h3 class="sd-panel-title">Fleet at a glance</h3>
                <DashFleetBubbles
                    :devices="fleetBubbleDevices"
                    metric-label="status"
                />
            </div>

            <!-- Device health table — full width -->
            <div class="sd-panel sd-panel--full">
                <h3 class="sd-panel-title">Device health</h3>
                <DashDeviceList
                    :devices="deviceRows"
                    :columns="deviceColumns"
                    :page-size="10"
                    :searchable="deviceRows.length > 10"
                    :loading="loading"
                />
            </div>

        </template>

        <!-- Initial load — show DashboardState placeholder until the
             first metrics arrive; subsequent refreshes keep panels visible
             with their own per-component skeletons. -->
        <DashboardState
            v-if="loading && !liveMetrics && !error"
            state="loading"
            title="Loading safety metrics"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch, watchEffect} from 'vue';
import {useRoute} from 'vue-router';
import DashboardScopePicker from '@/components/dashboard/DashboardScopePicker.vue';
import DashboardState from '@/components/dashboard/DashboardState.vue';
import DashDeviceList from '@/components/dashboard/DashDeviceList.vue';
import DashFleetBubbles from '@/components/dashboard/DashFleetBubbles.vue';
import DashFleetPulse from '@/components/dashboard/DashFleetPulse.vue';
import DashGauge from '@/components/dashboard/DashGauge.vue';
import DashInsights from '@/components/dashboard/DashInsights.vue';
import DashKpiStrip from '@/components/dashboard/DashKpiStrip.vue';
import DashStatusDonut from '@/components/dashboard/DashStatusDonut.vue';
import DashTimeChart from '@/components/dashboard/DashTimeChart.vue';
import {useDashboardNavigation} from '@/composables/useDashboardNavigation';
import {useDashboardScope} from '@/composables/useDashboardScope';
import {useRollingBuffer} from '@/composables/useRollingBuffer';
import {chartColors} from '@/helpers/chartUtils';
import {deviceMatchesScope} from '@/helpers/dashboardScopeFilter';
import {formatUptime} from '@/helpers/dashboardUtils';
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
const dashboardName = ref('Safety');
const groupId = ref<number | null>(null);
const loading = ref(false);
const liveMetrics = ref<any>(null);
const totalDeviceCount = ref<number>(0);
const error = ref<string | null>(null);

const groupName = computed(() => {
    if (!groupId.value) return null;
    return groupsStore.groups[groupId.value]?.name ?? null;
});

// Scope predicate — every list below filters through this so the
// picker narrows the whole page (online, offline, KPIs, gauges).
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

// ── Derived metrics ──

const metrics = computed(() => liveMetrics.value?.metrics ?? {});
const devices = computed((): {id: number; shellyID: string; name: string}[] =>
    (liveMetrics.value?.devices ?? []).filter((d: {shellyID: string}) =>
        inScope(d.shellyID)
    )
);

// When the scope picker narrows to a group/tag/location, the API-reported
// total (which is fleet-wide or per-API-scope) is no longer the right
// denominator — fall back to the scoped count.
const scopedTotal = computed(() => {
    if (scopeApi.current.value.kind === 'fleet') return totalDeviceCount.value;
    return allShellyIds.value.length;
});

const onlineCount = computed(() => devices.value.length);
const offlineCount = computed(() =>
    Math.max(0, scopedTotal.value - onlineCount.value)
);

// Bubble graph: one bubble per online device, uniform size. Offline
// devices are already enumerated in the offline-list panel above.
const fleetBubbleDevices = computed(() =>
    devices.value.map((d) => ({
        id: d.id,
        name: d.name,
        metric: 1,
        status: 'online' as const
    }))
);

const uptimePercent = computed(() => {
    if (!scopedTotal.value) return 0;
    return Math.round((onlineCount.value / scopedTotal.value) * 100);
});

// Recompute average uptime from scoped values when scope is narrowed —
// the API-reported avg is across whatever the request scope was.
const avgUptimeSeconds = computed((): number | null => {
    const values: {deviceId: number; value: number}[] =
        metrics.value.uptime?.values ?? [];
    if (scopeApi.current.value.kind === 'fleet') {
        return metrics.value.uptime?.avg ?? null;
    }
    const inScopeIds = new Set(devices.value.map((d) => d.id));
    const scoped = values.filter((v) => inScopeIds.has(v.deviceId));
    if (!scoped.length) return null;
    return scoped.reduce((s, v) => s + v.value, 0) / scoped.length;
});

// ── Uptime helpers ──

const avgUptimeFormatted = computed(() => {
    if (avgUptimeSeconds.value === null || avgUptimeSeconds.value === 0)
        return '—';
    return formatUptime(avgUptimeSeconds.value);
});

// ── Rolling uptime trend buffer ──

const {buffer: uptimeBuffer, push: pushUptime} = useRollingBuffer(60);

const uptimeTrend = computed((): TimePoint[] =>
    uptimeBuffer.value.map((entry) => {
        const d = new Date(entry.timestamp);
        const bucket = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        return {bucket, value: entry.value};
    })
);

function recordUptimeSnapshot() {
    if (!totalDeviceCount.value) return;
    pushUptime(uptimePercent.value);
}

// ── KPIs ──

const kpis = computed((): DashKpiMetric[] => [
    {
        key: 'uptime_pct',
        label: 'Online',
        value: uptimePercent.value,
        unit: '%',
        live: true,
        decimals: 0
    },
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
        key: 'avg_uptime',
        label: 'Avg Uptime',
        value: avgUptimeFormatted.value,
        decimals: 0
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
    } else if (onlineCount.value > 0) {
        list.push({
            key: 'all_online',
            color: 'success',
            text: `All ${onlineCount.value} devices online`
        });
    }

    const uptimeMap = new Map<number, number>();
    for (const v of metrics.value.uptime?.values ?? [])
        uptimeMap.set(v.deviceId, v.value);

    for (const d of devices.value) {
        const uptimeVal = uptimeMap.get(d.id);
        if (uptimeVal !== undefined && uptimeVal < 3600) {
            list.push({
                key: `restart_${d.id}`,
                color: 'warning',
                text: `${d.name} restarted recently`
            });
        }
    }

    return list;
});

// ── Device list ──

const deviceColumns: DashColumnDef[] = [
    {key: 'name', label: 'Device', align: 'left', sortable: true},
    {key: 'statusText', label: 'Status', width: '80px'},
    {key: 'uptimeFormatted', label: 'Uptime', sortable: true},
    {key: 'lastSeen', label: 'Last Seen'}
];

const deviceRows = computed((): DashDeviceRow[] => {
    if (!liveMetrics.value) return [];
    const m = metrics.value;

    const uptimeMap = new Map<number, number>();
    for (const v of m.uptime?.values ?? [])
        if (!uptimeMap.has(v.deviceId)) uptimeMap.set(v.deviceId, v.value);

    const rows = devices.value.map((d) => {
        const uptimeVal = uptimeMap.get(d.id) ?? null;
        return {
            id: d.id,
            shellyId: d.shellyID,
            name: d.name,
            online: true,
            statusText: 'Online',
            uptimeFormatted: uptimeVal !== null ? formatUptime(uptimeVal) : '—',
            lastSeen: 'Now',
            _uptimeSeconds: uptimeVal ?? Number.POSITIVE_INFINITY
        };
    });

    // Sort by uptime ascending — recently restarted devices first
    rows.sort(
        (a, b) => (a._uptimeSeconds as number) - (b._uptimeSeconds as number)
    );
    return rows;
});

// ── Offline device names (for right-column alert list) ──

const offlineDeviceNames = computed((): string[] => {
    const onlineSet = new Set(devices.value.map((d) => d.shellyID));
    return allShellyIds.value
        .filter((id) => !onlineSet.has(id))
        .map(
            (id) =>
                deviceStore.devices[id]?.info?.name ??
                deviceStore.devices[id]?.info?.id ??
                id
        );
});

// ── Gauges ──

const uptimePercentGauge = computed(
    (): DashGaugeConfig => ({
        value: uptimePercent.value,
        min: 0,
        max: 100,
        unit: '%',
        label: 'Uptime',
        color: chartColors.success
    })
);

// ── Data fetching ──

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
        dashboardName.value = dashboard.name ?? 'Safety';
        groupId.value = dashboard.scope?.groupId ?? null;
    }
}

async function fetchLiveData() {
    if (groupId.value) {
        const [metricsRes, capsRes] = await Promise.all([
            ws.sendRPC('FLEET_MANAGER', 'fleet.GetMetrics', {
                scope: {groupId: groupId.value}
            }),
            ws.sendRPC<any>('FLEET_MANAGER', 'fleet.GetCapabilities', {
                scope: {groupId: groupId.value}
            })
        ]);
        liveMetrics.value = metricsRes;
        totalDeviceCount.value = capsRes?.deviceCount ?? 0;
    } else if (allShellyIds.value.length > 0) {
        liveMetrics.value = buildLiveMetricsFromDevices(deviceStore.devices);
        totalDeviceCount.value = allShellyIds.value.length;
    }
}

async function load() {
    loading.value = true;
    error.value = null;
    try {
        await fetchDashboardRecord();
    } catch (err) {
        console.error('[Safety] dashboard record load:', err);
        error.value = 'Failed to load dashboard data';
        loading.value = false;
        return;
    }
    try {
        await fetchLiveData();
    } catch (err) {
        console.warn('[Safety] live data fetch failed:', err);
    }
    try {
        recordUptimeSnapshot();
    } catch (err) {
        console.warn('[Safety] uptime snapshot failed:', err);
    }
    loading.value = false;
}

// ── Auto-refresh (60s) ──

let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startRefresh() {
    refreshTimer = setInterval(async () => {
        try {
            await fetchLiveData();
            recordUptimeSnapshot();
        } catch (err) {
            console.error('[Safety] refresh error:', err);
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
.safety-dash {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    background: var(--color-surface-bg);
    min-height: 100%;
}
.safety-dash--kiosk {
    padding: var(--space-3);
    gap: var(--space-3);
}

/* Header */
.sd-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
}
.sd-header__chips {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.sd-title {
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
}
.sd-subtitle {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.sd-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* Error banner */
.sd-error-banner {
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
.sd-error-banner button {
    background: none;
    border: 1px solid var(--color-danger-text);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-3);
    font-size: var(--type-body);
    color: var(--color-danger-text);
    cursor: pointer;
    white-space: nowrap;
}
.sd-error-banner button:hover {
    background: rgba(var(--color-danger-rgb), 0.08);
}

/* Banners */
.sd-empty {
    border-radius: var(--radius-xl);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    padding: var(--space-8) var(--space-5);
    text-align: center;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.sd-fleet-banner {
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
.sd-panel {
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
.sd-panel:hover {
    border-color: var(--color-border-medium);
    background: var(--color-surface-2);
}
@keyframes panel-enter {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}
.sd-panel--full {
    width: 100%;
}
.sd-panel-title {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
    letter-spacing: 0.01em;
    margin-bottom: var(--space-3);
}

/* Layout grids */
.sd-row-60-40 {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: stretch;
}
.sd-trio {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: stretch;
}
.sd-quad {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: stretch;
}
.sd-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: stretch;
}

/* Offline list */
.sd-all-healthy {
    font-size: var(--type-body);
    color: var(--color-success-text);
    padding: var(--space-2) 0;
}
.sd-offline-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.sd-offline-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.sd-offline-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-danger-text);
    flex-shrink: 0;
}

@media (min-width: 768px) {
    .sd-trio {
        grid-template-columns: repeat(3, 1fr);
    }
}
@media (min-width: 1024px) {
    .sd-row-60-40 {
        grid-template-columns: 3fr 2fr;
    }
    .sd-quad {
        grid-template-columns: repeat(4, 1fr);
    }
}
@media (min-width: 768px) and (max-width: 1023px) {
    .sd-quad {
        grid-template-columns: repeat(2, 1fr);
    }
}
</style>
