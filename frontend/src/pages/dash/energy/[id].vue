<template>
    <div class="energy-dash" :class="{'energy-dash--kiosk': isKiosk}">
        <DashboardState
            v-if="error"
            state="error"
            title="Failed to load metrics"
            :error="error"
            @retry="load"
        />
        <DashboardState
            v-else-if="store.loading"
            state="loading"
            title="Loading energy data…"
        />
        <DashboardState
            v-else-if="!hasData"
            state="empty"
            icon="fas fa-bolt"
            title="No devices in fleet"
            message="Connect devices to this organization to start monitoring energy."
        />
        <EnergyVoltaine
            v-else
            :key="renderKey"
            :d="voltaineData"
            :initial-tab="activeTab"
            @open-filter="filterOpen = true"
            @open-settings="openSettings"
            @refresh="load"
            @pick-range="onPickRange"
            @generate-report="onGenerateReport"
            @tab-change="onTabChange"
        />

        <!-- Real, functional settings (tariff editor, device/meter picker, scope, PV, carbon) -->
        <EnergySettingsPanel
            v-if="showSettings && store.settings"
            :settings="store.settings"
            :name="dashboardName"
            :group-id="groupId"
            :groups="groupsList"
            :devices="store.liveDevices"
            :tariffs="savedTariffs"
            :dashboard-id="dashboardId"
            @close="showSettings = false"
            @save="saveSettings"
            @reload-tariffs="reloadTariffs"
        />

        <FilterModal
            :visible="filterOpen"
            title="Filter devices"
            match-label="devices"
            :match-count="deviceListRows.length"
            :sections="energyFilterSections"
            :initial-state="energyFilterState"
            @close="filterOpen = false"
            @apply-generic="applyEnergyFilters"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch, watchEffect} from 'vue';
import {useRoute} from 'vue-router';
import DashboardState from '@/components/dashboard/DashboardState.vue';
import EnergySettingsPanel from '@/components/dashboard/energy/EnergySettingsPanel.vue';
import FilterModal, {type FilterSection} from '@/components/core/FilterModal.vue';
import EnergyVoltaine from '@/components/dashboard/energy/EnergyVoltaine.vue';
import {buildEnergyDashboardData} from '@/components/dashboard/energy/energyDashboard.mapper';
import {averageByTag, countVoltageEvents, deltaLabel, hourlyProfile, roleKwh} from '@/components/dashboard/energy/energyLive.helpers';
import {useDashboardNavigation} from '@/composables/useDashboardNavigation';
import {useDashboardScope} from '@/composables/useDashboardScope';
import {useReportProgress} from '@/composables/useReportProgress';
import {currencySymbol as currencySymbolFor} from '@/helpers/currencies';
import {normaliseDashboardSettings} from '@/helpers/dashboardSettings';
import {filterByScope} from '@/helpers/dashboardScopeFilter';
import {
    DEVICE_TYPE_LABELS,
    DEVICE_TYPES,
    type DeviceType,
    deviceTypeOf,
    filterByDeviceType
} from '@/helpers/deviceTypeFilter';
import {readEnvNumber} from '@/helpers/env';
import {logSettledRejections, resolveOptional} from '@/helpers/promiseUtils';
import {
    generateReportFile,
    ReportCancelledError,
    ReportPollAbortedError
} from '@/helpers/reportGeneration';
import {useAuthStore} from '@/stores/auth';
import {useDashboardChromeStore} from '@/stores/dashboardChrome';
import {useDashboardsStore} from '@/stores/dashboards';
import {useDevicesStore} from '@/stores/devices';
import {useEnergyDashboardStore} from '@/stores/energyDashboard';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import type {DashboardSettings} from '@/types/dashboard';
import type {
    DashColumnDef,
    DashDeviceRow,
    DashGaugeConfig,
    DashInsight,
    DashKpiMetric,
    DeviceTimePoint,
    PanelScope,
    TimePoint
} from '@/types/dashboard-components';

// ── State ──

const isKiosk = document.body.classList.contains('kiosk');
const route = useRoute();
const {goToManage} = useDashboardNavigation();
const store = useEnergyDashboardStore();
const groupsStore = useGroupsStore();
const tagsStore = useTagsStore();
const locationsStore = useLocationsStore();
const dashboardsStore = useDashboardsStore();
const deviceStore = useDevicesStore();
const authStore = useAuthStore();
const toast = useToastStore();

const scopeApi = useDashboardScope({scopeKey: () => authStore.currentUserId});

const dashboardId = computed(() => Number((route.params as {id: string}).id));
const dashboardName = ref('Energy');
const groupId = ref<number | null>(null);
const chartView = ref<'kwh' | 'cost'>('kwh');
const error = ref<string | null>(null);
const showSettings = ref(false);



const DEFAULT_EMISSION_FACTOR = readEnvNumber(
    'VITE_DEFAULT_EMISSION_FACTOR_G_PER_KWH',
    414
);


const groupsList = computed(() => Object.values(groupsStore.groups));
const allShellyIds = computed(() => Object.keys(deviceStore.devices));
const hasData = computed(
    () => groupId.value !== null || allShellyIds.value.length > 0
);

const currencySymbol = computed(() =>
    currencySymbolFor(store.settings?.currency)
);

function defaultDateRange() {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    return {from: from.toISOString(), to: to.toISOString()};
}

const dateRange = ref(defaultDateRange());
// Bumped after each data (re)load so the imperatively drawn charts remount fresh.
const renderKey = ref(0);
// Active dashboard tab — preserved across renderKey remounts (so refresh / lazy
// loads don't kick the user back to Overview) and drives lazy per-tab fetches.
const activeTab = ref('overview');
// Tabs whose heavy history fetch has already run for the current window. Cleared
// on a range change. Power → historical metrics; energy → hourly breakdown.
const loadedTabs = new Set<string>();
// Fetch a tab's heavy data on first open; returns true when a fetch ran.
async function ensureTabData(tab: string): Promise<boolean> {
    if (tab === 'power' && !loadedTabs.has('power')) {
        loadedTabs.add('power');
        await fetchHistoricalMetrics();
        return true;
    }
    if (tab === 'energy' && !loadedTabs.has('energy')) {
        loadedTabs.add('energy');
        await fetchHourlyBreakdown();
        return true;
    }
    return false;
}
async function onTabChange(tab: string) {
    activeTab.value = tab;
    // Remount only when new data arrived — the imperative charts redraw on mount.
    if (await ensureTabData(tab)) renderKey.value++;
}

// Resolve a Voltaine range-preset key → concrete from/to and apply it.
function onPickRange(p: {key: string; from?: string; to?: string}) {
    if (p.key === 'custom' && p.from && p.to) {
        // Date inputs are day-only; span the full to-day (inclusive) to 23:59:59.
        const from = new Date(`${p.from}T00:00:00.000Z`);
        const to = new Date(`${p.to}T23:59:59.999Z`);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return;
        dateRange.value = {from: from.toISOString(), to: to.toISOString()};
        return;
    }
    const to = new Date();
    const from = new Date(to);
    if (p.key === '24h') from.setDate(to.getDate() - 1);
    else if (p.key === '7d') from.setDate(to.getDate() - 7);
    else if (p.key === '30d') from.setDate(to.getDate() - 30);
    else if (p.key === '90d') from.setDate(to.getDate() - 90);
    else if (p.key === 'month') from.setDate(1);
    else if (p.key === 'last_month') {
        from.setMonth(from.getMonth() - 1, 1);
        to.setDate(0);
    } else if (p.key === 'ytd') from.setMonth(0, 1);
    else if (p.key === 'last_year') {
        from.setFullYear(from.getFullYear() - 1, 0, 1);
        to.setFullYear(to.getFullYear() - 1, 11, 31);
    }
    dateRange.value = {from: from.toISOString(), to: to.toISOString()};
}

const granularity = computed((): 'hour' | 'day' | 'month' => {
    const diffDays =
        (new Date(dateRange.value.to).getTime() -
            new Date(dateRange.value.from).getTime()) /
        (1000 * 60 * 60 * 24);
    if (diffDays <= 1.5) return 'hour';
    if (diffDays <= 35) return 'day';
    return 'month';
});

const rangeDays = computed(() => {
    const ms =
        new Date(dateRange.value.to).getTime() -
        new Date(dateRange.value.from).getTime();
    return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
});


const liveTotalPower = computed(() =>
    store.liveDevices.reduce((sum, d) => sum + d.power, 0)
);

function debugTiming(label: string, startedAt: number) {
    console.debug(`[Energy] ${label} ${Math.round(performance.now() - startedAt)}ms`);
}

// ── Live status metrics (voltage / PF / frequency) ──
// One pass over device status accumulating avg + min/max for each metric — the
// six computeds below all read this, instead of re-scanning devices six times.
interface LiveAcc {
    sum: number;
    count: number;
    min: number;
    max: number;
}
const liveStats = computed(() => {
    const mk = (): LiveAcc => ({sum: 0, count: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY});
    const voltage = mk();
    const pf = mk();
    const freq = mk();
    const add = (a: LiveAcc, v: number | undefined) => {
        if (typeof v !== 'number') return;
        a.sum += v;
        a.count++;
        if (v < a.min) a.min = v;
        if (v > a.max) a.max = v;
    };
    for (const d of store.liveDevices) {
        const s = deviceStore.devices[d.shellyId]?.status;
        if (!s) continue;
        for (let i = 0; i < 5; i++) {
            add(voltage, s[`em:${i}`]?.voltage ?? s[`em1:${i}`]?.voltage ?? s[`switch:${i}`]?.voltage);
            add(pf, s[`em:${i}`]?.pf ?? s[`em1:${i}`]?.pf);
            add(freq, s[`em:${i}`]?.freq ?? s[`em1:${i}`]?.freq ?? s[`switch:${i}`]?.freq ?? s[`pm1:${i}`]?.freq);
        }
    }
    const stat = (a: LiveAcc) => ({
        avg: a.count ? a.sum / a.count : null,
        min: Number.isFinite(a.min) ? a.min : null,
        max: Number.isFinite(a.max) ? a.max : null
    });
    return {voltage: stat(voltage), pf: stat(pf), freq: stat(freq)};
});

const avgVoltage = computed(() => liveStats.value.voltage.avg);
const avgFrequency = computed(() => liveStats.value.freq.avg);
const avgPowerFactor = computed(() => liveStats.value.pf.avg);
const voltageRange = computed(() => ({min: liveStats.value.voltage.min, max: liveStats.value.voltage.max}));
const powerFactorRange = computed(() => ({min: liveStats.value.pf.min, max: liveStats.value.pf.max}));
const frequencyRange = computed(() => ({min: liveStats.value.freq.min, max: liveStats.value.freq.max}));

// Per-phase load from 3-phase EM status (em:0 carries a_/b_/c_ legs).
const PHASE_LEGS = [
    {name: 'L1', key: 'a'},
    {name: 'L2', key: 'b'},
    {name: 'L3', key: 'c'}
];
const phaseLines = computed(() => {
    const watts = [0, 0, 0];
    const volts: number[][] = [[], [], []];
    const amps = [0, 0, 0];
    let any = false;
    for (const d of store.liveDevices) {
        const status = deviceStore.devices[d.shellyId]?.status;
        if (!status) continue;
        for (let m = 0; m < 3; m++) {
            const em = status[`em:${m}`];
            if (!em) continue;
            PHASE_LEGS.forEach((leg, i) => {
                const p = em[`${leg.key}_act_power`];
                const v = em[`${leg.key}_voltage`];
                const a = em[`${leg.key}_current`];
                if (typeof p === 'number') {
                    watts[i] += p;
                    any = true;
                }
                if (typeof v === 'number') volts[i].push(v);
                if (typeof a === 'number') amps[i] += a;
            });
        }
    }
    if (!any) return [];
    const maxW = Math.max(...watts, 1);
    return PHASE_LEGS.map((leg, i) => ({
        name: leg.name,
        watts: Math.round(watts[i]),
        volts: volts[i].length ? volts[i].reduce((s, x) => s + x, 0) / volts[i].length : 0,
        amps: Math.round(amps[i] * 100) / 100,
        pct: Math.round((watts[i] / maxW) * 100)
    }));
});


const liveReturnedEnergy = computed(() => {
    const devs = store.liveDevices;
    let sum = 0;
    let found = false;
    for (const d of devs) {
        const status = deviceStore.devices[d.shellyId]?.status;
        if (!status) continue;
        for (let i = 0; i < 5; i++) {
            const v = status[`em1data:${i}`]?.total_act_ret_energy;
            if (typeof v === 'number') {
                sum += v / 1000;
                found = true;
            }
            const v2 = status[`emdata:${i}`]?.total_act_ret;
            if (typeof v2 === 'number') {
                sum += v2 / 1000;
                found = true;
            }
            const v3 = status[`switch:${i}`]?.ret_aenergy?.total;
            if (typeof v3 === 'number') {
                sum += v3 / 1000;
                found = true;
            }
        }
    }
    return found ? sum : null;
});

const totalReturned = computed(() => {
    const histTotal = histReturned.value.reduce((s, p) => s + p.value, 0);
    if (histTotal > 0) return histTotal;
    return liveReturnedEnergy.value ?? 0;
});

// Solar / grid metrics


const peakPower = computed(() => {
    const data = histPower.value;
    if (!data.length) return null;
    return Math.max(...data.map((d) => d.value));
});

// Backend stores g CO₂e/kWh; this page works in kg/kWh.
const ENV_DEFAULT_FACTOR_KG_PER_KWH = 0.414;
const co2Factor = computed(() => {
    const g = store.settings?.emissionFactorGPerKWh ?? null;
    return g !== null ? g / 1000 : ENV_DEFAULT_FACTOR_KG_PER_KWH;
});


const co2Avoided = computed(() => {
    const ret = totalReturned.value;
    if (ret <= 0) return null;
    return ret * co2Factor.value;
});



// Cost delta — independent from consumption delta (tariff changes affect cost differently).
// Declared before kpiMetrics since kpiMetrics's computed accesses both during template render.




function mainMeterIdsFromSettings(
    settings: Pick<DashboardSettings, 'chartSettings'> | null | undefined
): string[] {
    const value = settings?.chartSettings?.mainMeterIds;
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

// ── Insights ──


// ── Consumption chart data ──

function resolveRate(bucket: string): number {
    const s = store.settings;
    if (!s) return 0;
    if (s.tariffMode === 'single') return s.tariff ?? 0;
    const dayRate = s.dayRate ?? s.tariff ?? 0;
    const nightRate = s.nightRate ?? s.tariff ?? 0;
    const dayStartH = Number.parseInt(s.dayStart?.slice(0, 2) ?? '7', 10);
    const dayEndH = Number.parseInt(s.dayEnd?.slice(0, 2) ?? '23', 10);
    // Hourly buckets classify by their hour (UTC, matching the backend). Day/month
    // buckets sit at 00:00 and span both windows, so blend by the day-hour share —
    // classifying a whole day by getUTCHours()===0 would price everything at night.
    if (granularity.value === 'hour') {
        const hour = new Date(bucket).getUTCHours();
        return hour >= dayStartH && hour < dayEndH ? dayRate : nightRate;
    }
    const dayFraction = Math.max(0, Math.min(24, dayEndH - dayStartH)) / 24;
    return dayFraction * dayRate + (1 - dayFraction) * nightRate;
}

// The funnel filter narrows the whole view: when any dimension is selected, the
// headline totals/charts use only the period rows for the surviving devices.
const funnelActive = computed(
    () =>
        selectedDeviceTypes.value.size > 0 ||
        selectedGroups.value.size > 0 ||
        selectedLocations.value.size > 0 ||
        selectedTags.value.size > 0 ||
        selectedDevices.value.size > 0
);
const filteredPeriodCurrent = computed(() => {
    const data = store.periodData?.current ?? [];
    if (!funnelActive.value) return data;
    const ids = new Set(scopedMeterRows.value.map((r) => r.deviceId));
    return data.filter((p) => ids.has(p.deviceId));
});
const filteredTotalConsumption = computed(() => filteredPeriodCurrent.value.reduce((sum, p) => sum + p.value, 0));

const consumptionChartData = computed((): TimePoint[] => {
    const data = filteredPeriodCurrent.value;
    if (chartView.value === 'cost' && store.settings) {
        return aggregateByBucket(data).map((p) => ({
            bucket: p.bucket,
            value: p.value * resolveRate(p.bucket)
        }));
    }
    return aggregateByBucket(data);
});

// Brush-to-compare on the consumption chart → Analytics.AttributeWindow.
// Composable enforces input validation (ISO format + 90-day cap) so the
// page just forwards whatever the chart emitted.



// Cost over time — consumption × tariff rate per bucket

// Consumption heatmap — day-of-week × hour-of-day (built from hourly fetch)
const hourlyHeatmapRaw = ref<{hour: number; day: number; value: number}[]>([]);



function aggregateByBucket(
    data: {bucket: string; value: number}[]
): TimePoint[] {
    const map = new Map<string, number>();
    for (const d of data) {
        map.set(d.bucket, (map.get(d.bucket) ?? 0) + d.value);
    }
    return [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([bucket, value]) => ({bucket, value}));
}

// ── Hourly data (from heatmap) ──

// Hourly breakdown — only meaningful when granularity is 'hour'.
// For day/month granularity, fetch hourly data separately.
const hourlyBreakdown = ref<number[]>(new Array(24).fill(0));

function buildFromPoints(points: any[]) {
    const hours = new Array(24).fill(0);
    const matrix: Record<string, number> = {};
    for (const point of points) {
        const d = new Date(point.bucket);
        const h = d.getUTCHours();
        const day = d.getUTCDay();
        const val = Number(point.value ?? 0);
        hours[h] += val;
        const key = `${day}-${h}`;
        matrix[key] = (matrix[key] ?? 0) + val;
    }
    hourlyBreakdown.value = hours;
    hourlyHeatmapRaw.value = Object.entries(matrix).map(([key, value]) => {
        const [day, hour] = key.split('-').map(Number);
        return {day, hour, value};
    });
}

async function fetchHourlyBreakdown() {
    const from = dateRange.value.from;
    const to = dateRange.value.to;
    try {
        // If already hourly granularity, use existing period data
        if (granularity.value === 'hour') {
            buildFromPoints(
                (store.periodData?.current ?? []).map((p) => ({
                    bucket: p.bucket,
                    value: p.value
                }))
            );
            return;
        }

        // For day/month ranges, fetch hourly data via fn_report_stats
        const commonParams = {
            from,
            to,
            tags: ['total_act_energy'],
            bucket: '1 hour'
        };
        const result = groupId.value
            ? await ws.sendRPC<{items: any[]}>(
                  'FLEET_MANAGER',
                  'energy.query',
                  {...commonParams, scope: {groupId: groupId.value}}
              )
            : await ws.sendRPC<{items: any[]}>(
                  'FLEET_MANAGER',
                  'energy.query',
                  commonParams
              );

        buildFromPoints(result?.items ?? []);
    } catch {
        buildFromPoints(
            (store.periodData?.current ?? []).map((p) => ({
                bucket: p.bucket,
                value: p.value
            }))
        );
    }
}

const hourlyData = computed((): number[] => hourlyBreakdown.value);

// ── Stacked chart data ──



// ── Device list ──


// Funnel filter — reuses the app's FilterModal to narrow the whole view across
// every dimension the fleet is organised by. Empty set on a dimension = show all.
const filterOpen = ref(false);
const selectedDeviceTypes = ref<Set<DeviceType>>(new Set());
const selectedGroups = ref<Set<string>>(new Set());
const selectedLocations = ref<Set<string>>(new Set());
const selectedTags = ref<Set<string>>(new Set());
const selectedDevices = ref<Set<string>>(new Set());

// One option per fleet-organising dimension; a dimension is offered only when it
// has values, and searchable once the list is long enough to need it.
const energyFilterSections = computed<FilterSection[]>(() => {
    const sections: FilterSection[] = [
        {key: 'deviceType', label: 'Device type', icon: 'fa-microchip', searchable: false, options: DEVICE_TYPES.map((t) => ({key: t, label: DEVICE_TYPE_LABELS[t]}))}
    ];
    const groups = groupsList.value;
    if (groups.length) sections.push({key: 'group', label: 'Groups', icon: 'fa-layer-group', searchable: groups.length > 8, options: groups.map((g) => ({key: String(g.id), label: g.name}))});
    const locations = Object.values(locationsStore.locations);
    if (locations.length) sections.push({key: 'location', label: 'Locations', icon: 'fa-location-dot', searchable: locations.length > 8, options: locations.map((l) => ({key: String(l.id), label: l.name}))});
    const tags = Object.values(tagsStore.tags);
    if (tags.length) sections.push({key: 'tag', label: 'Tags', icon: 'fa-tag', searchable: tags.length > 8, options: tags.map((t) => ({key: String(t.id), label: t.name}))});
    const devices = store.meterRows.map((r) => ({key: r.shellyId, label: r.deviceName})).sort((a, b) => a.label.localeCompare(b.label));
    if (devices.length) sections.push({key: 'device', label: 'Devices', icon: 'fa-plug', searchable: true, options: devices});
    return sections;
});
const energyFilterState = computed(() => ({
    deviceType: [...selectedDeviceTypes.value],
    group: [...selectedGroups.value],
    location: [...selectedLocations.value],
    tag: [...selectedTags.value],
    device: [...selectedDevices.value]
}));
function applyEnergyFilters(state: Record<string, string[]>) {
    selectedDeviceTypes.value = new Set((state.deviceType ?? []) as DeviceType[]);
    selectedGroups.value = new Set(state.group ?? []);
    selectedLocations.value = new Set(state.location ?? []);
    selectedTags.value = new Set(state.tag ?? []);
    selectedDevices.value = new Set(state.device ?? []);
    filterOpen.value = false;
}

// A device passes the funnel when it matches every dimension that has a selection.
function passesFunnel(shellyId: string): boolean {
    const m = membershipOf(shellyId);
    if (!m) return false;
    if (selectedDevices.value.size && !selectedDevices.value.has(shellyId)) return false;
    if (selectedGroups.value.size && !m.groupIds.some((g) => selectedGroups.value.has(String(g)))) return false;
    if (selectedTags.value.size && !m.tagIds.some((t) => selectedTags.value.has(String(t)))) return false;
    if (selectedLocations.value.size && !(m.locationId != null && selectedLocations.value.has(String(m.locationId)))) return false;
    return true;
}

// Labels are SSOT (DEVICE_TYPE_LABELS); icons are this view's presentation.



function typeOfRow(shellyID: string): DeviceType {
    return deviceTypeOf(deviceStore.devices[shellyID]?.source);
}

// Scoped meter rows — every per-device computed below derives from this so the
// scope picker and device-type filter narrow the entire page consistently.
const scopedMeterRows = computed(() => {
    const byScope = filterByScope(
        store.meterRows,
        (r) => membershipOf(r.shellyId),
        scopeApi.current.value
    );
    const byType = filterByDeviceType(
        byScope,
        (r) => typeOfRow(r.shellyId),
        selectedDeviceTypes.value
    );
    return byType.filter((r) => passesFunnel(r.shellyId));
});

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

const deviceListRows = computed((): DashDeviceRow[] => {
    return scopedMeterRows.value.map((r) => ({
        id: r.deviceId,
        shellyId: r.shellyId,
        name: r.deviceName,
        online: r.online,
        consumption: r.consumptionPeriod,
        power: r.livePower,
        share: r.share,
        hasEmChannels: r.hasEmChannels,
        hasEm1Channels: r.hasEm1Channels
    }));
});

// Tariff overlay bands — covers single/day_night/tou. TOU resolves the
// active schedule (weekend override + holidays applied) at render time.

// Per-group consumption rollup for the row-repeat panel below.


// ── Historical metric data (from DB, over selected date range) ──

interface HistMetricPoint {
    bucket: string;
    value: number;
}
const histPower = ref<HistMetricPoint[]>([]);
const histVoltage = ref<HistMetricPoint[]>([]);
const histCurrent = ref<HistMetricPoint[]>([]);
const histReturned = ref<HistMetricPoint[]>([]);

async function fetchHistoricalMetrics() {
    const from = dateRange.value.from;
    const to = dateRange.value.to;
    const g = granularity.value;

    const metricToTag: Record<string, string> = {
        power: 'power',
        voltage: 'voltage',
        current: 'current',
        returned_energy: 'total_act_ret_energy'
    };
    const granToBucket: Record<string, string> = {
        hour: '1 hour',
        day: '1 day',
        month: '1 month'
    };
    const bucket = granToBucket[g] ?? '1 hour';

    const fetcher = (metric: string) => {
        const params = {
            from,
            to,
            tags: [metricToTag[metric]],
            bucket
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

    const [powerRes, voltageRes, currentRes, returnedRes] = await Promise.all([
        resolveOptional('energy-dashboard', 'power history', fetcher('power')),
        resolveOptional(
            'energy-dashboard',
            'voltage history',
            fetcher('voltage')
        ),
        resolveOptional(
            'energy-dashboard',
            'current history',
            fetcher('current')
        ),
        resolveOptional(
            'energy-dashboard',
            'returned energy history',
            fetcher('returned_energy')
        )
    ]);

    histPower.value = mapHistData(powerRes?.items);
    histVoltage.value = mapHistData(voltageRes?.items);
    histCurrent.value = mapHistData(currentRes?.items);
    histReturned.value = mapHistData(returnedRes?.items);
}

function mapHistData(items: any[] | undefined): HistMetricPoint[] {
    if (!items?.length) return [];
    const map = new Map<string, number>();
    for (const item of items) {
        map.set(
            item.bucket,
            (map.get(item.bucket) ?? 0) + Number(item.value ?? 0)
        );
    }
    return [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([bucket, value]) => ({bucket, value}));
}

const histPowerChart = computed((): TimePoint[] => histPower.value);
const histReturnedChart = computed((): TimePoint[] => histReturned.value);

// Net energy = consumed - returned

// ── Stat cards (voltage, current, frequency, power factor) ──





// ── Day / night split ──

const dayNightSplit = computed(() => {
    const data = filteredPeriodCurrent.value;
    const s = store.settings;
    if (!data.length || !s) return {day: 0, night: 0};
    const dayStartH = Number.parseInt(s.dayStart?.slice(0, 2) ?? '7', 10);
    const dayEndH = Number.parseInt(s.dayEnd?.slice(0, 2) ?? '23', 10);
    const dayFraction = Math.max(0, Math.min(24, dayEndH - dayStartH)) / 24;
    const hourly = granularity.value === 'hour';
    let day = 0;
    let night = 0;
    for (const point of data) {
        // Hourly buckets classify exactly; day/month buckets span both windows and
        // are split by the day-hour share (else 00:00 buckets read as all-night).
        if (hourly) {
            const hour = new Date(point.bucket).getUTCHours();
            if (hour >= dayStartH && hour < dayEndH) day += point.value;
            else night += point.value;
        } else {
            day += point.value * dayFraction;
            night += point.value * (1 - dayFraction);
        }
    }
    return {day, night};
});

// Period cost from the day/night-aware resolveRate (the store's calculateCostFromFlat
// prices whole-day buckets at the night rate — a shared-store bug we route around here).
const periodTotalCost = computed(() => {
    if (!energyTariffConfigured.value || !store.settings) return null;
    const data = filteredPeriodCurrent.value;
    if (!data.length) return null;
    return aggregateByBucket(data).reduce((sum, p) => sum + p.value * resolveRate(p.bucket), 0);
});
// Keep the projection's ratio to the (uncorrected) store total, applied to the corrected total.
const periodProjectedCost = computed(() => {
    if (periodTotalCost.value === null) return null;
    const storeTotal = store.totalCost;
    const storeProjected = store.projectedMonthlyCost;
    return storeTotal && storeTotal > 0 && storeProjected !== null
        ? periodTotalCost.value * (storeProjected / storeTotal)
        : periodTotalCost.value;
});

// ── Location breakdown (fleet mode) ──

const locationData = computed(() => {
    if (groupId.value) return [];
    const data = store.periodData?.current ?? [];
    if (!data.length) return [];

    // Group by device, then map device to group via store
    const deviceConsumption = new Map<number, number>();
    for (const d of data) {
        deviceConsumption.set(
            d.deviceId,
            (deviceConsumption.get(d.deviceId) ?? 0) + d.value
        );
    }

    // Build shellyId -> groupId reverse map from groups store
    const shellyToGroup = new Map<string, number>();
    for (const g of Object.values(groupsStore.groups)) {
        for (const sid of g.devices) shellyToGroup.set(sid, g.id);
    }

    const groupTotals = new Map<
        number,
        {name: string; totalKwh: number; deviceCount: number}
    >();
    for (const [deviceId, kwh] of deviceConsumption) {
        const dev = store.liveDevices.find((d) => d.id === deviceId);
        if (!dev) continue;
        const gId = shellyToGroup.get(dev.shellyId) ?? 0;
        const gName = gId
            ? (groupsStore.groups[gId]?.name ?? 'Unknown')
            : 'Ungrouped';
        const entry = groupTotals.get(gId) ?? {
            name: gName,
            totalKwh: 0,
            deviceCount: 0
        };
        entry.totalKwh += kwh;
        entry.deviceCount++;
        groupTotals.set(gId, entry);
    }

    return [...groupTotals.entries()].map(([gId, v]) => ({
        groupId: gId,
        name: v.name,
        totalKwh: v.totalKwh,
        deviceCount: v.deviceCount
    }));
});

// ── Phase devices ──


// ── Meter table ──


const meterTableRows = computed((): DashDeviceRow[] => {
    const cs = currencySymbol.value;
    return scopedMeterRows.value.map((r) => ({
        id: r.deviceId,
        shellyId: r.shellyId,
        name: r.deviceName,
        online: r.online,
        consumption: r.consumptionPeriod,
        cost: r.costPeriod,
        power: r.livePower,
        share: r.share,
        hasEmChannels: r.hasEmChannels,
        hasEm1Channels: r.hasEm1Channels,
        _currency: cs
    }));
});


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
        dashboardName.value = dashboard.name ?? 'Energy';
        groupId.value = dashboard.scope?.groupId ?? null;
    }
}

const energyGroups = ref<{
    kind: {label: string; value: number; unit: string}[];
    utility: {label: string; value: number; unit: string}[];
}>({kind: [], utility: []});

// Measured PV generation (kWh) for the period, from generation-role meters.
const pvGenerationKwh = ref(0);
// Count of hourly buckets with voltage outside the EN 50160 ±10 % band (207–253 V).
const voltageEventCount = ref(0);
// Battery-role energy for the period (charged = import to battery, discharged = export).
const battery = ref<{has: boolean; charged: number; discharged: number}>({has: false, charged: 0, discharged: 0});
// EV-charger role delivered energy (kWh) for the period.
const evDeliveredKwh = ref(0);
// Average environment readings across the fleet for the period.
const env = ref<{temp: number | null; humidity: number | null; luminance: number | null; flow: number | null}>({temp: null, humidity: null, luminance: null, flow: null});
// deviceId → energy role / cost centre, from the logical-meter definitions.
const meterRoles = ref<Map<number, string>>(new Map());
const meterCostCenters = ref<Map<number, string>>(new Map());
const ROLE_LABELS: Record<string, string> = {
    grid: 'Grid',
    pv: 'Solar',
    battery: 'Battery',
    generator: 'Generator',
    ev_charge: 'EV',
    load: 'Load',
    aux: 'Aux',
    supply: 'Supply',
    production: 'Production',
    storage: 'Storage',
    usage: 'Usage'
};

async function fetchLogicalMeters() {
    const [r] = await Promise.allSettled([
        ws.sendRPC<{meters?: {role: string; costCenter?: string | null; points?: {deviceId: number}[]}[]}>(
            'FLEET_MANAGER',
            'energy.listlogicalmeters',
            groupId.value ? {scope: {groupId: groupId.value}} : {}
        )
    ]);
    logSettledRejections('Logical meters', {meters: r});
    const roles = new Map<number, string>();
    const centers = new Map<number, string>();
    if (r.status === 'fulfilled') {
        for (const m of r.value?.meters ?? []) {
            for (const p of m.points ?? []) {
                roles.set(p.deviceId, m.role);
                if (m.costCenter) centers.set(p.deviceId, m.costCenter);
            }
        }
    }
    meterRoles.value = roles;
    meterCostCenters.value = centers;
}

// A group scope, or no scope (whole fleet / all org meters) when ungrouped. The
// backend rejects scope.groupId=null, so fleet must omit scope entirely. Fleet must
// NOT use {devices: allShellyIds} — that array is capped at 500 and would drop data
// on larger fleets; a missing scope already means "all devices".
const energyScope = () => (groupId.value ? {scope: {groupId: groupId.value}} : {});
const groupByScope = energyScope;
const deviceScope = energyScope;

// Only run a query that can actually return something. Meter roles come from the
// previous load (empty on the very first, so we run to be safe); env sensors are
// visible in the live device status without any query.
function fleetHasBatteryOrEv(): boolean {
    if (meterRoles.value.size === 0) return true;
    for (const role of meterRoles.value.values()) if (role === 'battery' || role === 'ev_charge') return true;
    return false;
}
function fleetHasEnvSensors(): boolean {
    for (const d of store.liveDevices) {
        const s = deviceStore.devices[d.shellyId]?.status;
        if (!s) continue;
        for (const k in s) if (k.startsWith('temperature:') || k.startsWith('humidity:') || k.startsWith('illuminance:')) return true;
    }
    return false;
}

async function fetchEnergyGroups() {
    const base = {
        ...groupByScope(),
        from: dateRange.value.from,
        to: dateRange.value.to,
        tags: ['total_act_energy'],
        bucket: '1 day',
        totals: true
    };
    const genDevices = (store.settings?.pvGenerationRefs ?? []).map((r) => r.device).filter(Boolean);
    const runRoles = fleetHasBatteryOrEv();
    const runEnv = fleetHasEnvSensors();
    const [kindR, utilR, genR, voltR, roleActR, roleRetR, envR] = await Promise.allSettled([
        ws.sendRPC<{groups?: {label: string; value: number; unit: string}[]}>('FLEET_MANAGER', 'energy.query', {...base, groupBy: 'kind'}),
        ws.sendRPC<{groups?: {label: string; value: number; unit: string}[]}>('FLEET_MANAGER', 'energy.query', {...base, groupBy: 'utility'}),
        genDevices.length
            ? ws.sendRPC<{items?: {value: number}[]}>('FLEET_MANAGER', 'energy.query', {
                  devices: genDevices,
                  from: dateRange.value.from,
                  to: dateRange.value.to,
                  tags: ['total_act_energy'],
                  bucket: '1 day',
                  perDevice: false
              })
            : Promise.resolve({items: []}),
        ws.sendRPC<{items?: {bucket: string; tag: string; value: number}[]}>('FLEET_MANAGER', 'energy.query', {
            ...deviceScope(),
            from: dateRange.value.from,
            to: dateRange.value.to,
            tags: ['min_voltage', 'max_voltage'],
            bucket: '1 hour',
            perDevice: false
        }),
        runRoles
            ? ws.sendRPC<{groups?: {key: string; value: number}[]}>('FLEET_MANAGER', 'energy.query', {...base, groupBy: 'role'})
            : Promise.resolve({groups: []}),
        runRoles
            ? ws.sendRPC<{groups?: {key: string; value: number}[]}>('FLEET_MANAGER', 'energy.query', {...base, tags: ['total_act_ret_energy'], groupBy: 'role'})
            : Promise.resolve({groups: []}),
        runEnv
            ? ws.sendRPC<{items?: {tag: string; value: number}[]}>('FLEET_MANAGER', 'energy.query', {
                  ...deviceScope(),
                  from: dateRange.value.from,
                  to: dateRange.value.to,
                  tags: ['temperature', 'humidity', 'luminance'],
                  bucket: '1 hour',
                  perDevice: false
              })
            : Promise.resolve({items: []})
    ]);
    logSettledRejections('Energy groups', {kind: kindR, utility: utilR, generation: genR, voltage: voltR, role: roleActR, roleRet: roleRetR, env: envR});
    energyGroups.value = {
        kind: kindR.status === 'fulfilled' ? (kindR.value?.groups ?? []) : [],
        utility: utilR.status === 'fulfilled' ? (utilR.value?.groups ?? []) : []
    };
    pvGenerationKwh.value =
        genR.status === 'fulfilled' ? (genR.value?.items ?? []).reduce((s, r) => s + (r.value ?? 0), 0) : 0;
    voltageEventCount.value = voltR.status === 'fulfilled' ? countVoltageEvents(voltR.value?.items ?? []) : 0;
    const roleKwhFromResult = (r: PromiseSettledResult<{groups?: {key: string; value: number}[]}>, role: string) =>
        r.status === 'fulfilled' ? roleKwh(r.value?.groups, role) : 0;
    const roleKwhAny = (r: PromiseSettledResult<{groups?: {key: string; value: number}[]}>, roles: string[]) =>
        roles.reduce((sum, role) => sum + roleKwhFromResult(r, role), 0);
    const charged = roleKwhFromResult(roleActR, 'battery');
    const discharged = roleKwhFromResult(roleRetR, 'battery');
    battery.value = {has: charged > 0 || discharged > 0, charged, discharged};
    evDeliveredKwh.value = roleKwhAny(roleActR, ['ev_charge', 'ev', 'ev_charger']);
    env.value = envR.status === 'fulfilled' ? averageByTag(envR.value?.items ?? []) : {temp: null, humidity: null, luminance: null, flow: null};
}

// Prior mirror window (same span, ending where this window starts) → deltas.
const priorPeriod = ref<{consumption: number | null; cost: number | null}>({consumption: null, cost: null});
// deviceId → prior-window kWh, for the per-meter Δ column.
const priorByDevice = ref<Map<number, number>>(new Map());

async function fetchPriorPeriod() {
    const fromMs = new Date(dateRange.value.from).getTime();
    const span = new Date(dateRange.value.to).getTime() - fromMs;
    if (!(span > 0)) {
        priorPeriod.value = {consumption: null, cost: null};
        priorByDevice.value = new Map();
        return;
    }
    const priorFrom = new Date(fromMs - span).toISOString();
    const [priorR] = await Promise.allSettled([
        ws.sendRPC<{items?: {bucket: string; device?: number; value: number}[]}>('FLEET_MANAGER', 'energy.query', {
            ...deviceScope(),
            from: priorFrom,
            to: dateRange.value.from,
            tags: ['total_act_energy'],
            bucket: '1 day',
            perDevice: true
        })
    ]);
    logSettledRejections('Energy prior period', {prior: priorR});
    const items = priorR.status === 'fulfilled' ? (priorR.value?.items ?? []) : [];
    if (!items.length) {
        priorPeriod.value = {consumption: null, cost: null};
        priorByDevice.value = new Map();
        return;
    }
    const consumption = items.reduce((s, r) => s + (r.value ?? 0), 0);
    const cost = store.settings ? items.reduce((s, r) => s + (r.value ?? 0) * resolveRate(r.bucket), 0) : null;
    const byDevice = new Map<number, number>();
    for (const r of items) if (typeof r.device === 'number') byDevice.set(r.device, (byDevice.get(r.device) ?? 0) + (r.value ?? 0));
    priorByDevice.value = byDevice;
    priorPeriod.value = {consumption, cost};
}

async function fetchDashboardEnrichment(label: string) {
    const startedAt = performance.now();
    const [groups, prior, meters] = await Promise.allSettled([
        fetchEnergyGroups(),
        fetchPriorPeriod(),
        fetchLogicalMeters()
    ]);
    logSettledRejections(label, {groups, prior, meters});
    debugTiming(label, startedAt);
    renderKey.value++;
}

const byKindRows = computed(() => {
    const total = energyGroups.value.kind.reduce((sum, g) => sum + g.value, 0) || 1;
    return energyGroups.value.kind.map((g) => ({
        label: g.label,
        value: `${Math.round(g.value).toLocaleString('en-US')} kWh · ${Math.round((g.value / total) * 100)}%`
    }));
});
const utilityRows = computed(() =>
    energyGroups.value.utility.map((g) => ({
        name: g.label,
        label: `${Math.round(g.value).toLocaleString('en-US')} ${g.unit}`
    }))
);
const weekdaySplit = computed(() => {
    let weekdayKwh = 0;
    let weekendKwh = 0;
    let weekdayDays = 0;
    let weekendDays = 0;
    for (const p of consumptionChartData.value) {
        const dow = new Date(p.bucket).getUTCDay();
        if (dow === 0 || dow === 6) {
            weekendKwh += p.value;
            weekendDays++;
        } else {
            weekdayKwh += p.value;
            weekdayDays++;
        }
    }
    return {weekdayKwh, weekendKwh, weekdayDays, weekendDays};
});

const hourlyWeekday = computed(() => hourlyProfile(hourlyHeatmapRaw.value, (d) => d >= 1 && d <= 5, weekdaySplit.value.weekdayDays));
const hourlyWeekend = computed(() => hourlyProfile(hourlyHeatmapRaw.value, (d) => d === 0 || d === 6, weekdaySplit.value.weekendDays));

// Effective €/kWh — real average when cost is known, else the configured rate.
const effectiveRate = computed(() => {
    const c = store.totalConsumption ?? 0;
    const cost = store.totalCost ?? 0;
    if (c > 0 && cost > 0) return cost / c;
    return store.settings?.tariff ?? store.settings?.dayRate ?? 0;
});

// Cost allocation — by real cost centre when meters carry one, else by group.
const tenantRows = computed(() => {
    const label = (kwh: number) =>
        `${Math.round(kwh).toLocaleString('en-US')} kWh · ${currencySymbol.value}${Math.round(kwh * effectiveRate.value).toLocaleString('en-US')}`;
    if (meterCostCenters.value.size) {
        const totals = new Map<string, number>();
        for (const r of scopedMeterRows.value) {
            const center = meterCostCenters.value.get(r.deviceId);
            if (center) totals.set(center, (totals.get(center) ?? 0) + r.consumptionPeriod);
        }
        return [...totals.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, kwh]) => ({label: name, value: label(kwh)}));
    }
    return locationData.value.map((g) => ({label: g.name, value: label(g.totalKwh)}));
});

async function load() {
    error.value = null;
    loadedTabs.clear(); // refresh / retry — invalidate lazy per-tab caches
    const startedAt = performance.now();
    try {
        await store.fetchSettings(dashboardId.value);
        await fetchDashboardRecord();
    } catch (err) {
        console.error('[Energy] dashboard record load:', err);
        error.value = 'Failed to load dashboard data';
        return;
    }

    // Independent chart fetches — one failure must not blank the whole page.
    // Power-history + hourly are deferred to the tab that shows them (Power /
    // Energy); only the Overview core loads here.
    if (groupId.value) {
        const [period, live] = await Promise.allSettled([
            store.fetchPeriodData(
                groupId.value,
                dateRange.value.from,
                dateRange.value.to,
                granularity.value
            ),
            store.fetchLiveMetrics(groupId.value)
        ]);
        logSettledRejections('Energy', {period, live});
    } else if (allShellyIds.value.length > 0) {
        const [period] = await Promise.allSettled([
            store.fetchPeriodDataFleet(
                dateRange.value.from,
                dateRange.value.to,
                granularity.value
            )
        ]);
        logSettledRejections('Energy', {period});
        store.setLiveDevicesNoGroup(allShellyIds.value, deviceStore.devices);
    }
    // If the user is already on a heavy tab (refresh / retry), refetch its data.
    await ensureTabData(activeTab.value);
    debugTiming('primary load', startedAt);
    // Enrichment (groups/prior/meters) bumps renderKey once, after everything is
    // in — one remount per load instead of two (no empty-then-fill flash).
    await fetchDashboardEnrichment('Energy enrichment');
}


// ── Report generation ──


const reportMode = ref<'full' | 'single'>('full');
const reportKind = ref<'energy' | 'interval' | 'energy_dump'>('energy');
const reportFormat = ref<'html' | 'csv'>('html');
const reportSections = ref<string[]>(['demand', 'solar', 'battery', 'ev', 'tenant']);
const reportMetrics = ref<string[]>(['consumption']);
const reportGranularity = ref('day');
const reportPerDevice = ref(true);
const reportGenerating = ref(false);
const reportError = ref<string | null>(null);
const reportElapsed = ref(0);
const lastReport = ref<{name: string; url: string; htmlUrl?: string} | null>(null);
const reportProgress = useReportProgress();
const reportJobId = ref<string | null>(null);
let reportTimer: ReturnType<typeof setInterval> | null = null;
let reportPollAbort: AbortController | null = null;


// Energy report params from the current builder — shared by the generate
// button and "Save as template".
function currentEnergyReportParams() {
    const s = store.settings;
    return {
        ...(groupId.value ? {scope: {groupId: groupId.value}} : {}),
        from: dateRange.value.from,
        to: dateRange.value.to,
        granularity: reportGranularity.value,
        tariff: s?.tariff ?? 0,
        tariff_mode: s?.tariffMode ?? 'single',
        day_rate: s?.dayRate ?? 0,
        night_rate: s?.nightRate ?? 0,
        day_start: s?.dayStart ?? '07:00:00',
        day_end: s?.dayEnd ?? '23:00:00',
        currency: s?.currency ?? 'EUR',
        main_meter_ids: mainMeterIdsFromSettings(s),
        nominalVoltage: (s?.chartSettings?.nominalVoltage as number | undefined) ?? 230,
        nominalHz: (s?.chartSettings?.nominalHz as number | undefined) ?? 50,
        dashboardId: dashboardId.value
    };
}

// Save the current builder config as a reusable template.

async function saveSettings(
    updated: Partial<DashboardSettings & {groupId?: number | null; name?: string}>
) {
    const {groupId: newGroupId, name: newName, ...settings} = updated;
    let scopeChanged = false;
    if (newName && newName !== dashboardName.value) {
        const renamed = await dashboardsStore.update(dashboardId.value, {name: newName});
        if (renamed) dashboardName.value = renamed.name ?? newName;
    }
    if ('groupId' in updated) {
        const dashboard = await dashboardsStore.update(dashboardId.value, {
            scope: newGroupId == null ? null : {groupId: newGroupId}
        });
        if (!dashboard) return;
        const nextGroupId = dashboard.scope?.groupId ?? null;
        scopeChanged = nextGroupId !== groupId.value;
        groupId.value = nextGroupId;
    }
    if (Object.keys(settings).length > 0) {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'dashboard.setsettings', {
                dashboardId: dashboardId.value,
                ...normaliseDashboardSettings(settings)
            });
        } catch (err) {
            toast.error((err as {message?: string})?.message ?? 'Could not save settings');
            return;
        }
    }
    await store.fetchSettings(dashboardId.value);
    showSettings.value = false;
    // A new scope means every chart/table is showing the old scope's data.
    if (scopeChanged) await reloadForRange();
}

// Saved org tariffs for the settings panel's tariff picker; loaded lazily on open.
const savedTariffs = ref<{id: number; name: string; kind: string; currency: string}[]>([]);
let tariffsLoaded = false;
async function fetchTariffList() {
    try {
        const res = (await ws.sendRPC('FLEET_MANAGER', 'tariff.list', {})) as {
            items?: {id: number; name: string; kind: string; currency: string}[];
        };
        savedTariffs.value = res.items ?? [];
        tariffsLoaded = true;
    } catch (err) {
        toast.error((err as {message?: string})?.message ?? 'Could not load saved tariffs');
    }
}
async function openSettings() {
    showSettings.value = true;
    if (!tariffsLoaded) await fetchTariffList();
}
// The tariff editor created / edited an org tariff — refresh the picker list.
async function reloadTariffs() {
    await fetchTariffList();
}

// Report modal (in EnergyVoltaine) → real report.generate: map its picks, then run.
async function onGenerateReport(p: {
    kind: string;
    granularity: string;
    format?: string;
    perDevice?: boolean;
    metrics?: string[];
    sections?: string[];
}) {
    reportKind.value = (['energy', 'interval', 'energy_dump'].includes(p.kind) ? p.kind : 'energy') as typeof reportKind.value;
    reportMode.value = p.kind === 'interval' ? 'single' : 'full';
    if (['fifteen_minutes', 'hour', 'day', 'month'].includes(p.granularity)) reportGranularity.value = p.granularity;
    if (p.format === 'html' || p.format === 'csv') reportFormat.value = p.format;
    if (typeof p.perDevice === 'boolean') reportPerDevice.value = p.perDevice;
    if (p.metrics?.length) reportMetrics.value = p.metrics;
    if (p.sections) reportSections.value = p.sections;
    await generateReport();
}

async function generateReport() {
    stopReportPoll();
    const pollAbort = new AbortController();
    reportPollAbort = pollAbort;
    const isCurrentReport = () => reportPollAbort === pollAbort;
    reportGenerating.value = true;
    reportError.value = null;
    reportElapsed.value = 0;
    if (reportTimer) clearInterval(reportTimer);
    reportTimer = setInterval(() => {
        reportElapsed.value++;
    }, 1000);
    reportProgress.start();
    reportJobId.value = null;
    const progressOpts = {
        signal: pollAbort.signal,
        onStart: (id: string) => {
            reportJobId.value = id;
            reportProgress.setJobId(id);
        },
        onProgress: reportProgress.update
    };

    try {
        if (reportMode.value === 'full') {
            // Comprehensive report — energy summary or per-phase dump.
            const result = await generateReportFile(
                ws,
                {
                    kind: reportKind.value,
                    format: reportFormat.value,
                    sections_enabled: reportSections.value,
                    ...currentEnergyReportParams()
                },
                'energy_report',
                progressOpts
            );

            downloadReport(result);
        } else {
            // Single metric report
            if (!groupId.value) {
                // Fleet mode — fall through to full report since GenerateReport requires a group
                const s = store.settings;
                const result = await generateReportFile(
                    ws,
                    {
                        kind: 'energy',
                        from: dateRange.value.from,
                        to: dateRange.value.to,
                        granularity: reportGranularity.value,
                        tariff: s?.tariff ?? 0,
                        tariff_mode: s?.tariffMode ?? 'single',
                        day_rate: s?.dayRate ?? 0,
                        night_rate: s?.nightRate ?? 0,
                        day_start: s?.dayStart ?? '07:00:00',
                        day_end: s?.dayEnd ?? '23:00:00',
                        currency: s?.currency ?? 'EUR',
                        dashboardId: dashboardId.value
                    },
                    'energy_report',
                    progressOpts
                );
                downloadReport(result);
                return;
            }
            const result = await generateReportFile(
                ws,
                {
                    kind: 'interval',
                    format: reportFormat.value,
                    scope: {groupId: groupId.value},
                    metrics: reportMetrics.value,
                    from: dateRange.value.from,
                    to: dateRange.value.to,
                    granularity: reportGranularity.value,
                    per_device: reportPerDevice.value
                },
                reportMetrics.value.join('+'),
                progressOpts
            );

            downloadReport(result);
        }
    } catch (err: unknown) {
        if (
            isCurrentReport() &&
            !(err instanceof ReportCancelledError) &&
            !(err instanceof ReportPollAbortedError)
        ) {
            reportError.value =
                err instanceof Error
                    ? err.message
                    : 'Failed to generate report';
        }
    } finally {
        if (!isCurrentReport()) return;
        if (reportTimer) {
            clearInterval(reportTimer);
            reportTimer = null;
        }
        reportProgress.stop();
        reportGenerating.value = false;
        reportJobId.value = null;
        reportPollAbort = null;
    }
}

function stopReportPoll(): void {
    reportPollAbort?.abort();
    reportPollAbort = null;
}


async function downloadReport(result: any) {
    if (!result?.file) {
        reportError.value =
            'Report generated but no file returned. Check backend logs.';
        return;
    }
    const filename = result.file.split('/').pop() ?? result.file;
    const csvName = `${result.name ?? 'report'}.csv`;
    try {
        // dev_mode_token: localStorage (cross-tab). Zitadel access_token:
        // sessionStorage (tab-scoped, post-XSS migration).
        const token =
            localStorage.getItem('dev_mode_token') ??
            sessionStorage.getItem('access_token') ??
            '';
        const res = await fetch(`/api/reports/download/${filename}`, {
            credentials: 'include',
            headers: token ? {Authorization: `Bearer ${token}`} : {}
        });
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = csvName;
        link.click();
        URL.revokeObjectURL(url);
        const htmlFile = typeof result.html_file === 'string'
            ? result.html_file.split('/').pop()
            : null;
        lastReport.value = {
            name: csvName,
            url: `/api/reports/download/${filename}`,
            htmlUrl: htmlFile ? `/api/reports/download/${htmlFile}` : undefined
        };
    } catch (err: any) {
        reportError.value = err?.message ?? 'Failed to download report';
    }
}

// ── Watchers ──

// Refetch everything for the new window, THEN bump renderKey so the imperatively
// drawn charts remount against fresh data (not the previous window's data).
async function reloadForRange() {
    const startedAt = performance.now();
    loadedTabs.clear(); // new window — the deferred tab data is now stale
    if (groupId.value) {
        await Promise.allSettled([
            store.fetchPeriodData(groupId.value, dateRange.value.from, dateRange.value.to, granularity.value)
        ]);
    } else if (allShellyIds.value.length > 0) {
        await Promise.allSettled([
            store.fetchPeriodDataFleet(dateRange.value.from, dateRange.value.to, granularity.value)
        ]);
    }
    // Refetch the heavy data only for the tab the user is currently viewing.
    await ensureTabData(activeTab.value);
    debugTiming('range primary load', startedAt);
    // One remount, after enrichment — see load().
    await fetchDashboardEnrichment('Energy range enrichment');
}

watch(dateRange, () => void reloadForRange(), {deep: true});

// Watch for device store population — handle case where dashboard loads before devices arrive
watch(
    allShellyIds,
    (ids) => {
        if (ids.length > 0 && !groupId.value && !store.periodData) {
            load();
        }
    },
    {immediate: false}
);

let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startRefresh() {
    // 0 = "Off" — `??` would let 0 through and setInterval(fn, 0) hot-loops.
    const interval = store.settings?.refreshInterval || 0;
    if (interval <= 0) return;
    refreshTimer = setInterval(async () => {
        try {
            // Refresh live KPIs only. Advancing dateRange.to here would remount the
            // whole dashboard (via renderKey) every tick and reset the active tab.
            if (groupId.value) {
                await store.fetchLiveMetrics(groupId.value);
            } else if (allShellyIds.value.length > 0) {
                store.setLiveDevicesNoGroup(allShellyIds.value, deviceStore.devices);
            }
        } catch (err) {
            console.error('[Energy] refresh error:', err);
        }
    }, interval);
}

onMounted(async () => {
    await load();
    startRefresh();
    // Filter-dimension labels — non-blocking; sections appear once loaded.
    void Promise.allSettled([tagsStore.fetchTags(), locationsStore.fetchLocations()]);
});

onUnmounted(() => {
    stopReportPoll();
    if (refreshTimer) clearInterval(refreshTimer);
    if (reportTimer) clearInterval(reportTimer);
    chrome.clear();
});

const chrome = useDashboardChromeStore();
watchEffect(() => {
    chrome.register({
        onRefresh: () => {
            void load();
        },
        onShare: () => {},
        onToggleEdit: () => {},
        onAddWidget: () => {},
        onOpenManage: goToManage,
        onOpenSettings: () => {
            void openSettings();
        },
        settingsLabel: 'Energy settings',
        canEdit: false,
        canShare: false,
        loading: store.loading
    });
});

// ── Producer side of the energy dashboard SSOT contract ──
// buildEnergyDashboardData is the single mapper from the live energy layer to the
// presentational shape EnergyVoltaine consumes.
const energyTariffConfigured = computed(() => {
    const s = store.settings;
    if (!s) return false;
    if (s.tariffMode === 'day_night') return (s.dayRate ?? 0) > 0 || (s.nightRate ?? 0) > 0;
    if (s.tariffMode === 'tou') return (s.tariffWindows?.length ?? 0) > 0;
    return (s.tariff ?? 0) > 0;
});
const energyRangeLabel = computed(() => {
    const fmt = (iso: string) => {
        const d = new Date(iso);
        return `${d.toLocaleString('en-US', {month: 'short', timeZone: 'UTC'})} ${d.getUTCDate()}`;
    };
    return `${fmt(dateRange.value.from)} – ${fmt(dateRange.value.to)}, ${new Date(dateRange.value.to).getUTCFullYear()}`;
});
const voltaineData = computed(() =>
    buildEnergyDashboardData({
        rangeLabel: energyRangeLabel.value,
        deviceCount: allShellyIds.value.length,
        onlineCount: deviceListRows.value.filter((r) => r.online).length,
        currency: currencySymbol.value,
        tariffConfigured: energyTariffConfigured.value,
        hasGroups: groupsList.value.length > 0,
        hasKinds: false,
        hasSolar:
            totalReturned.value > 0 ||
            pvGenerationKwh.value > 0 ||
            battery.value.has ||
            evDeliveredKwh.value > 0,
        totalConsumptionKwh: filteredTotalConsumption.value,
        totalCost: periodTotalCost.value,
        projectedCost: periodProjectedCost.value,
        totalReturnedKwh: totalReturned.value,
        rangeDays: rangeDays.value,
        priorConsumptionKwh: priorPeriod.value.consumption,
        priorCost: priorPeriod.value.cost,
        consumption: consumptionChartData.value,
        returned: histReturnedChart.value,
        dayKwh: dayNightSplit.value.day,
        nightKwh: dayNightSplit.value.night,
        dayRate: store.settings?.dayRate ?? store.settings?.tariff ?? 0,
        nightRate: store.settings?.nightRate ?? store.settings?.tariff ?? 0,
        demandRate: (store.settings?.chartSettings?.demandRate as number | undefined) ?? 0,
        standingCharge: (store.settings?.chartSettings?.standingCharge as number | undefined) ?? 0,
        standingPeriod: (store.settings?.chartSettings?.standingPeriod as 'day' | 'month' | undefined) ?? 'month',
        vatPct: (store.settings?.chartSettings?.vatPct as number | undefined) ?? 0,
        avgVoltage: avgVoltage.value,
        avgPowerFactor: avgPowerFactor.value,
        avgFrequency: avgFrequency.value,
        peakKw: (peakPower.value ?? 0) / 1000,
        livePowerKw: (liveTotalPower.value ?? 0) / 1000,
        powerSeriesKw: histPowerChart.value.map((p) => ({bucket: p.bucket, value: p.value / 1000})),
        phases: phaseLines.value,
        voltageMin: voltageRange.value.min,
        voltageMax: voltageRange.value.max,
        pfMin: powerFactorRange.value.min,
        pfMax: powerFactorRange.value.max,
        freqMin: frequencyRange.value.min,
        freqMax: frequencyRange.value.max,
        voltageEventCount: voltageEventCount.value,
        consumers: deviceListRows.value.map((r) => ({id: r.id, name: r.name, online: r.online, consumption: r.consumption, power: r.power, share: r.share})),
        locations: locationData.value.map((l) => ({name: l.name, totalKwh: l.totalKwh})),
        meters: meterTableRows.value.map((r) => ({
            meter: r.name,
            role: meterRoles.value.has(r.id) ? (ROLE_LABELS[meterRoles.value.get(r.id) as string] ?? meterRoles.value.get(r.id) ?? '') : DEVICE_TYPE_LABELS[typeOfRow(r.shellyId)],
            live: `${Math.round(r.power)} W`,
            energy: `${Math.round(r.consumption)} kWh`,
            cost: r.cost > 0 ? `${currencySymbol.value}${Math.round(r.cost).toLocaleString('en-US')}` : '—',
            delta: deltaLabel(r.consumption, priorByDevice.value.get(r.id)),
            quality: r.online ? 'Good' : 'No data',
            status: r.online ? 'online' : 'offline',
            online: r.online
        })),
        hourly: hourlyData.value,
        co2LocationKg: filteredTotalConsumption.value * ((store.settings?.emissionFactorGPerKWh ?? DEFAULT_EMISSION_FACTOR) / 1000),
        co2AvoidedKg: co2Avoided.value ?? 0,
        co2BudgetKg: store.settings?.co2BudgetKg ?? null,
        emissionFactorMbm: store.settings?.emissionFactorMbmGPerKWh ?? null,
        pvGenerationKwh: pvGenerationKwh.value,
        pvMode: store.settings?.pvMode ?? '',
        hasBattery: battery.value.has,
        batteryChargedKwh: battery.value.charged,
        batteryDischargedKwh: battery.value.discharged,
        hasEv: evDeliveredKwh.value > 0,
        evDeliveredKwh: evDeliveredKwh.value,
        hourlyWeekday: hourlyWeekday.value,
        hourlyWeekend: hourlyWeekend.value,
        envTemp: env.value.temp,
        envHumidity: env.value.humidity,
        envLuminance: env.value.luminance,
        envFlow: env.value.flow,
        tenants: tenantRows.value,
        byKind: byKindRows.value,
        utility: utilityRows.value,
        weekdayKwh: weekdaySplit.value.weekdayKwh,
        weekendKwh: weekdaySplit.value.weekendKwh,
        weekdayDays: weekdaySplit.value.weekdayDays,
        weekendDays: weekdaySplit.value.weekendDays
    })
);
</script>

<style scoped>
/* Frosted-glass panel (app's --glass-1 surface), full width/height */
.energy-dash {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-4);
    background: var(--glass-1-bg);
    backdrop-filter: var(--glass-1-filter);
    -webkit-backdrop-filter: var(--glass-1-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-xl);
}

/* Header */
.ed-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
}
.ed-header__title {
    min-width: 0;
}
.ed-header__filters {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
}
/* Device-type filter chips */
.ed-type-filter {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}
.ed-type-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    cursor: pointer;
}
.ed-type-chip:hover {
    color: var(--color-text-secondary);
    border-color: var(--color-border);
}
.ed-type-chip--active {
    color: var(--color-primary);
    border-color: var(--color-primary);
    background: var(--color-primary-subtle);
}
.ed-title {
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
}
.ed-subtitle {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}

/* Export dropdown */
.ed-export-wrap {
    position: relative;
}
.ed-export-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: min(var(--floating-w-md), var(--floating-fluid));
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    z-index: 50;
    box-shadow: var(--shadow-lg);
    backdrop-filter: blur(var(--glass-1-blur));
}
.ed-export-hdr {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-3);
}
.ed-export-close {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: var(--space-0-5);
    font-size: var(--type-body);
}
.ed-export-close:hover {
    color: var(--color-text-secondary);
}
.ed-dropdown-enter-active {
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.ed-dropdown-leave-active {
    transition: all 0.15s ease;
}
.ed-dropdown-enter-from,
.ed-dropdown-leave-to {
    opacity: 0;
    transform: translateY(-6px) scale(0.97);
}

/* Error banner */
.ed-error-banner {
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
.ed-error-banner button {
    background: none;
    border: 1px solid var(--color-danger-text);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-3);
    font-size: var(--type-body);
    color: var(--color-danger-text);
    cursor: pointer;
    white-space: nowrap;
}
.ed-error-banner button:hover {
    background: rgba(var(--color-danger-rgb), 0.08);
}

/* Banners */
.ed-empty {
    border-radius: var(--radius-xl);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    padding: var(--space-8) var(--space-5);
    text-align: center;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.ed-fleet-banner {
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

/* Panel chrome (.ed-panel, .ed-panel-title, .ed-toggle, etc.) is
   imported globally via the unscoped style block below so extracted
   panel sub-components inherit the same look without duplicating CSS. */

.ed-group-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.ed-group-device {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    font-size: var(--type-body);
}
.ed-group-device__name {
    color: var(--color-text-secondary);
}
.ed-group-device__kwh {
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
    font-variant-numeric: tabular-nums;
}

/* Layout grids */
.ed-row-60-40 {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
    align-items: stretch;
}
.ed-row-50-50 {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
    align-items: stretch;
}
.ed-trio {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
    align-items: stretch;
}
.ed-quad {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
    align-items: stretch;
}
.ed-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

@media (min-width: 640px) {
    .ed-quad {
        grid-template-columns: repeat(2, 1fr);
    }
}
@media (min-width: 768px) {
    .ed-trio {
        grid-template-columns: repeat(3, 1fr);
    }
    .ed-row-50-50 {
        grid-template-columns: 1fr 1fr;
    }
}
@media (min-width: 1024px) {
    .ed-row-60-40 {
        grid-template-columns: 3fr 2fr;
    }
}
@media (min-width: 1280px) {
    .ed-quad {
        grid-template-columns: repeat(4, 1fr);
    }
}

/* Report generation */
.ed-report {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.ed-report-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3);
}
.ed-report-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.ed-report-label {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
}
.ed-report-select {
    background: var(--state-hover-bg);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm-plus);
    padding: var(--space-1-5) 10px;
    font-size: var(--type-body);
    color: var(--color-text-primary);
    cursor: pointer;
    outline: none;
}
.ed-report-select:focus {
    border-color: var(--color-primary);
}
.ed-report-btn {
    background: var(--color-success);
    color: var(--color-text-primary);
    border: none;
    border-radius: var(--radius-sm-plus);
    padding: var(--space-1-5) 14px;
    font-size: var(--type-body);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    transition: opacity 0.2s;
}
.ed-report-btn:hover:not(:disabled) {
    opacity: 0.9;
}
.ed-report-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.ed-report-progress {
    height: var(--space-0-5);
    background: var(--state-hover-bg);
    border-radius: var(--radius-xs);
    overflow: hidden;
}
.ed-report-progress-bar {
    width: 100%;
    height: 100%;
    background: var(--color-success-text);
    border-radius: var(--radius-xs);
    animation: reportPulse 1.5s ease infinite;
}
@keyframes reportPulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
}
.ed-report-error {
    font-size: var(--type-body);
    color: var(--color-danger-text);
}
.ed-report-result {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.ed-report-result a {
    color: var(--color-primary-text);
    text-decoration: none;
}
.ed-report-result a:hover {
    text-decoration: underline;
}
.ed-report-saved {
    margin-top: var(--space-3);
}
.ed-report-phase {
    font-size: var(--type-small);
    color: var(--color-text-tertiary);
    margin-top: var(--space-1);
}
.ed-report-mode {
    display: flex;
    gap: var(--space-0-5);
    background: var(--state-hover-bg);
    border-radius: var(--radius-sm-plus);
    padding: var(--space-0-5);
    margin-bottom: var(--space-3);
    width: fit-content;
}
.ed-report-mode-btn {
    background: none;
    border: none;
    padding: var(--space-1) var(--space-3);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s;
}
.ed-report-mode-btn:hover {
    color: var(--color-text-secondary);
}
.ed-report-mode-btn--active {
    background: var(--color-primary);
    color: var(--color-text-primary);
}
.ed-report-check {
    flex-direction: row;
    align-items: center;
    gap: var(--space-1-5);
    padding-bottom: var(--space-1-5);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.ed-report-check input {
    accent-color: var(--color-primary);
}
.ed-report-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5) var(--space-3);
}
.ed-report-metric {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.ed-report-metric input {
    accent-color: var(--color-primary);
}
.ed-report-scope {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
}

/* Toolbar action sheets (range / filters / report) opened from the dashboard */
.ed-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 10vh var(--space-4) var(--space-4);
    background: rgba(6, 8, 12, 0.72);
    backdrop-filter: blur(var(--glass-1-blur));
}
.ed-sheet {
    width: min(var(--floating-w-md), var(--floating-fluid));
    max-height: 80vh;
    overflow: auto;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-xl);
    padding: var(--space-4);
    box-shadow: var(--shadow-lg);
}
.ed-sheet__hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
}
.ed-sheet__hd h3 {
    font-size: var(--type-body);
    font-weight: 650;
    color: var(--color-text-primary);
}
.ed-sheet__x {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    font-size: var(--type-body);
}
.ed-sheet__x:hover {
    color: var(--color-text-secondary);
}
</style>
