<template>
    <Breadcrumbs :overrides="{ dash: 'Dashboards', '/dash/analytics': null, [String(dashboardId)]: dashboard?.name ?? 'Dashboard' }" />
    <AnalyticsDashboardLayout
        :title="dashboard?.name || 'Analytics Dashboard'"
        :subtitle="groupName ? `Group: ${groupName}` : undefined"
        :loading="loading"
        :refreshing="refreshing"
        @back="goBack"
        @refresh="handleRefresh"
        @settings="showSettings = true"
    >
        <template #date-range>
            <DateRangeSelector
                v-model="dateRange"
                :default-range="settings?.defaultRange || 'last_7_days'"
                @change="onDateRangeChange"
            />
        </template>

        <template #metrics>
            <MetricsGrid
                :metrics="analyticsStore.scopeMetrics?.metrics || null"
                :capabilities="capabilities"
                :enabled-metrics="settings?.enabledMetrics || []"
                :tariff="settings?.tariff || 0"
                :currency="settings?.currency || 'EUR'"
                :hide-uptime="true"
            />
        </template>

        <template #charts>
            <!-- Consumption Chart -->
            <ConsumptionChart
                v-if="showConsumption"
                :data="analyticsStore.consumptionHistory"
                :tariff="settings?.tariff || 0"
                :currency="settings?.currency || 'EUR'"
                :loading="loadingConsumption"
            />

            <!-- Returned Energy Chart -->
            <MetricChart
                v-if="showReturnedEnergy"
                :data="analyticsStore.returnedEnergyHistory"
                title="Returned Energy"
                unit="kWh"
                icon="fas fa-chart-bar text-[var(--color-orange-text)]"
                :color="chartColors.warning"
                chart-type="bar"
                :precision="3"
                :loading="loadingMetrics"
            />

            <!-- Voltage Chart -->
            <MetricChart
                v-if="showVoltage"
                :data="analyticsStore.voltageHistory"
                title="Voltage"
                unit="V"
                icon="fas fa-bolt text-[var(--color-warning-text)]"
                :color="chartColors.warning"
                chart-type="line"
                :precision="1"
                :loading="loadingMetrics"
            />

            <!-- Amperage Chart -->
            <MetricChart
                v-if="showCurrent"
                :data="analyticsStore.currentHistory"
                title="Current"
                unit="A"
                icon="fas fa-wave-square text-[var(--color-info-text)]"
                :color="chartColors.info"
                chart-type="line"
                :precision="3"
                :loading="loadingMetrics"
            />

            <!-- Power Distribution -->
            <div v-if="showPower" class="adl-glass-card rounded-lg p-4">
                <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                    <i class="fas fa-chart-pie mr-2 text-[var(--color-accent-text)]"></i>
                    Power Distribution (Current)
                </h3>
                <div class="h-64 flex items-center justify-center text-[var(--color-text-disabled)]">
                    <span v-if="!analyticsStore.scopeMetrics?.devices?.length">
                        No devices in this group
                    </span>
                    <span v-else-if="!hasPowerData">
                        No power data available - devices may be offline
                    </span>
                    <div v-else ref="powerPieContainer" class="w-full h-full"></div>
                </div>
            </div>

            <!-- Temperature Chart (if available) -->
            <div v-if="showTemperature" class="adl-glass-card rounded-lg p-4">
                <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                    <i class="fas fa-thermometer-half mr-2 text-[var(--color-danger-text)]"></i>
                    Temperature History
                </h3>
                <div class="h-64 flex items-center justify-center text-[var(--color-text-disabled)]">
                    <canvas ref="tempCanvas"></canvas>
                </div>
            </div>

            <!-- Humidity Chart (if available) -->
            <div v-if="showHumidity" class="adl-glass-card rounded-lg p-4">
                <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                    <i class="fas fa-tint mr-2 text-[var(--color-info-text)]"></i>
                    Humidity History
                </h3>
                <div class="h-64 flex items-center justify-center text-[var(--color-text-disabled)]">
                    <canvas ref="humidityCanvas"></canvas>
                </div>
            </div>
        </template>

        <template #reports>
            <div class="adl-glass-card rounded-lg p-4">
                <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-3">
                    <i class="fas fa-file-csv mr-2 text-[var(--color-success-text)]"></i>
                    Generate Report
                </h3>
                <div class="flex flex-wrap items-end gap-3 mb-3">
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-[var(--color-text-tertiary)]">Report Type</label>
                        <select v-model="reportKind" class="adl-select text-sm rounded px-3 py-2">
                            <option value="energy">Comprehensive Energy (HTML + CSV)</option>
                            <option value="interval">Interval Data (CSV)</option>
                        </select>
                    </div>
                    <div v-if="reportKind === 'interval'" class="flex flex-col gap-1">
                        <label class="text-xs text-[var(--color-text-tertiary)]">Metrics</label>
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                            <label
                                v-for="m in METRIC_OPTIONS"
                                :key="m.value"
                                class="flex items-center gap-1.5 text-sm text-[var(--color-text-tertiary)]"
                            >
                                <input
                                    v-model="reportMetrics"
                                    type="checkbox"
                                    :value="m.value"
                                />
                                {{ m.label }}
                            </label>
                        </div>
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-[var(--color-text-tertiary)]">Granularity</label>
                        <select v-model="reportGranularity" class="adl-select text-sm rounded px-3 py-2">
                            <option value="minute">Per Minute</option>
                            <option value="hour">Hourly</option>
                            <option value="day">Daily</option>
                            <option value="month">Monthly</option>
                        </select>
                    </div>
                    <div class="flex items-center gap-2 py-2">
                        <input id="perDevice" v-model="reportPerDevice" type="checkbox" class="w-4 h-4 accent-[var(--color-primary)]" />
                        <label for="perDevice" class="text-sm text-[var(--color-text-secondary)] cursor-pointer">Per Device</label>
                    </div>
                    <button
                        type="button"
                        class="px-4 py-2 bg-[var(--color-success)] text-white rounded hover:bg-[var(--color-success-hover)] transition-colors text-sm"
                        :disabled="generatingReport"
                        @click="generateReport"
                    >
                        <i :class="generatingReport ? 'fas fa-spinner fa-spin' : 'fas fa-download'" class="mr-2"></i>
                        {{ generatingReport ? `Generating... ${reportElapsed}s` : 'Generate &amp; Download' }}
                    </button>
                    <button
                        type="button"
                        class="px-4 py-2 bg-[var(--color-surface-3)] text-[var(--color-text-primary)] rounded hover:opacity-80 transition-opacity text-sm"
                        :disabled="generatingReport"
                        title="Save this report configuration as a reusable template"
                        @click="saveAsTemplate"
                    >
                        <i class="fas fa-bookmark mr-2"></i>
                        Save as template
                    </button>
                </div>
                <ReportProgress
                    v-if="generatingReport"
                    class="mb-2"
                    :label="reportProgress.label.value"
                    :percent="reportProgress.percent.value"
                    :rows-written="reportProgress.rowsWritten.value"
                    :bytes-written="reportProgress.bytesWritten.value"
                    :estimated-rows="reportProgress.estimatedRows.value"
                    @cancel="cancelGenerate"
                />
                <div v-if="reportError" class="text-sm text-[var(--color-danger-text)] mb-2">{{ reportError }}</div>
                <div v-if="lastReport" class="text-sm text-[var(--color-text-tertiary)]">
                    Last report:
                    <a :href="lastReport.url" download class="text-[var(--color-primary-text)] hover:underline">{{ lastReport.name }}</a>
                    <span v-if="lastReport.htmlUrl">
                        ·
                        <a :href="lastReport.htmlUrl" target="_blank" rel="noopener" class="text-[var(--color-primary-text)] hover:underline">Open HTML</a>
                    </span>
                </div>
            </div>
            <ReportTemplatesPanel ref="reportTemplatesRef" class="mt-3" />
        </template>

        <template #uptime>
            <div v-if="showUptime && uptimeData.length > 0" class="adl-glass-card rounded-lg p-4">
                <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-3">
                    <i class="fas fa-clock mr-2 text-[var(--color-success-text)]"></i>
                    Device Uptime
                </h3>
                <DataList
                    :rows="uptimeData"
                    :columns="uptimeColumns"
                    row-key="deviceId"
                >
                    <template #cell-value="{row}">
                        <span class="text-[var(--color-success-text)] font-mono">{{ formatUptime(row.value) }}</span>
                    </template>
                </DataList>
            </div>
        </template>
    </AnalyticsDashboardLayout>

    <!-- Settings Modal -->
    <DashboardSettingsModal
        :visible="showSettings"
        :settings="settings"
        @close="showSettings = false"
        @save="saveSettings"
    />
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import {createReportTemplate} from '@/api/reportTemplateRpc';
import AnalyticsDashboardLayout from '@/components/analytics/AnalyticsDashboardLayout.vue';
import ConsumptionChart from '@/components/analytics/charts/ConsumptionChart.vue';
import MetricChart from '@/components/analytics/charts/MetricChart.vue';
import DashboardSettingsModal from '@/components/analytics/DashboardSettingsModal.vue';
import DateRangeSelector from '@/components/analytics/DateRangeSelector.vue';
import MetricsGrid from '@/components/analytics/metrics/MetricsGrid.vue';
import Breadcrumbs from '@/components/core/Breadcrumbs.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import ReportProgress from '@/components/reports/ReportProgress.vue';
import ReportTemplatesPanel from '@/components/reports/ReportTemplatesPanel.vue';
import {useEChart} from '@/composables/useEChart';
import {useReportProgress} from '@/composables/useReportProgress';
import {DASHBOARDS_PATH} from '@/constants';
import {chartColors} from '@/helpers/chartUtils';
import {
    cancelReport,
    generateReportFile,
    ReportCancelledError,
    ReportPollAbortedError
} from '@/helpers/reportGeneration';
import {type DashboardSettings, useAnalyticsStore} from '@/stores/analytics';
import {useDashboardsStore} from '@/stores/dashboards';
import {useGroupsStore} from '@/stores/groups';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

const route = useRoute();
const router = useRouter();
const analyticsStore = useAnalyticsStore();
const dashboardsStore = useDashboardsStore();
const groupsStore = useGroupsStore();

// State
const loading = ref(true);
const refreshing = ref(false);
const loadingConsumption = ref(false);
const loadingMetrics = ref(false);
const generatingReport = ref(false);
const showSettings = ref(false);
const dashboard = ref<any>(null);
const settings = ref<DashboardSettings | null>(null);
const capabilities = ref<string[]>([]);
const lastReport = ref<{
    name: string;
    url: string;
    htmlUrl?: string;
} | null>(null);
const reportTemplatesRef = ref<{load: () => void} | null>(null);
const toast = useToastStore();
const reportProgress = useReportProgress();
const reportJobId = ref<string | null>(null);
let reportPollAbort: AbortController | null = null;
const METRIC_OPTIONS = [
    {value: 'consumption', label: 'Consumption (kWh)'},
    {value: 'returned_energy', label: 'Returned Energy (kWh)'},
    {value: 'voltage', label: 'Voltage (V)'},
    {value: 'current', label: 'Current (A)'},
    {value: 'power', label: 'Power (W)'}
] as const;

const reportKind = ref<'energy' | 'interval'>('energy');
const reportMetrics = ref<string[]>(['consumption']);
const reportGranularity = ref('day');
const reportPerDevice = ref(true);
const reportError = ref<string | null>(null);
const reportElapsed = ref(0);
let reportTimer: ReturnType<typeof setInterval> | null = null;

const dateRange = ref<{from: string; to: string}>({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date().toISOString()
});

// Computed
const dashboardId = computed(() => {
    const id = (route.params as {id?: string}).id;
    return typeof id === 'string' ? Number.parseInt(id, 10) : null;
});

const groupId = computed(() => dashboard.value?.groupId ?? undefined);

const groupName = computed(() => {
    if (!groupId.value) return null;
    const group = groupsStore.groups[groupId.value];
    return group?.name || `Group ${groupId.value}`;
});

const showConsumption = computed(
    () =>
        capabilities.value.includes('consumption') &&
        (settings.value?.enabledMetrics?.includes('consumption') ?? true)
);

const showReturnedEnergy = computed(
    () =>
        capabilities.value.includes('returned_energy') &&
        (settings.value?.enabledMetrics?.includes('returned_energy') ?? true)
);

const showVoltage = computed(
    () =>
        capabilities.value.includes('voltage') &&
        (settings.value?.enabledMetrics?.includes('voltage') ?? true)
);

const showCurrent = computed(
    () =>
        capabilities.value.includes('current') &&
        (settings.value?.enabledMetrics?.includes('current') ?? true)
);

const showPower = computed(
    () =>
        capabilities.value.includes('power') &&
        (settings.value?.enabledMetrics?.includes('power') ?? true)
);

const showTemperature = computed(
    () =>
        capabilities.value.includes('temperature') &&
        (settings.value?.enabledMetrics?.includes('temperature') ?? true)
);

const showHumidity = computed(
    () =>
        capabilities.value.includes('humidity') &&
        (settings.value?.enabledMetrics?.includes('humidity') ?? true)
);

const hasPowerData = computed(() => {
    const powerValues = analyticsStore.scopeMetrics?.metrics?.power?.values;
    return powerValues && powerValues.length > 0;
});

const showUptime = computed(
    () =>
        capabilities.value.includes('uptime') &&
        (settings.value?.enabledMetrics?.includes('uptime') ?? true)
);

interface UptimeRow {
    deviceId: number;
    deviceName: string;
    value: number;
}

const uptimeData = computed<UptimeRow[]>(() => {
    const values = analyticsStore.scopeMetrics?.metrics?.uptime?.values || [];
    return values
        .map((v) => ({
            deviceId: v.deviceId,
            deviceName: v.deviceName || `Device ${v.deviceId}`,
            value: v.value
        }))
        .sort((a, b) => b.value - a.value);
});

const uptimeColumns: DataColumn<UptimeRow>[] = [
    {key: 'deviceName', label: 'Device', role: 'primary'},
    {key: 'value', label: 'Uptime', role: 'meta', align: 'right'}
];

function formatUptime(seconds: number): string {
    if (!seconds) return '--';

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// Container refs for charts
const powerPieContainer = ref<HTMLElement | null>(null);
const tempCanvas = ref<HTMLCanvasElement | null>(null);
const humidityCanvas = ref<HTMLCanvasElement | null>(null);

// Power distribution chart option
const powerChartOption = computed<Record<string, any>>(() => {
    const metrics = analyticsStore.scopeMetrics?.metrics;
    const powerValues = metrics?.power?.values || [];
    const devices = analyticsStore.scopeMetrics?.devices || [];
    const deviceMap = new Map(
        devices.map((d: any) => [d.id, d.name || d.shellyID])
    );

    const powerByDevice = new Map<string, number>();
    for (const pv of powerValues) {
        const deviceName =
            deviceMap.get(pv.deviceId) || `Device ${pv.deviceId}`;
        powerByDevice.set(
            deviceName,
            (powerByDevice.get(deviceName) || 0) + pv.value
        );
    }

    const seriesData = Array.from(powerByDevice.entries()).map(
        ([name, value]) => ({name, value})
    );

    return {
        tooltip: {
            trigger: 'item',
            formatter(params: any) {
                const total = seriesData.reduce((a, b) => a + b.value, 0);
                const pct =
                    total > 0
                        ? ((params.value / total) * 100).toFixed(1)
                        : '0.0';
                return `${params.name}: ${Number(params.value).toFixed(1)} W (${pct}%)`;
            }
        },
        legend: {
            orient: 'vertical',
            right: 8,
            top: 'center',
            textStyle: {color: chartColors.textTertiary, fontSize: 13}
        },
        series: [
            {
                type: 'pie',
                radius: ['40%', '70%'],
                center: ['40%', '50%'],
                itemStyle: {borderColor: chartColors.tooltipBg, borderWidth: 2},
                label: {show: false},
                data: seriesData
            }
        ]
    };
});

useEChart(powerPieContainer, powerChartOption);

// Auto-refresh
let refreshInterval: ReturnType<typeof setInterval> | null = null;

async function fetchDashboard() {
    if (!dashboardId.value) return;
    const fetched = await dashboardsStore.fetchOne(dashboardId.value);
    if (!fetched) {
        router.push(DASHBOARDS_PATH);
        return;
    }
    dashboard.value = fetched;
    if (fetched.dashboardType !== 'analytics') {
        router.push(`/dash/${dashboardId.value}`);
    }
}

async function fetchSettings() {
    if (!dashboardId.value) return;

    const result = await analyticsStore.fetchDashboardSettings(
        dashboardId.value
    );
    settings.value = result;
}

async function fetchCapabilities() {
    if (!groupId.value) return;

    const result = await analyticsStore.fetchScopeCapabilities(groupId.value);
    capabilities.value = result?.capabilities || [];
}

async function fetchMetrics() {
    if (!groupId.value) return;

    await analyticsStore.fetchScopeMetrics(groupId.value);
}

async function fetchConsumptionHistory() {
    if (!groupId.value) return;

    loadingConsumption.value = true;
    try {
        await analyticsStore.fetchConsumptionHistory(
            groupId.value,
            dateRange.value.from,
            dateRange.value.to
        );
    } finally {
        loadingConsumption.value = false;
    }
}

async function fetchMetricHistories() {
    if (!groupId.value) return;

    loadingMetrics.value = true;
    try {
        const promises: Promise<any>[] = [];
        const {from, to} = dateRange.value;
        const gid = groupId.value;

        if (showVoltage.value) {
            promises.push(
                analyticsStore.fetchMetricHistory(gid, from, to, 'voltage')
            );
        }
        if (showCurrent.value) {
            promises.push(
                analyticsStore.fetchMetricHistory(gid, from, to, 'current')
            );
        }
        if (showReturnedEnergy.value) {
            promises.push(
                analyticsStore.fetchMetricHistory(
                    gid,
                    from,
                    to,
                    'returned_energy'
                )
            );
        }

        await Promise.all(promises);
    } finally {
        loadingMetrics.value = false;
    }
}

async function refreshData(showOverlay = true) {
    if (showOverlay) loading.value = true;
    try {
        await Promise.all([
            fetchMetrics(),
            fetchConsumptionHistory(),
            fetchMetricHistories()
        ]);
    } finally {
        if (showOverlay) loading.value = false;
    }
}

async function handleRefresh() {
    if (refreshing.value) return;
    refreshing.value = true;
    // Brief spin-up before fetching — gives the user visual acknowledgment
    await new Promise((r) => setTimeout(r, 400));
    await refreshData(false);
    // Hold spin a bit after completion so it doesn't feel instant
    await new Promise((r) => setTimeout(r, 300));
    refreshing.value = false;
}

function onDateRangeChange(range: {from: string; to: string}) {
    dateRange.value = range;
    fetchConsumptionHistory();
    fetchMetricHistories();
}

async function saveSettings(newSettings: Partial<DashboardSettings>) {
    if (!dashboardId.value) return;

    const success = await analyticsStore.updateDashboardSettings(
        dashboardId.value,
        newSettings
    );
    if (success) {
        settings.value = analyticsStore.settings;
        setupAutoRefresh();
    }
}

// dev_mode_token: localStorage (cross-tab). Zitadel access_token:
// sessionStorage (tab-scoped, post-XSS migration).
function reportAuthHeader(): Record<string, string> {
    const token =
        localStorage.getItem('dev_mode_token') ??
        sessionStorage.getItem('access_token') ??
        '';
    return token ? {Authorization: `Bearer ${token}`} : {};
}

async function triggerBrowserDownload(filename: string, suggestedName: string) {
    const res = await fetch(`/api/reports/download/${filename}`, {
        credentials: 'include',
        headers: reportAuthHeader()
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    link.click();
    URL.revokeObjectURL(url);
}

function stopReportPoll(): void {
    reportPollAbort?.abort();
    reportPollAbort = null;
}

function createReportProgressOpts(signal: AbortSignal) {
    return {
        signal,
        onStart: (id: string) => {
            reportJobId.value = id;
            reportProgress.setJobId(id);
        },
        onProgress: reportProgress.update
    };
}

function currentReportProgressOpts() {
    if (!reportPollAbort) throw new ReportPollAbortedError();
    return createReportProgressOpts(reportPollAbort.signal);
}

async function generateReport() {
    if (!groupId.value) return;

    stopReportPoll();
    const pollAbort = new AbortController();
    reportPollAbort = pollAbort;
    const isCurrentReport = () => reportPollAbort === pollAbort;
    generatingReport.value = true;
    reportError.value = null;
    reportElapsed.value = 0;
    if (reportTimer) {
        clearInterval(reportTimer);
        reportTimer = null;
    }
    reportTimer = setInterval(() => {
        reportElapsed.value++;
    }, 1000);
    reportProgress.start();
    reportJobId.value = null;
    try {
        if (reportKind.value === 'energy') {
            await runEnergyReport();
        } else {
            await runIntervalReport();
        }
    } catch (err: unknown) {
        if (
            isCurrentReport() &&
            !(err instanceof ReportCancelledError) &&
            !(err instanceof ReportPollAbortedError)
        ) {
            reportError.value =
                err instanceof Error ? err.message : 'Failed to generate report';
        }
    } finally {
        if (!isCurrentReport()) return;
        if (reportTimer) {
            clearInterval(reportTimer);
            reportTimer = null;
        }
        reportProgress.stop();
        generatingReport.value = false;
        reportJobId.value = null;
        if (reportPollAbort === pollAbort) reportPollAbort = null;
    }
}

async function cancelGenerate(): Promise<void> {
    if (!reportJobId.value) return;
    try {
        await cancelReport(ws, reportJobId.value);
    } catch (err: unknown) {
        toast.error(
            err instanceof Error ? err.message : 'Could not cancel the report'
        );
    }
}

// Save the current report config as a reusable template (energy or interval).
async function saveAsTemplate() {
    const name = window.prompt('Save report as a template — name:')?.trim();
    if (!name) return;
    const isEnergy = reportKind.value === 'energy';
    try {
        await createReportTemplate({
            name,
            kind: isEnergy ? 'energy' : 'interval',
            params: isEnergy ? currentEnergyParams() : currentIntervalParams()
        });
        toast.success(`Saved template '${name}'`);
        reportTemplatesRef.value?.load();
    } catch (err: any) {
        toast.error(err?.message ?? 'Could not save template');
    }
}

// Interval report params from the current controls — shared by the generate
// button and "Save as template".
function currentIntervalParams() {
    return {
        scope: {groupId: groupId.value},
        metrics: reportMetrics.value,
        from: dateRange.value.from,
        to: dateRange.value.to,
        granularity: reportGranularity.value,
        per_device: reportPerDevice.value
    };
}

// Energy report params from the current controls.
function currentEnergyParams() {
    const tariff = settings.value?.tariff || 0;
    return {
        scope: {groupId: groupId.value},
        from: dateRange.value.from,
        to: dateRange.value.to,
        granularity:
            reportGranularity.value === 'minute'
                ? 'hour'
                : reportGranularity.value,
        tariff: tariff || undefined,
        dashboardId: dashboardId.value ?? undefined
    };
}

async function runIntervalReport() {
    const result = await generateReportFile(
        ws,
        {kind: 'interval', ...currentIntervalParams()},
        reportMetrics.value.join('+'),
        currentReportProgressOpts()
    );

    if (!result?.file) return;
    const filename = result.file;
    await triggerBrowserDownload(filename, `${result.name}.csv`);
    lastReport.value = {
        name: `${result.name}.csv`,
        url: `/api/reports/download/${filename}`
    };
}

// Comprehensive energy report — backend writes BOTH csv (file) and html
// (html_file). Auto-download the csv; expose the html as "Open HTML" link.
async function runEnergyReport() {
    const result = await generateReportFile(
        ws,
        {kind: 'energy', ...currentEnergyParams()},
        'energy_report',
        currentReportProgressOpts()
    );

    if (!result?.file) return;
    const csvName = result.file;
    const htmlName = result.htmlFile;
    await triggerBrowserDownload(csvName, `${result.name}.csv`);
    lastReport.value = {
        name: `${result.name}.csv`,
        url: `/api/reports/download/${csvName}`,
        htmlUrl: htmlName ? `/api/reports/download/${htmlName}` : undefined
    };
}

function goBack() {
    router.push('/');
}

function setupAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }

    const interval = settings.value?.refreshInterval || 60000;
    if (interval > 0) {
        refreshInterval = setInterval(refreshData, interval);
    }
}

// Lifecycle
onMounted(async () => {
    loading.value = true;

    await fetchDashboard();
    if (dashboard.value) {
        await Promise.all([fetchSettings(), fetchCapabilities()]);

        await refreshData();
        setupAutoRefresh();
    }

    loading.value = false;
});

onUnmounted(() => {
    stopReportPoll();
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    if (reportTimer) {
        clearInterval(reportTimer);
    }
    analyticsStore.clearData();
});

// Watch for dashboard ID changes — rapid switches can interleave fetches,
// so a seq-token discards stale results before they clobber the new state.
let switchSeq = 0;
watch(dashboardId, async (newId, oldId) => {
    if (newId && newId !== oldId) {
        const seq = ++switchSeq;
        analyticsStore.clearData();
        loading.value = true;
        try {
            await fetchDashboard();
            if (seq !== switchSeq) return;
            if (dashboard.value) {
                await Promise.all([fetchSettings(), fetchCapabilities()]);
                if (seq !== switchSeq) return;
                await refreshData();
                if (seq !== switchSeq) return;
                setupAutoRefresh();
            }
        } finally {
            if (seq === switchSeq) loading.value = false;
        }
    }
});
</script>

<style scoped>
.adl-glass-card {
    background-color: var(--color-surface-3);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}
.adl-select {
    background-color: var(--glass-input);
    color: var(--color-text-secondary);
    border: 1px solid var(--glass-border);
}
.adl-select:focus {
    border-color: var(--color-border-focus);
    outline: none;
}
</style>
