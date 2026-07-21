<template>
    <div class="env-dash" :class="{'env-dash--kiosk': isKiosk}">
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
            :title="noFilter ? 'No devices in fleet' : 'No devices match this filter'"
            :message="
                noFilter
                    ? 'Connect sensors to this organization to start monitoring.'
                    : 'No devices match the selected groups, locations or tags.'
            "
            :cta-label="noFilter ? undefined : 'Clear filters'"
            @cta="clearFilters"
        />

        <EnvironmentDashboard
            v-if="hasData"
            :d="dashboardData"
            :loading="loading"
            :refresh-interval="refreshInterval"
            @refresh="load"
            @open-filter="filterOpen = true"
            @pick-range="onPickRange"
            @set-interval="onSetInterval"
            @generate-report="onGenerateReport"
            @save-settings="onSaveSettings"
        />

        <DashboardState
            v-if="loading && !liveMetrics && !error"
            state="loading"
            title="Loading environment metrics"
        />

        <div v-if="reportBusy" class="env-toast">
            <i class="fas fa-spinner fa-spin" /> Generating report…
        </div>
        <div v-if="reportError" class="env-toast env-toast--error">
            <i class="fas fa-triangle-exclamation" /> {{ reportError }}
            <button type="button" @click="dismissReportError">Dismiss</button>
        </div>

        <DashRenameModal
            :visible="renameVisible"
            :name="renameName"
            :saving="renameSaving"
            @save="saveRename"
            @close="renameVisible = false"
        />

        <FilterModal
            :visible="filterOpen"
            title="Filter devices"
            match-label="devices"
            :match-count="allShellyIds.length"
            :sections="envFilterSections"
            :initial-state="envFilterState"
            @close="filterOpen = false"
            @apply-generic="applyEnvFilters"
        />
    </div>
</template>

<script setup lang="ts">
import type {EnergyBucket} from '@api/energy';
import {
    SENSOR_EVENTS_LIMITS,
    type SensorEventRow,
    type SensorEventsResponse,
    type SensorQueryResponse,
    type SensorQueryRow
} from '@api/sensor';
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import FilterModal, {
    type FilterSection
} from '@/components/core/FilterModal.vue';
import DashboardState from '@/components/dashboard/DashboardState.vue';
import DashRenameModal from '@/components/dashboard/DashRenameModal.vue';
import EnvironmentDashboard from '@/components/dashboard/environment/EnvironmentDashboard.vue';
import {buildEnvironmentDashboardData} from '@/components/dashboard/environment/environmentDashboard.mapper';
import {
    DEFAULT_ENV_SETTINGS,
    type EnvEventRow,
    type EnvHistoryRow,
    type EnvLiveReading,
    type EnvSensorInfo,
    type EnvSettings
} from '@/components/dashboard/environment/environmentDashboard.types';
import {useDomainDashboardChrome} from '@/composables/useDomainDashboardChrome';
import {fetchDashboardRecordSummary} from '@/helpers/dashboardRecord';
import {getDeviceName} from '@/helpers/device';
import {
    DEVICE_TYPE_LABELS,
    DEVICE_TYPES,
    type DeviceType,
    deviceTypeOf
} from '@/helpers/deviceTypeFilter';
import {buildLiveMetricsFromDevices} from '@/helpers/liveMetrics';
import {generateReportFile} from '@/helpers/reportGeneration';
import {useDashboardChromeStore} from '@/stores/dashboardChrome';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';
import * as ws from '@/tools/websocket';

// Readings pulled for the dashboard. One DB fan-out per kind server-side, so
// keep this to the kinds the tabs actually chart.
const ENV_QUERY_KINDS = [
    'temperature',
    'humidity',
    'illuminance',
    'co2',
    'tvoc',
    'pm25',
    'pm10',
    'pressure',
    'uv',
    'wind_speed',
    'precipitation',
    'battery'
];

const isKiosk = document.body.classList.contains('kiosk');
const route = useRoute();
const groupsStore = useGroupsStore();
const deviceStore = useDevicesStore();
const tagsStore = useTagsStore();
const locationsStore = useLocationsStore();

const groupsList = computed(() => Object.values(groupsStore.groups));
const tagsList = computed(() => Object.values(tagsStore.tags));
const locationsList = computed(() => Object.values(locationsStore.locations));

const dashboardId = computed(() => Number((route.params as {id: string}).id));
const dashboardName = ref('Environment');
const groupId = ref<number | null>(null);
const loading = ref(false);
const liveMetrics = ref<any>(null);
const error = ref<string | null>(null);

const history = ref<EnvHistoryRow[]>([]);
const events = ref<EnvEventRow[]>([]);
const granularity = ref<EnergyBucket>('1 hour');
const generatedAt = ref(Date.now());

// Comfort/air/daylight thresholds, persisted per-dashboard in chartSettings.
const settings = ref<EnvSettings>({...DEFAULT_ENV_SETTINGS});
const chartSettingsRaw = ref<Record<string, unknown>>({});

function defaultDateRange() {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    return {from: from.toISOString(), to: to.toISOString()};
}
const dateRange = ref(defaultDateRange());

// Resolve a range-chip preset key → concrete from/to (mirrors the energy page).
function onPickRange(p: {key: string; from?: string; to?: string}) {
    if (p.key === 'custom' && p.from && p.to) {
        // Date inputs are day-only; span the full to-day (inclusive) to 23:59:59.
        const from = new Date(`${p.from}T00:00:00.000Z`);
        const to = new Date(`${p.to}T23:59:59.999Z`);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to)
            return;
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

const groupName = computed(() =>
    groupId.value ? (groupsStore.groups[groupId.value]?.name ?? null) : null
);

// Funnel filter — reuses the app's FilterModal so location/group/tag filtering
// matches the energy dashboard. Empty set on a dimension = show all. Every list
// (charts, KPIs, sensor table) narrows through inScope so they stay in sync.
const filterOpen = ref(false);
const selectedDeviceTypes = ref<Set<DeviceType>>(new Set());
const selectedGroups = ref<Set<string>>(new Set());
const selectedLocations = ref<Set<string>>(new Set());
const selectedTags = ref<Set<string>>(new Set());
const selectedDevices = ref<Set<string>>(new Set());

function inScope(shellyID: string): boolean {
    const dev = deviceStore.devices[shellyID];
    if (!dev) return false;
    const groupIds = dev.groupIds ?? [];
    const tagIds = dev.tagIds ?? [];
    const locationId = dev.locationId ?? null;
    if (selectedDevices.value.size && !selectedDevices.value.has(shellyID))
        return false;
    if (
        selectedDeviceTypes.value.size &&
        !selectedDeviceTypes.value.has(deviceTypeOf(dev.source))
    )
        return false;
    if (
        selectedGroups.value.size &&
        !groupIds.some((g) => selectedGroups.value.has(String(g)))
    )
        return false;
    if (
        selectedTags.value.size &&
        !tagIds.some((t) => selectedTags.value.has(String(t)))
    )
        return false;
    if (
        selectedLocations.value.size &&
        !(locationId != null && selectedLocations.value.has(String(locationId)))
    )
        return false;
    return true;
}

// Devices that reported sensor data this window (before the funnel), for the
// Devices filter section — keyed by shellyID so the funnel matches by it.
const sensorDevices = computed(() => {
    const byId = new Map<number, {shellyId: string; name: string}>();
    for (const dev of liveMetrics.value?.devices ?? [])
        byId.set(dev.id, {shellyId: dev.shellyID, name: dev.name});
    const seen = new Set<number>();
    const out: {shellyId: string; name: string}[] = [];
    for (const id of [
        ...history.value.map((r) => r.deviceId),
        ...events.value.map((e) => e.deviceId)
    ]) {
        if (seen.has(id)) continue;
        seen.add(id);
        const info = byId.get(id);
        if (info) out.push(info);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
});

// One section per fleet-organising dimension; offered only when it has values,
// searchable once the list is long enough (same shape as the energy filter).
const envFilterSections = computed<FilterSection[]>(() => {
    const sections: FilterSection[] = [
        {
            key: 'deviceType',
            label: 'Device type',
            icon: 'fa-microchip',
            searchable: false,
            options: DEVICE_TYPES.map((t) => ({
                key: t,
                label: DEVICE_TYPE_LABELS[t]
            }))
        }
    ];
    const groups = groupsList.value;
    if (groups.length)
        sections.push({
            key: 'group',
            label: 'Groups',
            icon: 'fa-layer-group',
            searchable: groups.length > 8,
            options: groups.map((g) => ({key: String(g.id), label: g.name}))
        });
    const locations = locationsList.value;
    if (locations.length)
        sections.push({
            key: 'location',
            label: 'Locations',
            icon: 'fa-location-dot',
            searchable: locations.length > 8,
            options: locations.map((l) => ({key: String(l.id), label: l.name}))
        });
    const tags = tagsList.value;
    if (tags.length)
        sections.push({
            key: 'tag',
            label: 'Tags',
            icon: 'fa-tag',
            searchable: tags.length > 8,
            options: tags.map((t) => ({key: String(t.id), label: t.name}))
        });
    const devices = sensorDevices.value;
    if (devices.length)
        sections.push({
            key: 'device',
            label: 'Sensors',
            icon: 'fa-plug',
            searchable: true,
            options: devices.map((d) => ({key: d.shellyId, label: d.name}))
        });
    return sections;
});
const envFilterState = computed(() => ({
    deviceType: [...selectedDeviceTypes.value],
    group: [...selectedGroups.value],
    location: [...selectedLocations.value],
    tag: [...selectedTags.value],
    device: [...selectedDevices.value]
}));
function applyEnvFilters(state: Record<string, string[]>) {
    selectedDeviceTypes.value = new Set((state.deviceType ?? []) as DeviceType[]);
    selectedGroups.value = new Set(state.group ?? []);
    selectedLocations.value = new Set(state.location ?? []);
    selectedTags.value = new Set(state.tag ?? []);
    selectedDevices.value = new Set(state.device ?? []);
    filterOpen.value = false;
}
function clearFilters() {
    selectedDeviceTypes.value = new Set();
    selectedGroups.value = new Set();
    selectedLocations.value = new Set();
    selectedTags.value = new Set();
    selectedDevices.value = new Set();
}

// Devices this dashboard covers: its bound group (if any), else the whole
// fleet. The funnel narrows within this; nothing outside it is ever queried,
// so charts, events and the device count all stay consistent on a group board.
function inDashboardScope(shellyID: string): boolean {
    const gid = groupId.value;
    if (gid == null) return true;
    return (deviceStore.devices[shellyID]?.groupIds ?? []).includes(gid);
}

const allShellyIds = computed(() =>
    Object.keys(deviceStore.devices).filter(
        (id) => inDashboardScope(id) && inScope(id)
    )
);
const hasData = computed(() => allShellyIds.value.length > 0);

const liveDevices = computed(
    (): {id: number; shellyID: string; name: string; online?: boolean}[] =>
        (liveMetrics.value?.devices ?? []).filter((dev: {shellyID: string}) =>
            inScope(dev.shellyID)
        )
);
const scopedDeviceIds = computed(
    () => new Set(liveDevices.value.map((dev) => dev.id))
);

// No filter selected = every device passes (matches inScope). Lets the live
// paths short-circuit before liveDevices has resolved into scopedDeviceIds.
const noFilter = computed(
    () =>
        selectedDeviceTypes.value.size === 0 &&
        selectedGroups.value.size === 0 &&
        selectedLocations.value.size === 0 &&
        selectedTags.value.size === 0 &&
        selectedDevices.value.size === 0
);

function inScopeRow(deviceId: number): boolean {
    if (noFilter.value) return true;
    return scopedDeviceIds.value.has(deviceId);
}

function scopedReadings(vals: EnvLiveReading[]): EnvLiveReading[] {
    if (noFilter.value) return vals;
    return vals.filter((v) => scopedDeviceIds.value.has(v.deviceId));
}

// ── Derived inputs for the mapper ──

const liveEnv = computed(() => {
    const m = liveMetrics.value?.metrics ?? {};
    return {
        temperature: scopedReadings(m.temperature?.values ?? []),
        humidity: scopedReadings(m.humidity?.values ?? []),
        luminance: scopedReadings(m.luminance?.values ?? [])
    };
});

// Source + battery come from the history rows (the live metrics carry neither).
const sourceByDevice = computed(() => {
    const map = new Map<number, string>();
    for (const r of history.value) if (!map.has(r.deviceId)) map.set(r.deviceId, r.source);
    return map;
});
const batteryByDevice = computed(() => {
    const map = new Map<number, number>();
    for (const r of history.value)
        if (r.kind === 'battery' && !map.has(r.deviceId)) map.set(r.deviceId, r.value);
    return map;
});

const scopedHistory = computed(() =>
    history.value.filter((r) => inScopeRow(r.deviceId))
);
// Presence + Safety must narrow with the funnel too, exactly like history.
const scopedEvents = computed(() =>
    events.value.filter((e) => inScopeRow(e.deviceId))
);

// A real environmental sensor reports an ambient reading (live or history),
// not a device chip temp. Keeps the Sensors list + count to true sensors.
const envSensorIds = computed(() => {
    const ids = new Set<number>();
    for (const r of [
        ...liveEnv.value.temperature,
        ...liveEnv.value.humidity,
        ...liveEnv.value.luminance
    ])
        ids.add(r.deviceId);
    for (const r of scopedHistory.value) ids.add(r.deviceId);
    return ids;
});

const sensorInfos = computed((): EnvSensorInfo[] =>
    liveDevices.value
        .filter((dev) => envSensorIds.value.has(dev.id))
        .map((dev) => ({
            id: dev.id,
            shellyId: dev.shellyID,
            name: dev.name,
            online: dev.online ?? false,
            source: sourceByDevice.value.get(dev.id) ?? 'builtin',
            battery: batteryByDevice.value.get(dev.id) ?? null
        }))
);

const dashboardData = computed(() =>
    buildEnvironmentDashboardData({
        meta: {
            scopeName: groupName.value ?? 'All sensors',
            from: dateRange.value.from,
            to: dateRange.value.to,
            granularity: granularity.value,
            generatedAt: generatedAt.value
        },
        live: liveEnv.value,
        history: scopedHistory.value,
        events: scopedEvents.value,
        sensors: sensorInfos.value,
        settings: settings.value,
        loading: loading.value
    })
);

// ── Fetching ──

function pickBucket(from: string, to: string): EnergyBucket {
    const hours = (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
    if (hours <= 12) return '15 minutes';
    if (hours <= 72) return '1 hour';
    if (hours <= 24 * 90) return '1 day';
    return '1 month';
}

function mapRows(rows: SensorQueryRow[]): EnvHistoryRow[] {
    // Environment = ambient only. Drop source='internal' (device chip temps
    // from switches/lights); those are electronics temps, not room temps, and
    // the live KPI path already ignores them.
    return rows
        .filter((r) => r.source !== 'internal')
        .map((r) => ({
            bucket: r.bucket,
            deviceId: r.device,
            kind: r.kind,
            value: Number(r.value),
            min: r.min,
            max: r.max,
            source: r.source,
            channel: r.channel,
            sampleCount: r.sampleCount
        }));
}

// Name events at the page — the raw SensorEventRow carries no device name.
// Kind filtering is left to the mapper (its presence/safety kind sets).
function mapEvents(rows: SensorEventRow[]): EnvEventRow[] {
    return rows.map((r) => ({
        ts: r.ts,
        deviceId: r.device,
        name: getDeviceName(
            r.shellyID ? deviceStore.devices[r.shellyID]?.info : undefined,
            r.shellyID ?? undefined
        ),
        kind: r.kind,
        state: r.state,
        source: r.source
    }));
}

function scopeParam(): Record<string, unknown> {
    return groupId.value ? {scope: {groupId: groupId.value}} : {};
}

async function queryHistory(
    kinds: string[],
    from: string,
    to: string,
    bucket: EnergyBucket
): Promise<EnvHistoryRow[]> {
    const res = await ws.sendRPC<SensorQueryResponse>(
        'FLEET_MANAGER',
        'sensor.query',
        {from, to, kinds, bucket, ...scopeParam()}
    );
    return mapRows(res?.items ?? []);
}

async function loadHistory() {
    const {from, to} = dateRange.value;
    if (!from || !to) return;
    const bucket = pickBucket(from, to);
    granularity.value = bucket;
    generatedAt.value = Date.now();
    history.value = await queryHistory(ENV_QUERY_KINDS, from, to, bucket);
}

// Sensor.Events takes a required shellyID allowlist (no group/tag scope yet),
// so read the scoped device ids directly. Presence + safety derive from these.
async function loadEvents() {
    const {from, to} = dateRange.value;
    const ids = allShellyIds.value;
    if (!from || !to || ids.length === 0) {
        events.value = [];
        return;
    }
    const capped = ids.slice(0, SENSOR_EVENTS_LIMITS.maxDevicesPerQuery);
    if (capped.length < ids.length)
        console.warn(
            `[Environment] events limited to ${capped.length} of ${ids.length} devices`
        );
    const res = await ws.sendRPC<SensorEventsResponse>(
        'FLEET_MANAGER',
        'sensor.events',
        {from, to, devices: capped}
    );
    events.value = mapEvents(res?.items ?? []);
}

async function fetchLiveMetrics() {
    if (groupId.value) {
        liveMetrics.value = await ws.sendRPC('FLEET_MANAGER', 'fleet.GetMetrics', {
            scope: {groupId: groupId.value}
        });
    } else if (allShellyIds.value.length > 0) {
        liveMetrics.value = buildLiveMetricsFromDevices(deviceStore.devices);
    }
}

async function fetchDashboardRecord() {
    const dashboard = await fetchDashboardRecordSummary(dashboardId.value);
    if (dashboard) {
        dashboardName.value = dashboard.name ?? 'Environment';
        groupId.value = dashboard.groupId;
    }
}

// Comfort/air thresholds ride in chartSettings.envThresholds (no schema
// change); missing/legacy dashboards fall back to the defaults.
async function fetchDashboardSettings() {
    const res = await ws.sendRPC<{chartSettings?: Record<string, unknown>}>(
        'FLEET_MANAGER',
        'dashboard.getsettings',
        {dashboardId: dashboardId.value}
    );
    const chart = res?.chartSettings ?? {};
    chartSettingsRaw.value = chart;
    const stored = chart.envThresholds;
    if (stored && typeof stored === 'object') {
        settings.value = {
            ...DEFAULT_ENV_SETTINGS,
            ...(stored as Partial<EnvSettings>)
        };
    }
}

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
        await fetchDashboardSettings();
    } catch (err) {
        console.warn('[Environment] settings fetch failed:', err);
    }
    try {
        await fetchLiveMetrics();
    } catch (err) {
        console.warn('[Environment] live metrics fetch failed:', err);
    }
    try {
        await loadHistory();
    } catch (err) {
        console.warn('[Environment] history load failed:', err);
    }
    try {
        await loadEvents();
    } catch (err) {
        console.warn('[Environment] events load failed:', err);
    }
    loading.value = false;
}

// ── Report ──

const reportBusy = ref(false);
const reportError = ref<string | null>(null);
let reportAbort: AbortController | null = null;

function dismissReportError() {
    reportError.value = null;
}

function reportToken(): string {
    return (
        localStorage.getItem('dev_mode_token') ??
        sessionStorage.getItem('access_token') ??
        ''
    );
}

async function downloadFile(file: string, name: string): Promise<void> {
    const token = reportToken();
    const res = await fetch(`/api/reports/download/${file}`, {
        credentials: 'include',
        headers: token ? {Authorization: `Bearer ${token}`} : {}
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
}

async function onGenerateReport(opts: {
    format: string;
    granularity: string;
    source?: string;
    sections: string[];
}) {
    if (reportBusy.value || !dateRange.value.from || !dateRange.value.to) return;
    reportBusy.value = true;
    reportError.value = null;
    reportAbort?.abort();
    reportAbort = new AbortController();
    try {
        const fileRef = await generateReportFile(
            ws,
            {
                // Report.Generate contract (report.ts): top-level kind+format,
                // env params validated downstream — granularity, not bucket.
                kind: 'environment',
                format: opts.format,
                from: dateRange.value.from,
                to: dateRange.value.to,
                granularity: opts.granularity,
                dashboardId: dashboardId.value,
                // Omit source when 'All'; sections_enabled honours the toggles.
                ...(opts.source ? {source: opts.source} : {}),
                sections_enabled: opts.sections,
                // A filtered view exports exactly what's on screen (its device
                // set); an unfiltered view uses the dashboard's own scope.
                ...(noFilter.value
                    ? scopeParam()
                    : {devices: allShellyIds.value})
            },
            `${dashboardName.value} environment`,
            {signal: reportAbort.signal}
        );
        const wantHtml = opts.format === 'html' && fileRef.htmlFile;
        const file = wantHtml ? (fileRef.htmlFile as string) : fileRef.file;
        if (!file) throw new Error('Report produced no file');
        await downloadFile(
            file,
            `${fileRef.name}.${opts.format === 'html' ? 'html' : 'csv'}`
        );
    } catch (err: any) {
        if (
            err?.name === 'ReportPollAbortedError' ||
            err?.name === 'ReportCancelledError'
        )
            return;
        reportError.value = err?.message ?? 'Failed to generate report';
        console.error('[Environment] report error:', err);
    } finally {
        reportBusy.value = false;
    }
}

// ── Settings (comfort/air thresholds) ──

async function onSaveSettings(next: EnvSettings) {
    const prev = settings.value; // roll back the optimistic apply on failure
    settings.value = next;
    try {
        const chartSettings = {...chartSettingsRaw.value, envThresholds: next};
        await ws.sendRPC('FLEET_MANAGER', 'dashboard.setsettings', {
            dashboardId: dashboardId.value,
            chartSettings
        });
        chartSettingsRaw.value = chartSettings;
    } catch (err: any) {
        settings.value = prev;
        console.error('[Environment] save settings failed:', err);
        reportError.value = err?.message ?? 'Failed to save settings';
    }
}

// ── Auto-refresh: live snapshot only; history follows a live range. Interval
// is user-picked from the toolbar (0 = off), same control as the energy view. ──

function rangeIsLive(to: string): boolean {
    return Math.abs(new Date(to).getTime() - Date.now()) < 2 * 60 * 60 * 1000;
}

const refreshInterval = ref(60_000);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    if (refreshInterval.value <= 0) return;
    refreshTimer = setInterval(async () => {
        try {
            await fetchLiveMetrics();
            if (dateRange.value.to && rangeIsLive(dateRange.value.to)) {
                dateRange.value = {
                    ...dateRange.value,
                    to: new Date().toISOString()
                };
            }
        } catch (err) {
            console.error('[Environment] refresh error:', err);
        }
    }, refreshInterval.value);
}

function onSetInterval(ms: number) {
    refreshInterval.value = ms;
    startRefresh();
}

watch(
    dateRange,
    () => {
        loadHistory().catch(() => {});
        loadEvents().catch(() => {});
    },
    {deep: true}
);

watch(allShellyIds, (ids) => {
    if (ids.length > 0 && !groupId.value && !liveMetrics.value) load();
});

onMounted(async () => {
    // Filter dimensions the scope picker never loaded (locations especially).
    void Promise.allSettled([
        tagsStore.fetchTags(),
        locationsStore.fetchLocations()
    ]);
    await load();
    startRefresh();
});

onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer);
    reportAbort?.abort();
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
.env-toast {
    position: fixed;
    right: var(--space-5);
    bottom: var(--space-5);
    z-index: var(--z-toast);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
    box-shadow: var(--shadow-lg);
}
.env-toast--error {
    border-color: rgba(var(--color-danger-rgb), 0.4);
    color: var(--color-danger-text);
}
.env-toast--error button {
    margin-left: var(--space-2);
    background: none;
    border: none;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
}
</style>
