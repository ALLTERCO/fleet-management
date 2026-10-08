<template>
    <div class="energy-dash" :class="{'energy-dash--kiosk': isKiosk}">
        <BackgroundProgressIndicator
            v-if="showSyncProgress"
            title="Energy history syncing"
            :detail="syncProgressDetail"
            :progress="syncProgressPct"
            progress-label="history loaded"
            :eta="syncProgressEta"
            :items="syncProgressItems"
        />
        <!-- A large report takes minutes; without this the Generate click looks
             like it did nothing until the file lands. -->
        <BackgroundProgressIndicator
            v-if="reportGenerating"
            title="Building your report"
            :detail="reportProgressDetail"
            :progress="reportProgressPct"
            progress-label="complete"
            :eta="reportElapsedLabel"
            :items="reportProgressItems"
        />
        <DashboardState
            v-if="error"
            state="error"
            title="Failed to load metrics"
            :error="error"
            @retry="load"
        />
        <DashboardLoadingSkeleton
            v-else-if="store.loading"
            variant="energy"
            label="Loading energy dashboard"
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
            :range-key="rangeKey"
            :recorded-bill-choices="recordedBillChoices"
            :selected-recorded-bill-id="selectedRecordedBillId"
            @open-filter="filterOpen = true"
            @open-settings="openSettings"
            @refresh="load"
            @pick-range="onPickRange"
            @generate-report="onGenerateReport"
            @tab-change="onTabChange"
            @select-recorded-bill="selectRecordedBill"
        />

        <!-- Real, functional settings (tariff editor, device/meter picker, scope, PV, carbon) -->
        <EnergySettingsPanel
            v-if="showSettings && store.settings"
            :settings="store.settings"
            :name="dashboardName"
            :group-id="groupId"
            :groups="groupsList"
            :devices="store.liveDevices"
            :assignment-devices="assignmentDevices"
            :locations="locationList"
            :tariffs="savedTariffs"
            :dashboard-id="dashboardId"
            :saving="savingSettings"
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
import {
    AC_ACTIVE_POWER_COMPONENTS,
    PHASE_ACTIVE_POWER_FIELDS
} from '@api/componentPower';
import type {TariffSpec} from '@api/tariff';
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import BackgroundProgressIndicator from '@/components/core/BackgroundProgressIndicator.vue';
import FilterModal, {type FilterSection} from '@/components/core/FilterModal.vue';
import DashboardLoadingSkeleton from '@/components/dashboard/DashboardLoadingSkeleton.vue';
import DashboardState from '@/components/dashboard/DashboardState.vue';
import DashRenameModal from '@/components/dashboard/DashRenameModal.vue';
import {
    findExactRecordedBills,
    type RecordedBillLookup,
    type RecordedUtilityBill,
    recordedBillIdentity,
    recordedBillIdentityLabel,
    recordedBillPeriodDate
} from '@/components/dashboard/energy/billReconciliation';
import EnergySettingsPanel from '@/components/dashboard/energy/EnergySettingsPanel.vue';
import EnergyVoltaine from '@/components/dashboard/energy/EnergyVoltaine.vue';
import {buildEnergyDashboardData} from '@/components/dashboard/energy/energyDashboard.mapper';
import {countVoltageEvents, deltaLabel, hourlyProfile, roleKwh} from '@/components/dashboard/energy/energyLive.helpers';
import {dashboardAdditionalCharges} from '@/components/dashboard/energy/tariffBill';
import {effectiveTariffTaxes} from '@/components/dashboard/energy/tariffTaxes';
import {useDomainDashboardChrome} from '@/composables/useDomainDashboardChrome';
import {useReportProgress} from '@/composables/useReportProgress';
import {
    estimateProgress,
    formatRemaining,
    type ProgressSample,
    progressPct
} from '@/helpers/backgroundProgress';
import {validateTimezone} from '@/helpers/channelValidators';
import {currencySymbol as currencySymbolFor} from '@/helpers/currencies';
import {fetchDashboardRecordSummary} from '@/helpers/dashboardRecord';
import {normaliseDashboardSettings} from '@/helpers/dashboardSettings';
import {getDeviceName} from '@/helpers/device';
import {
    DEVICE_TYPE_LABELS,
    DEVICE_TYPES,
    type DeviceType,
    deviceTypeOf,
    filterByDeviceType
} from '@/helpers/deviceTypeFilter';
import {readEnvNumber} from '@/helpers/env';
import {tariffLocalTime} from '@/helpers/liveMetrics';
import {logSettledRejections, resolveOptional} from '@/helpers/promiseUtils';
import {
    generateReportFile,
    partialCoverageMessage,
    ReportCancelledError,
    ReportPollAbortedError
} from '@/helpers/reportGeneration';
import {useDashboardChromeStore} from '@/stores/dashboardChrome';
import {useDashboardsStore} from '@/stores/dashboards';
import {useDevicesStore} from '@/stores/devices';
import {
    type ProjectionRequest,
    useEnergyDashboardStore
} from '@/stores/energyDashboard';
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
const store = useEnergyDashboardStore();
const groupsStore = useGroupsStore();
const tagsStore = useTagsStore();
const locationsStore = useLocationsStore();
const dashboardsStore = useDashboardsStore();
const deviceStore = useDevicesStore();
const toast = useToastStore();


const dashboardId = computed(() => Number((route.params as {id: string}).id));
const dashboardName = ref('Energy');
const groupId = ref<number | null>(null);
const dashboardApiScope = ref<{
    groupId?: number;
    locationId?: number;
    tagId?: number;
}>({});
const error = ref<string | null>(null);
const showSettings = ref(false);
// True while saveSettings' RPC chain runs — the panel disables Save on it so a
// double-click cannot double-submit the rename / scope / setsettings calls.
const savingSettings = ref(false);

interface EnergySyncStatus {
    complete: boolean;
    progressPct: number;
    devicesTotal: number;
    devicesCatchingUp: number;
    channelsCatchingUp: number;
    historyRemainingSeconds: number;
    rollupPendingBuckets: number;
    oldestRollupAgeSeconds: number;
    devices: {
        shellyID: string;
        channel: number;
        lagSeconds: number;
        progressPct: number;
        rollupPendingBuckets: number;
    }[];
}

const syncStatus = ref<EnergySyncStatus | null>(null);
const syncProgressEtaSeconds = ref<number | null>(null);
let syncProgressSample: ProgressSample | null = null;
// Smoothed completion rate, carried between polls so the ETA drifts rather than jumps.
let syncProgressRate: number | null = null;
let syncProgressKind: 'history' | 'rollup' | null = null;
let syncProgressScope = '';
let rollupStartPending = 0;
let syncStatusTimer: ReturnType<typeof setInterval> | null = null;
const syncStatusPendingScopes = new Set<string>();

const showSyncProgress = computed(
    () =>
        (syncStatus.value?.devicesCatchingUp ?? 0) > 0 ||
        ((syncStatus.value?.rollupPendingBuckets ?? 0) > 0 &&
            (syncStatus.value?.oldestRollupAgeSeconds ?? 0) >= 60)
);
const syncProgressPct = computed(() => {
    const status = syncStatus.value;
    if (!status) return 0;
    // energy.syncstatus already withholds 100 while it reports work left, so
    // the history share is printed as the backend sent it.
    if (status.devicesCatchingUp > 0) return status.progressPct;
    if (rollupStartPending <= 0) return 0;
    return progressPct(
        ((rollupStartPending - status.rollupPendingBuckets) /
            rollupStartPending) *
            100,
        status.rollupPendingBuckets > 0
    );
});
const syncProgressEta = computed(() =>
    formatRemaining(syncProgressEtaSeconds.value)
);
const syncProgressDetail = computed(() => {
    const status = syncStatus.value;
    if (!status) return '';
    if (status.devicesCatchingUp > 0) {
        const deviceWord =
            status.devicesCatchingUp === 1 ? 'device' : 'devices';
        const channelDetail =
            status.channelsCatchingUp > status.devicesCatchingUp
                ? ` across ${status.channelsCatchingUp} channels`
                : '';
        return `${status.devicesCatchingUp} ${deviceWord} still syncing${channelDetail}`;
    }
    return `${status.rollupPendingBuckets.toLocaleString()} report buckets processing`;
});
const syncProgressItems = computed(() => {
    const status = syncStatus.value;
    if (!status) return [];
    const relevant = status.devices.filter(
        (device) =>
            device.lagSeconds > 10 * 60 ||
            device.rollupPendingBuckets > 0
    );
    const items = relevant.slice(0, 50).map((device) => {
            const lagHours = Math.ceil(device.lagSeconds / 3600);
            const lag =
                lagHours >= 24
                    ? `${Math.ceil(lagHours / 24)} days behind`
                    : `${lagHours} hours behind`;
            if (device.lagSeconds <= 10 * 60) {
                return (
                    `${device.shellyID} channel ${device.channel}: ` +
                    `${device.rollupPendingBuckets.toLocaleString()} report buckets processing`
                );
            }
            return (
                `${device.shellyID} channel ${device.channel}: ${lag}, ` +
                `${device.progressPct.toFixed(1)}%`
            );
        });
    const hidden = relevant.length - items.length;
    if (hidden > 0) items.push(`and ${hidden} more channels`);
    return items;
});

async function fetchSyncStatus(): Promise<void> {
    const scope = JSON.stringify(dashboardApiScope.value);
    if (syncStatusPendingScopes.has(scope)) return;
    syncStatusPendingScopes.add(scope);
    try {
        const params = dashboardScopeParams();
        const next = await ws.sendRPC<EnergySyncStatus>(
            'FLEET_MANAGER',
            'energy.syncstatus',
            params
        );
        const currentScope = JSON.stringify(dashboardApiScope.value);
        if (scope !== currentScope) return;
        syncStatus.value = next;
        const kind =
            next.devicesCatchingUp > 0
                ? 'history'
                : next.rollupPendingBuckets > 0
                  ? 'rollup'
                  : null;
        if (kind === 'rollup') {
            rollupStartPending = Math.max(
                rollupStartPending,
                next.rollupPendingBuckets
            );
        } else if (kind === null) {
            rollupStartPending = 0;
        }
        const remaining =
            kind === 'history'
                ? next.historyRemainingSeconds
                : next.rollupPendingBuckets;
        const sample = {remaining, sampledAtMs: Date.now()};
        // A different phase or scope is a different job — start its rate fresh
        // rather than carrying the previous one's speed into it.
        if (kind !== syncProgressKind || scope !== syncProgressScope) {
            syncProgressSample = null;
            syncProgressRate = null;
        }
        const estimate =
            kind === null
                ? null
                : estimateProgress(syncProgressSample, sample, syncProgressRate);
        syncProgressEtaSeconds.value = estimate?.remainingSeconds ?? null;
        syncProgressRate = estimate?.ratePerSecond ?? syncProgressRate;
        syncProgressSample = kind === null ? null : sample;
        syncProgressKind = kind;
        syncProgressScope = scope;
    } catch (err) {
        console.warn('[Energy] sync status:', err);
    } finally {
        syncStatusPendingScopes.delete(scope);
    }
}

function startSyncStatusPolling(): void {
    if (syncStatusTimer) clearInterval(syncStatusTimer);
    void fetchSyncStatus();
    syncStatusTimer = setInterval(() => void fetchSyncStatus(), 10_000);
}



const DEFAULT_EMISSION_FACTOR = readEnvNumber(
    'VITE_DEFAULT_EMISSION_FACTOR_G_PER_KWH',
    414
);


const groupsList = computed(() => Object.values(groupsStore.groups));
const locationList = computed(() => Object.values(locationsStore.locations));
const assignmentDevices = computed(() =>
    Object.values(deviceStore.devices)
        .map((device) => {
            const channels = new Set<number>();
            for (const key of Object.keys(device.status ?? {})) {
                const separator = key.lastIndexOf(':');
                if (separator < 0) continue;
                const component = key.slice(0, separator);
                const channel = Number(key.slice(separator + 1));
                if (
                    AC_ACTIVE_POWER_COMPONENTS.includes(component as never) &&
                    Number.isInteger(channel) &&
                    channel >= 0
                ) {
                    channels.add(channel);
                }
            }
            return {
                shellyId: device.shellyID,
                name: getDeviceName(device.info, device.shellyID),
                locationId: device.locationId ?? null,
                channels: [...channels].sort((a, b) => a - b)
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
);
const allShellyIds = computed(() => Object.keys(deviceStore.devices));
const hasData = computed(
    () => groupId.value !== null || allShellyIds.value.length > 0
);

const currencySymbol = computed(() =>
    currencySymbolFor(store.periodPricing?.currency ?? store.settings?.currency)
);

function defaultDateRange() {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    return {from: from.toISOString(), to: to.toISOString()};
}

const dateRange = ref(defaultDateRange());
// Preset key behind dateRange — the toolbar chip shows the preset's words
// ("Last 7 days") instead of dates. '7d' matches defaultDateRange().
const rangeKey = ref('7d');
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
    // Solar needs the period export, which only the history carries.
    if ((tab === 'power' || tab === 'solar') && !loadedTabs.has('power')) {
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
        rangeKey.value = p.key;
        dateRange.value = {from: from.toISOString(), to: to.toISOString()};
        return;
    }
    rangeKey.value = p.key;
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

// Per-phase load from 3-phase EM status. A Shelly 3-phase EM reports one
// em:0 component carrying a_/b_/c_ per-phase fields (Shelly API + the tested
// componentPower.ts). Read the active-power field name from that SSOT so the
// a_act_power/b_act_power/c_act_power mapping is defined in one home.
const PHASE_LEGS = [
    {name: 'L1', key: 'a'},
    {name: 'L2', key: 'b'},
    {name: 'L3', key: 'c'}
] as const;
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
                const p = em[PHASE_ACTIVE_POWER_FIELDS[leg.key]];
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


// History only: a device's lifetime return counter is not a period value.
const totalReturned = computed(() => histReturned.value.reduce((s, p) => s + p.value, 0));

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

const canonicalTariff = ref<TariffSpec | null>(null);
const canonicalTariffError = ref<string | null>(null);
const recordedBill = ref<RecordedBillLookup>({
    status: 'loading',
    message: 'Loading an exactly aligned recorded utility bill…'
});
const recordedBillCandidates = ref<RecordedUtilityBill[]>([]);
const selectedRecordedBillId = ref<number | null>(null);
const recordedBillChoices = computed(() =>
    recordedBillCandidates.value.map((bill) => ({
        id: bill.id,
        label: recordedBillIdentityLabel(bill),
        disabled: false
    }))
);
let canonicalPricingRun = 0;
let recordedBillRun = 0;

async function refreshRecordedBill(): Promise<void> {
    const run = ++recordedBillRun;
    recordedBillCandidates.value = [];
    selectedRecordedBillId.value = null;
    if (
        funnelActive.value ||
        Object.keys(dashboardApiScope.value).length > 0
    ) {
        recordedBill.value = {
            status: 'unavailable',
            message:
                'Recorded bills are organization-level, while this dashboard shows a selected device scope.'
        };
        return;
    }
    recordedBill.value = {
        status: 'loading',
        message: 'Loading an exactly aligned recorded utility bill…'
    };
    const timezone = store.settings?.tariffTimezone ?? null;
    const periodStart = recordedBillPeriodDate(
        dateRange.value.from,
        timezone
    );
    const periodEnd = recordedBillPeriodDate(dateRange.value.to, timezone);
    try {
        const listed: RecordedUtilityBill[] = [];
        let cursor: {periodStart: string; id: number} | null = null;
        for (let page = 0; page < 5; page += 1) {
            const result: {
                bills: RecordedUtilityBill[];
                nextCursor: {periodStart: string; id: number} | null;
            } = await ws.sendRPC('FLEET_MANAGER', 'bill.list', {
                from: periodStart,
                to: periodEnd,
                limit: 200,
                ...(cursor ? {cursor} : {})
            });
            listed.push(...(result?.bills ?? []));
            cursor = result?.nextCursor ?? null;
            if (!cursor) break;
            if (page === 4) {
                recordedBillCandidates.value = [];
                selectedRecordedBillId.value = null;
                recordedBill.value = {
                    status: 'unavailable',
                    message:
                        'More than 1,000 recorded bills match this period. Narrow the recorded-bill identity before comparing.'
                };
                return;
            }
        }
        if (run !== recordedBillRun) return;
        const candidates = findExactRecordedBills(
            listed,
            periodStart,
            periodEnd,
            timezone
        );
        recordedBillCandidates.value = candidates;
        const selected = candidates.length === 1 ? candidates[0] : null;
        selectedRecordedBillId.value = selected?.id ?? null;
        setRecordedBillLookup(selected, periodStart, periodEnd);
    } catch (err) {
        if (run !== recordedBillRun) return;
        recordedBill.value = {
            status: 'unavailable',
            message:
                (err as {message?: string})?.message ??
                'Recorded utility bills are unavailable.'
        };
    }
}

function setRecordedBillLookup(
    selected: RecordedUtilityBill | null,
    periodStart: string,
    periodEnd: string
): void {
    if (selected) {
        recordedBill.value = {
            status: 'ready',
            bill: selected,
            coverageWarning: recordedBillIdentity(selected)
                ? `Operator-selected recorded identity: ${recordedBillIdentityLabel(selected)}. Verify that this utility identity covers the organization-wide shadow bill; no dashboard-to-utility-meter mapping is stored.`
                : 'This legacy bill has period-only coverage; account and meter coverage cannot be verified.'
        };
        return;
    }
    recordedBill.value = {
        status: 'unavailable',
        message:
            recordedBillCandidates.value.length > 1
                ? 'Multiple recorded bills match this period. Select the exact account, meter, or service point before comparing.'
                : `No recorded organization bill exactly matches ${periodStart} to ${periodEnd}.`
    };
}

function selectRecordedBill(id: number): void {
    const selected = recordedBillCandidates.value.find((bill) => bill.id === id);
    if (!selected) return;
    selectedRecordedBillId.value = selected.id;
    setRecordedBillLookup(selected, selected.periodStart, selected.periodEnd);
}

/** Refresh money for the exact visible scope through the same stored-tariff
 * assignment and per-channel pricing engine used by reports. */
async function refreshCanonicalPricing(): Promise<void> {
    const run = ++canonicalPricingRun;
    canonicalTariff.value = null;
    canonicalTariffError.value = null;
    await Promise.all([
        store.fetchPeriodPricing({
            ...(funnelActive.value
                ? {devices: scopedMeterRows.value.map((row) => row.shellyId).filter(Boolean)}
                : Object.keys(dashboardApiScope.value).length > 0
                  ? {scope: dashboardApiScope.value}
                  : {}),
            from: dateRange.value.from,
            to: dateRange.value.to
        }),
        refreshRecordedBill()
    ]);
    if (run !== canonicalPricingRun) return;
    const pricing = store.periodPricing;
    if (pricing?.status !== 'priced' || pricing.tariffIds.length !== 1) return;
    try {
        const result = await ws.sendRPC<{tariff: TariffSpec}>(
            'FLEET_MANAGER',
            'tariff.get',
            {id: pricing.tariffIds[0]}
        );
        if (run !== canonicalPricingRun) return;
        canonicalTariff.value = result.tariff;
    } catch (err) {
        if (run !== canonicalPricingRun) return;
        canonicalTariffError.value =
            (err as {message?: string})?.message ?? 'Tariff details are unavailable.';
    }
}

const canonicalPricingMessage = computed(() => {
    if (store.pricingError) return `Stored-tariff pricing unavailable: ${store.pricingError}`;
    const pricing = store.periodPricing;
    if (!pricing) {
        return funnelActive.value && scopedMeterRows.value.length === 0
            ? 'No devices match the active filters.'
            : 'Loading stored-tariff pricing…';
    }
    if (pricing.status === 'partial') {
        return `${pricing.unpricedConsumptionKWh.toLocaleString('en-US')} kWh has no tariff assignment. Assign every visible meter before showing money.`;
    }
    if (pricing.status === 'unconfigured') {
        return 'No canonical tariff covers the visible meters. Add a tariff assignment in Settings.';
    }
    return null;
});

const canonicalAdditionalCharges = computed(() => {
    const pricing = store.periodPricing;
    if (pricing?.status !== 'priced') {
        return {complete: false, demand: 0, standing: 0, message: null};
    }
    if (pricing.tariffIds.length > 1) {
        return {
            complete: false,
            demand: 0,
            standing: 0,
            message:
                'Energy cost uses all assigned tariffs. Additional charges are unavailable for mixed tariffs; run a report per tariff.'
        };
    }
    if (canonicalTariffError.value) {
        return {
            complete: false,
            demand: 0,
            standing: 0,
            message: `Energy cost is authoritative, but additional charges are unavailable: ${canonicalTariffError.value}`
        };
    }
    if (!canonicalTariff.value) {
        return {
            complete: false,
            demand: 0,
            standing: 0,
            message:
                pricing.tariffIds.length === 0
                    ? 'Energy cost is authoritative, but no single tariff defines additional charges.'
                    : 'Loading additional tariff charges…'
        };
    }
    return dashboardAdditionalCharges({
        tariff: canonicalTariff.value,
        from: new Date(dateRange.value.from),
        to: new Date(dateRange.value.to),
        periodDays: rangeDays.value,
        peakKw: (peakPower.value ?? 0) / 1000
    });
});

const consumptionChartData = computed((): TimePoint[] => {
    return aggregateByBucket(filteredPeriodCurrent.value);
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
    const tz = store.settings?.tariffTimezone;
    for (const point of points) {
        const {hour: h, day} = tariffLocalTime(point.bucket, tz);
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
            // AC grid electricity — exclude DC / other commodities.
            commodity: 'electricity',
            electricalSource: 'ac_mains',
            bucket: '1 hour'
        };
        const result = await ws.sendRPC<{items: any[]}>(
            'FLEET_MANAGER',
            'energy.query',
            {...commonParams, ...dashboardScopeParams()}
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
    void refreshCanonicalPricing();
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
    const byType = filterByDeviceType(
        store.meterRows,
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
            // AC grid electricity — exclude DC / other commodities.
            commodity: 'electricity',
            electricalSource: 'ac_mains',
            bucket
        };
        return ws.sendRPC<{items: any[]}>('FLEET_MANAGER', 'energy.query', {
            ...params,
            ...dashboardScopeParams()
        });
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





const periodTotalCost = computed(() => {
    const pricing = store.periodPricing;
    return pricing?.status === 'priced' ? pricing.energyCost : null;
});
// The period the user named, which is not the query window: the window always
// ends "now", so a rolling range is already complete and only a named calendar
// period still runs past now. Falling back to the window end tells the backend
// the period has closed, and a closed period is an actual, never a projection.
function namedPeriodEnd(): string {
    const to = new Date(dateRange.value.to);
    if (to.getTime() > Date.now()) return to.toISOString();
    if (rangeKey.value === 'month') return new Date(to.getFullYear(), to.getMonth() + 1, 1).toISOString();
    if (rangeKey.value === 'ytd') return new Date(to.getFullYear() + 1, 0, 1).toISOString();
    return to.toISOString();
}
// Projected over the same devices the period cost is priced from, so the run
// rate and the total it scales always describe the same fleet. The maths lives
// in the backend (energy.projection) — nothing here decides how thin is too thin.
const projectionRequest = computed((): ProjectionRequest => ({
    ...(funnelActive.value
        ? {devices: scopedMeterRows.value.map((r) => r.shellyId).filter(Boolean)}
        : Object.keys(dashboardApiScope.value).length > 0
          ? {scope: dashboardApiScope.value}
          : {}),
    from: dateRange.value.from,
    to: namedPeriodEnd(),
    costSoFar: periodTotalCost.value
}));
// Registered on mount, not here: an immediate run during setup would read
// refs this block is still above.
function watchProjection(): void {
    watch(projectionRequest, (request) => void store.fetchProjection(request), {
        deep: true,
        immediate: true
    });
}

// ── Location breakdown (fleet mode) ──

const locationData = computed(() => {
    if (Object.keys(dashboardApiScope.value).length > 0) return [];
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
        cost: 0,
        power: r.livePower,
        share: r.share,
        hasEmChannels: r.hasEmChannels,
        hasEm1Channels: r.hasEm1Channels,
        _currency: cs
    }));
});


// ── Data fetching ──

async function fetchDashboardRecord() {
    const dashboard = await fetchDashboardRecordSummary(dashboardId.value);
    if (dashboard) {
        dashboardName.value = dashboard.name ?? 'Energy';
        dashboardApiScope.value = dashboard.apiScope;
        groupId.value = dashboard.apiScope.groupId ?? null;
    }
}

function dashboardScopeParams(): {scope?: typeof dashboardApiScope.value} {
    return Object.keys(dashboardApiScope.value).length > 0
        ? {scope: dashboardApiScope.value}
        : {};
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
            dashboardScopeParams()
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
const energyScope = dashboardScopeParams;
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
    const [kindR, utilR, genR, voltR, roleActR, roleRetR] = await Promise.allSettled([
        ws.sendRPC<{groups?: {label: string; value: number; unit: string}[]}>('FLEET_MANAGER', 'energy.query', {...base, groupBy: 'kind'}),
        ws.sendRPC<{groups?: {label: string; value: number; unit: string}[]}>('FLEET_MANAGER', 'energy.query', {...base, groupBy: 'utility'}),
        genDevices.length
            ? ws.sendRPC<{items?: {value: number}[]}>('FLEET_MANAGER', 'energy.query', {
                  devices: genDevices,
                  from: dateRange.value.from,
                  to: dateRange.value.to,
                  tags: ['total_act_energy'],
                  // AC grid electricity — exclude DC / other commodities.
                  commodity: 'electricity',
                  electricalSource: 'ac_mains',
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
            : Promise.resolve({groups: []})
    ]);
    logSettledRejections('Energy groups', {kind: kindR, utility: utilR, generation: genR, voltage: voltR, role: roleActR, roleRet: roleRetR});
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
            // AC grid electricity — exclude DC / other commodities.
            commodity: 'electricity',
            electricalSource: 'ac_mains',
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
    const byDevice = new Map<number, number>();
    for (const r of items) if (typeof r.device === 'number') byDevice.set(r.device, (byDevice.get(r.device) ?? 0) + (r.value ?? 0));
    priorByDevice.value = byDevice;
    priorPeriod.value = {consumption, cost: null};
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
    const tz = store.settings?.tariffTimezone;
    for (const p of consumptionChartData.value) {
        const dow = tariffLocalTime(p.bucket, tz).day;
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
    const c = filteredTotalConsumption.value;
    const cost = periodTotalCost.value ?? 0;
    if (c > 0 && cost > 0) return cost / c;
    return 0;
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
    const [period, live] = await Promise.allSettled([
        store.fetchPeriodData(
            dashboardApiScope.value,
            dateRange.value.from,
            dateRange.value.to,
            granularity.value
        ),
        store.fetchLiveMetrics(dashboardApiScope.value)
    ]);
    logSettledRejections('Energy', {period, live});
    await refreshCanonicalPricing();
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
const reportFormat = ref<'html' | 'csv' | 'xlsx' | 'pdf'>('html');
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

// Report feedback. Elapsed is shown instead of a predicted finish time: report
// cost varies with row count and format, so any ETA would swing and mislead.
const reportProgressPct = computed(() =>
    progressPct(reportProgress.percent.value ?? 0, reportGenerating.value)
);
const reportProgressDetail = computed(() => {
    const phase = reportProgress.label.value;
    return phase || 'Collecting readings for the selected period';
});
const reportElapsedLabel = computed(() => {
    const s = reportElapsed.value;
    if (s < 60) return `${s}s elapsed`;
    return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s elapsed`;
});
const reportProgressItems = computed(() => {
    const items: string[] = [];
    const rows = reportProgress.rowsWritten.value;
    const estimated = reportProgress.estimatedRows.value;
    if (rows !== null) {
        items.push(
            estimated !== null && estimated > 0
                ? `${rows.toLocaleString('en-US')} of about ${estimated.toLocaleString('en-US')} rows written`
                : `${rows.toLocaleString('en-US')} rows written`
        );
    }
    const bytes = reportProgress.bytesWritten.value;
    if (bytes !== null && bytes > 0) {
        items.push(`${(bytes / 1024 / 1024).toFixed(1)} MB so far`);
    }
    items.push('You can keep using the dashboard while this runs');
    return items;
});


// Energy report params from the current builder — shared by the generate
// button and "Save as template".
function currentEnergyReportParams() {
    const s = store.settings;
    const tariffTimezone = s?.tariffTimezone?.trim();
    const selectedBill = recordedBillCandidates.value.find(
        (bill) => bill.id === selectedRecordedBillId.value
    );
    return {
        ...dashboardScopeParams(),
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
        dashboardId: dashboardId.value,
        ...(tariffTimezone && validateTimezone(tariffTimezone).valid
            ? {timezone: tariffTimezone}
            : {}),
        ...(selectedBill
            ? {
                  billIdentity: {
                      billId: selectedBill.id,
                      ...(recordedBillIdentity(selectedBill) ?? {})
                  }
              }
            : {})
    };
}

// Save the current builder config as a reusable template.

async function saveSettings(
    updated: Partial<DashboardSettings & {groupId?: number | null; name?: string}>
) {
    savingSettings.value = true;
    try {
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
            dashboardApiScope.value = dashboard.scope ?? {};
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
        if (scopeChanged) {
            void fetchSyncStatus();
            await reloadForRange();
        }
    } finally {
        savingSettings.value = false;
    }
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

let tariffSettingsQueryHandled = false;
watch(
    () => route.query.settings,
    (value) => {
        if (value !== 'tariffs') {
            tariffSettingsQueryHandled = false;
            return;
        }
        if (tariffSettingsQueryHandled) return;
        tariffSettingsQueryHandled = true;
        void openSettings();
    },
    {immediate: true}
);
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
    if (
        p.kind === 'energy' &&
        recordedBillCandidates.value.length > 1 &&
        selectedRecordedBillId.value === null
    ) {
        toast.error(
            'Select the exact recorded bill in the Bill card before generating this report.'
        );
        return;
    }
    reportKind.value = (['energy', 'interval', 'energy_dump'].includes(p.kind) ? p.kind : 'energy') as typeof reportKind.value;
    reportMode.value = p.kind === 'interval' ? 'single' : 'full';
    if (['fifteen_minutes', 'hour', 'day', 'month'].includes(p.granularity)) reportGranularity.value = p.granularity;
    if (
        p.format === 'html' ||
        p.format === 'csv' ||
        p.format === 'xlsx' ||
        p.format === 'pdf'
    )
        reportFormat.value = p.format;
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

            showPartialCoverageWarning(result);
            downloadReport(result, reportFormat.value);
        } else {
            // Single metric report
            const result = await generateReportFile(
                ws,
                {
                    kind: 'interval',
                    format: reportFormat.value,
                    ...dashboardScopeParams(),
                    metrics: reportMetrics.value,
                    from: dateRange.value.from,
                    to: dateRange.value.to,
                    granularity: reportGranularity.value,
                    per_device: reportPerDevice.value
                },
                reportMetrics.value.join('+'),
                progressOpts
            );

            downloadReport(result, reportFormat.value);
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

function showPartialCoverageWarning(
    result: Awaited<ReturnType<typeof generateReportFile>>
): void {
    const message = partialCoverageMessage(result.coverage);
    if (!message) return;
    toast.addToast({type: 'warning', message, persistent: true});
}

function stopReportPoll(): void {
    reportPollAbort?.abort();
    reportPollAbort = null;
}


async function downloadReport(
    result: any,
    format: 'html' | 'csv' | 'xlsx' | 'pdf'
) {
    if (!result?.file) {
        reportError.value =
            'Report generated but no file returned. Check backend logs.';
        return;
    }
    const selectedFile =
        format === 'html' && result.htmlFile ? result.htmlFile : result.file;
    const filename = selectedFile.split('/').pop() ?? selectedFile;
    const extension =
        format === 'xlsx'
            ? 'xlsx'
            : format === 'pdf'
              ? 'pdf'
              : format === 'html'
                ? 'html'
                : 'csv';
    const downloadName = `${result.name ?? 'report'}.${extension}`;
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
        link.download = downloadName;
        link.click();
        URL.revokeObjectURL(url);
        const htmlFile = typeof result.htmlFile === 'string'
            ? result.htmlFile.split('/').pop()
            : null;
        lastReport.value = {
            name: downloadName,
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
    await Promise.allSettled([
        store.fetchPeriodData(
            dashboardApiScope.value,
            dateRange.value.from,
            dateRange.value.to,
            granularity.value
        )
    ]);
    await refreshCanonicalPricing();
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
        if (ids.length > 0 && !store.periodData) {
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
            await store.fetchLiveMetrics(dashboardApiScope.value);
        } catch (err) {
            console.error('[Energy] refresh error:', err);
        }
    }, interval);
}

function restartRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
    startRefresh();
}

// Auto-refresh cadence picked from the shell ⋮ menu. Persist to settings, then
// restart the live-refresh timer against the new cadence.
async function onSetInterval(ms: number): Promise<void> {
    await saveSettings({refreshInterval: ms});
    restartRefresh();
}

onMounted(async () => {
    watchProjection();
    startSyncStatusPolling();
    await load();
    // The dashboard record may establish a group scope. Refresh immediately
    // instead of showing the initial fleet-wide status until the next poll.
    void fetchSyncStatus();
    startRefresh();
    // Filter-dimension labels — non-blocking; sections appear once loaded.
    void Promise.allSettled([tagsStore.fetchTags(), locationsStore.fetchLocations()]);
});

onUnmounted(() => {
    stopReportPoll();
    if (refreshTimer) clearInterval(refreshTimer);
    if (reportTimer) clearInterval(reportTimer);
    if (syncStatusTimer) clearInterval(syncStatusTimer);
    chrome.clear();
});

// Refresh + settings live in the Energy header (EnergyVoltaine toolbar); the
// shell ⋮ carries rename / set-default / lifecycle plus the auto-refresh cadence.
const chrome = useDashboardChromeStore();
const {renameVisible, renameSaving, renameName, saveRename} =
    useDomainDashboardChrome({
        dashboardId: () => dashboardId.value,
        loading: () => store.loading,
        currentName: () => dashboardName.value,
        onRenamed: (name) => {
            dashboardName.value = name;
        },
        refreshInterval: () => store.settings?.refreshInterval ?? 0,
        onSetInterval: (ms) => void onSetInterval(ms)
    });

// ── Producer side of the energy dashboard SSOT contract ──
// buildEnergyDashboardData is the single mapper from the live energy layer to the
// presentational shape EnergyVoltaine consumes.
const energyTariffConfigured = computed(() => {
    return store.periodPricing?.status === 'priced';
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
        currencyCode: store.periodPricing?.currency ?? null,
        tariffConfigured: energyTariffConfigured.value,
        tariffMessage: canonicalPricingMessage.value,
        hasGroups: groupsList.value.length > 0,
        hasKinds: false,
        hasSolar:
            totalReturned.value > 0 ||
            pvGenerationKwh.value > 0 ||
            battery.value.has ||
            evDeliveredKwh.value > 0,
        totalConsumptionKwh: filteredTotalConsumption.value,
        totalCost: periodTotalCost.value,
        projectedCost: store.projectedCost,
        projectionObservedDays: store.projectionObservedDays,
        projectionRangeKwh: store.projectionRangeKwh,
        totalReturnedKwh: totalReturned.value,
        rangeDays: rangeDays.value,
        priorConsumptionKwh: store.previousPeriodPricing?.consumptionKWh ?? null,
        priorCost:
            store.previousPeriodPricing?.status === 'priced'
                ? store.previousPeriodPricing.energyCost
                : null,
        consumption: consumptionChartData.value,
        returned: histReturnedChart.value,
        dayCost: store.periodPricing?.dayEnergyCost ?? 0,
        nightCost: store.periodPricing?.nightEnergyCost ?? 0,
        exportCredit: store.periodPricing?.exportCredit ?? null,
        netEnergyCost: store.periodPricing?.netEnergyCost ?? null,
        demandCharge: canonicalAdditionalCharges.value.demand,
        standingCharge: canonicalAdditionalCharges.value.standing,
        taxes:
            canonicalAdditionalCharges.value.complete && canonicalTariff.value
                ? effectiveTariffTaxes(canonicalTariff.value)
                : [],
        additionalChargesComplete: canonicalAdditionalCharges.value.complete,
        additionalChargesMessage: canonicalAdditionalCharges.value.message,
        recordedBill: recordedBill.value,
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
            // Per-device authoritative pricing is not part of the aggregate
            // summary; do not spread a blended fleet rate across unlike tariffs.
            cost: '—',
            delta: deltaLabel(r.consumption, priorByDevice.value.get(r.id)),
            quality: r.online ? 'Good' : 'No data',
            status: r.online ? 'online' : 'offline',
            online: r.online
        })),
        hourly: hourlyData.value,
        co2LocationKg: filteredTotalConsumption.value * ((store.settings?.emissionFactorGPerKWh ?? DEFAULT_EMISSION_FACTOR) / 1000),
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
/* Transparent — the shared /dash .dash-surface panel provides the frost now. */
.energy-dash {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-4);
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
    font-size: var(--type-caption);
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
