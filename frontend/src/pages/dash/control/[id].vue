<template>
    <div class="control-dash" :class="{'control-dash--kiosk': isKiosk}">

        <!-- Header -->
        <div class="cd-header">
            <div>
                <h1 class="cd-title">{{ dashboardName }}</h1>
                <p v-if="groupName" class="cd-subtitle">{{ groupName }}</p>
            </div>
            <div class="cd-header__chips">
                <DashboardScopePicker
                    :scope="scopeApi.current.value"
                    :groups="groupsList"
                    :tags="tagsList"
                    @change="scopeApi.setScope"
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
            icon="fas fa-toggle-on"
            title="No devices in fleet"
            message="Connect devices to this organization to start monitoring."
        />

        <!-- No group banner -->
        <div v-if="!groupId && allShellyIds.length" class="cd-fleet-banner">
            <i class="fas fa-circle-info" style="color: var(--color-primary);" />
            Showing all {{ allShellyIds.length }} fleet devices. Assign devices to groups for per-group filtering.
        </div>

        <template v-if="hasData">
            <!-- KPI strip -->
            <DashKpiStrip :metrics="kpis" />

            <!-- Insights row -->
            <DashInsights :insights="insights" />

            <!-- Power over time — full width -->
            <div v-if="!isKiosk" class="cd-panel cd-panel--full">
                <h3 class="cd-panel-title">Power over time</h3>
                <DashTimeChart
                    :data="histPowerData"
                    type="area"
                    :color="chartColors.warning"
                    unit="W"
                    :height="240"
                    :loading="loading"
                    zoom
                />
            </div>

            <!-- Device control table (60%) + Fleet summary (40%) -->
            <div class="cd-row-60-40">
                <div class="cd-panel">
                    <h3 class="cd-panel-title">Device controls</h3>
                    <DataList
                        :rows="deviceRows"
                        :columns="cdColumns"
                        row-key="id"
                        empty-message="No devices online"
                    >
                        <template #cell-name="{row}">
                            <div class="cd-device-cell">
                                <span class="cd-status-dot" :class="row.online ? 'cd-status-dot--online' : 'cd-status-dot--offline'" />
                                <span class="cd-device-name">{{ row.name }}</span>
                            </div>
                        </template>
                        <template #cell-power="{row}">
                            {{ row.power !== null ? `${Math.round(row.power)} W` : '—' }}
                        </template>
                        <template #cell-voltage="{row}">
                            {{ row.voltage !== null ? `${row.voltage.toFixed(1)} V` : '—' }}
                        </template>
                        <template #cell-current="{row}">
                            {{ row.current !== null ? `${row.current.toFixed(2)} A` : '—' }}
                        </template>
                        <template #cell-action="{row}">
                            <button class="cd-toggle-btn" :disabled="toggling.has(row.shellyId)" @click="toggle(row.shellyId, row.name)">
                                <i v-if="toggling.has(row.shellyId)" class="fas fa-spinner fa-spin cd-toggle-spinner" />
                                <span v-else>Toggle</span>
                            </button>
                        </template>
                    </DataList>
                </div>

                <div v-if="!isKiosk" class="cd-stack">
                    <div class="cd-panel">
                        <h3 class="cd-panel-title">Power by device</h3>
                        <DashPowerBar :devices="powerByDevice" unit="W" :color="chartColors.warning" />
                    </div>
                    <div class="cd-panel">
                        <h3 class="cd-panel-title">Fleet summary</h3>
                        <DashFleetSummary
                            :total-devices="totalDeviceCount"
                            :online-devices="onlineCount"
                            :groups="groupCount"
                            :devices-by-type="devicesByType"
                            :loading="loading"
                        />
                    </div>
                </div>
            </div>
        </template>

        <DashboardState
            v-if="loading && !liveMetrics && !error"
            state="loading"
            title="Loading control metrics"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch, watchEffect} from 'vue';
import {useRoute} from 'vue-router';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import DashboardScopePicker from '@/components/dashboard/DashboardScopePicker.vue';
import DashboardState from '@/components/dashboard/DashboardState.vue';
import DashFleetSummary from '@/components/dashboard/DashFleetSummary.vue';
import DashInsights from '@/components/dashboard/DashInsights.vue';
import DashKpiStrip from '@/components/dashboard/DashKpiStrip.vue';
import DashPowerBar from '@/components/dashboard/DashPowerBar.vue';
import DashTimeChart from '@/components/dashboard/DashTimeChart.vue';
import {useDashboardNavigation} from '@/composables/useDashboardNavigation';
import {useDashboardScope} from '@/composables/useDashboardScope';
import {chartColors} from '@/helpers/chartUtils';
import {deviceMatchesScope} from '@/helpers/dashboardScopeFilter';
import {classifyDeviceType} from '@/helpers/dashboardUtils';
import {buildLiveMetricsFromDevices} from '@/helpers/liveMetrics';
import {logSettledRejections, resolveOptional} from '@/helpers/promiseUtils';
import {useAuthStore} from '@/stores/auth';
import {useDashboardChromeStore} from '@/stores/dashboardChrome';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useTagsStore} from '@/stores/tags';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import type {
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
const toastStore = useToastStore();
const authStore = useAuthStore();

const scopeApi = useDashboardScope({scopeKey: () => authStore.currentUserId});
const groupsList = computed(() => Object.values(groupsStore.groups));
const tagsList = computed(() => Object.values(tagsStore.tags));

const dashboardId = computed(() => Number((route.params as {id: string}).id));
const dashboardName = ref('Control');
const groupId = ref<number | null>(null);
const loading = ref(false);
const liveMetrics = ref<any>(null);
const toggling = ref(new Set<string>());
const totalDeviceCount = ref<number>(0);
const error = ref<string | null>(null);

const groupName = computed(() => {
    if (!groupId.value) return null;
    return groupsStore.groups[groupId.value]?.name ?? null;
});

// Scope predicate — every list below filters through this so the picker
// narrows the whole page (controls, KPIs, insights, power-by-device).
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

// API-reported total is fleet-wide; switch to scoped count when narrowed.
const scopedTotal = computed(() =>
    scopeApi.current.value.kind === 'fleet'
        ? totalDeviceCount.value
        : allShellyIds.value.length
);

const onlineCount = computed(() => devices.value.length);

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

// ── Switch on/off counts (from device store status) ──

// Read through statusOf so optimistic patches applied by toggle() show
// up in the counts immediately — without this the on/off tiles only
// updated once fetchLiveData() returned.
const switchesOn = computed(() => {
    let on = 0;
    for (const shellyId of allShellyIds.value) {
        for (let i = 0; i < 5; i++) {
            const sw = deviceStore.statusOf(shellyId, `switch:${i}`);
            if (sw?.output === true) on++;
        }
    }
    return on;
});

const switchesOff = computed(() => {
    let off = 0;
    for (const shellyId of allShellyIds.value) {
        for (let i = 0; i < 5; i++) {
            const sw = deviceStore.statusOf(shellyId, `switch:${i}`);
            if (sw?.output === false) off++;
        }
    }
    return off;
});

// ── Historical power data ──

const histPowerData = ref<TimePoint[]>([]);

async function fetchHistorical() {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const granularity = 'hour';

    const params = {
        from,
        to,
        tags: ['power'],
        bucket: granularity === 'hour' ? '1 hour' : '1 day'
    };
    const fetcher = groupId.value
        ? () =>
              ws.sendRPC<{items: any[]}>('FLEET_MANAGER', 'energy.query', {
                  ...params,
                  scope: {groupId: groupId.value}
              })
        : () =>
              ws.sendRPC<{items: any[]}>(
                  'FLEET_MANAGER',
                  'energy.query',
                  params
              );

    const res = await resolveOptional(
        'control-dashboard',
        'historical power',
        fetcher()
    );

    if (!res?.items?.length) {
        histPowerData.value = [];
        return;
    }

    const map = new Map<string, number>();
    for (const d of res.items) {
        map.set(d.bucket, (map.get(d.bucket) ?? 0) + Number(d.value ?? 0));
    }
    histPowerData.value = [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([bucket, value]) => ({bucket, value}));
}

// ── KPIs ──

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
        key: 'power',
        label: 'Power',
        value: metrics.value.power?.total ?? null,
        unit: 'W',
        live: true,
        decimals: 0
    },
    {
        key: 'on',
        label: 'On',
        value: switchesOn.value,
        unit: 'switches',
        decimals: 0
    },
    {
        key: 'off',
        label: 'Off',
        value: switchesOff.value,
        unit: 'switches',
        decimals: 0
    }
]);

// ── Insights ──

const insights = computed((): DashInsight[] => {
    const list: DashInsight[] = [];
    const offlineCount = Math.max(0, scopedTotal.value - onlineCount.value);

    if (switchesOn.value === 0 && switchesOff.value > 0) {
        list.push({
            key: 'all_off',
            color: 'blue',
            text: 'All switches are off'
        });
    }

    const powerByDevice = new Map<number, number>();
    for (const v of metrics.value.power?.values ?? []) {
        powerByDevice.set(
            v.deviceId,
            (powerByDevice.get(v.deviceId) ?? 0) + v.value
        );
    }
    for (const d of devices.value) {
        const deviceTotal = powerByDevice.get(d.id) ?? 0;
        if (deviceTotal > 3000) {
            list.push({
                key: `high_power_${d.id}`,
                color: 'warning',
                text: `${d.name} drawing ${Math.round(deviceTotal)} W`
            });
        }
    }

    if (offlineCount > 0) {
        list.push({
            key: 'offline',
            color: 'danger',
            text: `${offlineCount} device(s) offline`
        });
    }

    return list;
});

// ── Device rows ──

interface ControlDeviceRow {
    id: number;
    shellyId: string;
    name: string;
    online: boolean;
    power: number | null;
    voltage: number | null;
    current: number | null;
}

const cdColumns: DataColumn<ControlDeviceRow>[] = [
    {key: 'name', label: 'Device', role: 'primary'},
    {key: 'power', label: 'Power', role: 'meta', align: 'right'},
    {key: 'voltage', label: 'Voltage', role: 'meta', align: 'right'},
    {key: 'current', label: 'Current', role: 'meta', align: 'right'},
    {key: 'action', label: '', role: 'action', align: 'right'}
];

const deviceRows = computed((): ControlDeviceRow[] => {
    if (!liveMetrics.value) return [];
    const m = metrics.value;

    const powerMap = new Map<number, number>();
    for (const v of m.power?.values ?? [])
        powerMap.set(v.deviceId, (powerMap.get(v.deviceId) ?? 0) + v.value);

    const voltageMap = new Map<number, number>();
    for (const v of m.voltage?.values ?? [])
        if (!voltageMap.has(v.deviceId)) voltageMap.set(v.deviceId, v.value);

    const currentMap = new Map<number, number>();
    for (const v of m.current?.values ?? [])
        if (!currentMap.has(v.deviceId)) currentMap.set(v.deviceId, v.value);

    return devices.value.map((d) => ({
        id: d.id,
        shellyId: d.shellyID,
        name: d.name,
        online: true,
        power: powerMap.get(d.id) ?? null,
        voltage: voltageMap.get(d.id) ?? null,
        current: currentMap.get(d.id) ?? null
    }));
});

// ── Power by device (for bar chart) ──

const powerByDevice = computed((): {name: string; value: number}[] => {
    return deviceRows.value
        .filter((d) => d.power !== null && d.power > 0)
        .map((d) => ({name: d.name, value: d.power!}))
        .sort((a, b) => b.value - a.value);
});

// ── Toggle action ──

async function toggle(shellyId: string, deviceName: string) {
    toggling.value = new Set(toggling.value).add(shellyId);
    // Paint the predicted state immediately so the counters / any future
    // on-off column flip the moment the user clicks. The overlay's own
    // reconcile timer reads Shelly.GetStatus and converges, and a failed
    // RPC reverts the patch via handle.revert().
    // Only apply optimistic patch when we have a real boolean to flip.
    // A status object missing `output` (partial status, first connect)
    // would otherwise predict `output: true` regardless of actual state.
    try {
        await deviceStore.toggleSwitchOutput({
            shellyID: shellyId,
            id: 0
        });
        toastStore.success(`Toggled ${deviceName}`);
        void fetchLiveData().catch((err) => {
            console.warn('[control-dashboard] refresh failed:', err);
        });
    } catch (err: any) {
        toastStore.error(`Failed: ${err?.message ?? err}`);
    } finally {
        const next = new Set(toggling.value);
        next.delete(shellyId);
        toggling.value = next;
    }
}

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
        dashboardName.value = dashboard.name ?? 'Control';
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
        console.error('[Control] dashboard record load:', err);
        error.value = 'Failed to load dashboard data';
        loading.value = false;
        return;
    }
    const [live, hist] = await Promise.allSettled([
        fetchLiveData(),
        fetchHistorical()
    ]);
    logSettledRejections('Control', {live, historical: hist});
    loading.value = false;
}

// ── Auto-refresh (60s) ──

let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startRefresh() {
    refreshTimer = setInterval(async () => {
        try {
            await fetchLiveData();
        } catch (err) {
            console.error('[Control] refresh error:', err);
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
.control-dash {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    background: var(--color-surface-bg);
    min-height: 100%;
}
.control-dash--kiosk {
    padding: var(--space-3);
    gap: var(--space-3);
}

/* Header */
.cd-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
}
.cd-title {
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
}
.cd-subtitle {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.cd-header__chips {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.cd-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* Error banner */
.cd-error-banner {
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
.cd-error-banner button {
    background: none;
    border: 1px solid var(--color-danger-text);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-3);
    font-size: var(--type-body);
    color: var(--color-danger-text);
    cursor: pointer;
    white-space: nowrap;
}
.cd-error-banner button:hover {
    background: rgba(var(--color-danger-rgb), 0.08);
}

/* Banners */
.cd-empty {
    border-radius: var(--radius-xl);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    padding: var(--space-8) var(--space-5);
    text-align: center;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.cd-fleet-banner {
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
.cd-panel {
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
.cd-panel:hover {
    border-color: var(--color-border-medium);
    background: var(--color-surface-2);
}
@keyframes panel-enter {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}
.cd-panel--full {
    width: 100%;
}
.cd-panel-title {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
    letter-spacing: 0.01em;
    margin-bottom: var(--space-3);
}

/* 60/40 layout */
.cd-row-60-40 {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: stretch;
}
.cd-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

/* Control table cell helpers (DataList renders the table chrome) */
.cd-device-cell {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.cd-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
}
.cd-status-dot--online {
    background: var(--color-success-text);
}
.cd-status-dot--offline {
    background: var(--color-danger-text);
}
.cd-device-name {
    font-weight: 500;
    color: var(--color-text-primary);
}
.cd-toggle-btn {
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    padding: 3px var(--space-3);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    background: var(--state-hover-bg);
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;
    min-width: 60px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
}
.cd-toggle-btn:hover:not(:disabled) {
    background: var(--color-surface-raised);
}
.cd-toggle-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.cd-toggle-spinner { font-size: var(--icon-size-sm); /* icon-only */ }
.cd-spin {
    font-size: var(--type-body);
    animation: cd-spin 1s linear infinite;
}
@keyframes cd-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

@media (min-width: 1024px) {
    .cd-row-60-40 {
        grid-template-columns: 3fr 2fr;
    }
}
</style>
