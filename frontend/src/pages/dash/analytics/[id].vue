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
                :metrics="analyticsStore.groupMetrics?.metrics || null"
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
                color="rgba(249, 115, 22, 1)"
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
                color="rgba(250, 204, 21, 1)"
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
                color="rgba(6, 182, 212, 1)"
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
                    <span v-if="!analyticsStore.groupMetrics?.devices?.length">
                        No devices in this group
                    </span>
                    <span v-else-if="!hasPowerData">
                        No power data available - devices may be offline
                    </span>
                    <canvas v-else ref="powerPieCanvas"></canvas>
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
                        <select v-model="reportType" class="adl-select text-sm rounded px-3 py-2">
                            <option value="consumption">Consumption (kWh)</option>
                            <option value="returned_energy">Returned Energy (kWh)</option>
                            <option value="voltage">Voltage (V)</option>
                            <option value="current">Current (A)</option>
                        </select>
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
                        class="px-4 py-2 bg-[var(--color-success)] text-white rounded hover:bg-[var(--color-success-hover)] transition-colors text-sm"
                        :disabled="generatingReport"
                        @click="generateReport"
                    >
                        <i :class="generatingReport ? 'fas fa-spinner fa-spin' : 'fas fa-download'" class="mr-2"></i>
                        {{ generatingReport ? `Generating... ${reportElapsed}s` : 'Generate &amp; Download' }}
                    </button>
                </div>
                <div v-if="generatingReport" class="mb-2">
                    <div class="w-full bg-[var(--color-surface-3)] rounded-full h-1.5 overflow-hidden">
                        <div class="bg-[var(--color-success)] h-1.5 rounded-full animate-pulse" style="width: 100%"></div>
                    </div>
                </div>
                <div v-if="reportError" class="text-sm text-[var(--color-danger-text)] mb-2">{{ reportError }}</div>
                <div v-if="lastReport" class="text-sm text-[var(--color-text-tertiary)]">
                    Last report: <a :href="lastReport.url" download class="text-[var(--color-primary-text)] hover:underline">{{ lastReport.name }}</a>
                </div>
            </div>
        </template>

        <template #uptime>
            <div v-if="showUptime && uptimeData.length > 0" class="adl-glass-card rounded-lg p-4">
                <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-3">
                    <i class="fas fa-clock mr-2 text-[var(--color-success-text)]"></i>
                    Device Uptime
                </h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="text-[var(--color-text-tertiary)] border-b border-[var(--color-border-default)]">
                                <th class="text-left py-2 px-3">Device</th>
                                <th class="text-right py-2 px-3">Uptime</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="device in uptimeData" :key="device.deviceId" class="border-b border-[var(--color-border-default)] hover:bg-[var(--glass-hover)]">
                                <td class="py-2 px-3 text-[var(--color-text-primary)]">{{ device.deviceName }}</td>
                                <td class="py-2 px-3 text-right text-[var(--color-success-text)] font-mono">{{ formatUptime(device.value) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
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
import {ArcElement, Chart, DoughnutController, Legend, Tooltip} from 'chart.js';
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router/auto';
import AnalyticsDashboardLayout from '@/components/analytics/AnalyticsDashboardLayout.vue';
import Breadcrumbs from '@/components/core/Breadcrumbs.vue';
import ConsumptionChart from '@/components/analytics/charts/ConsumptionChart.vue';
import MetricChart from '@/components/analytics/charts/MetricChart.vue';
import DashboardSettingsModal from '@/components/analytics/DashboardSettingsModal.vue';
import DateRangeSelector from '@/components/analytics/DateRangeSelector.vue';
import MetricsGrid from '@/components/analytics/metrics/MetricsGrid.vue';
import {type DashboardSettings, useAnalyticsStore} from '@/stores/analytics';
import {useGroupsStore} from '@/stores/groups';
import * as ws from '@/tools/websocket';

Chart.register(ArcElement, DoughnutController, Legend, Tooltip);

const route = useRoute();
const router = useRouter();
const analyticsStore = useAnalyticsStore();
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
const lastReport = ref<{name: string; url: string} | null>(null);
const reportType = ref('consumption');
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
    return typeof id === 'string' ? parseInt(id, 10) : null;
});

const groupId = computed(() => dashboard.value?.group_id);

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
    const powerValues = analyticsStore.groupMetrics?.metrics?.power?.values;
    return powerValues && powerValues.length > 0;
});

const showUptime = computed(
    () =>
        capabilities.value.includes('uptime') &&
        (settings.value?.enabledMetrics?.includes('uptime') ?? true)
);

const uptimeData = computed(() => {
    const values =
        (analyticsStore.groupMetrics?.metrics as any)?.uptime?.values || [];
    return values
        .map((v: any) => ({
            deviceId: v.deviceId,
            deviceName: v.deviceName || `Device ${v.deviceId}`,
            value: v.value
        }))
        .sort((a: any, b: any) => b.value - a.value);
});

function formatUptime(seconds: number): string {
    if (!seconds) return '--';

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// Canvas refs for additional charts
const powerPieCanvas = ref<HTMLCanvasElement | null>(null);
const tempCanvas = ref<HTMLCanvasElement | null>(null);
const humidityCanvas = ref<HTMLCanvasElement | null>(null);

// Chart instances
let powerChart: Chart | null = null;

// Auto-refresh
let refreshInterval: ReturnType<typeof setInterval> | null = null;

// Methods
async function fetchDashboard() {
    if (!dashboardId.value) return;

    try {
        const result = await ws.sendRPC<any[]>(
            'FLEET_MANAGER',
            'Storage.GetItem',
            {registry: 'ui', key: 'dashboards'}
        );

        const dashboards = result || [];
        dashboard.value = dashboards.find(
            (d: any) => d.id === dashboardId.value
        );

        if (!dashboard.value) {
            console.error('Dashboard not found');
            router.push('/dash/1');
            return;
        }

        // Verify this is an analytics dashboard
        if (dashboard.value.dashboard_type !== 'analytics') {
            // Redirect to classic dashboard
            router.push(`/dash/${dashboardId.value}`);
            return;
        }
    } catch (err) {
        console.error('Failed to fetch dashboard:', err);
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

    const result = await analyticsStore.fetchGroupCapabilities(groupId.value);
    capabilities.value = result?.capabilities || [];
}

async function fetchMetrics() {
    if (!groupId.value) return;

    await analyticsStore.fetchGroupMetrics(groupId.value);
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
        // Render power chart after metrics are loaded
        await nextTick();
        renderPowerChart();
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

async function generateReport() {
    if (!groupId.value) return;

    generatingReport.value = true;
    reportError.value = null;
    reportElapsed.value = 0;
    reportTimer = setInterval(() => {
        reportElapsed.value++;
    }, 1000);
    try {
        const tariff = settings.value?.tariff || 0;
        const isEnergy =
            reportType.value === 'consumption' ||
            reportType.value === 'returned_energy';

        const result = await ws.sendRPC<{
            id: string;
            file: string;
            name: string;
            generated: string;
            size: number;
        }>(
            'FLEET_MANAGER',
            'fleetmanager.GenerateReport',
            {
                group_id: groupId.value,
                report_type: reportType.value,
                from: dateRange.value.from,
                to: dateRange.value.to,
                granularity: reportGranularity.value,
                per_device: reportPerDevice.value,
                tariff: isEnergy ? tariff : undefined
            },
            {timeoutMs: 300_000}
        );

        if (result?.file) {
            // Download the generated CSV
            const link = document.createElement('a');
            link.href = `/${result.file}`;
            link.download = `${result.name}.csv`;
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            lastReport.value = {
                name: `${result.name}.csv`,
                url: `/${result.file}`
            };
        }
    } catch (err: any) {
        reportError.value = err?.message || 'Failed to generate report';
        console.error('[Analytics] generateReport error:', err);
    } finally {
        if (reportTimer) {
            clearInterval(reportTimer);
            reportTimer = null;
        }
        generatingReport.value = false;
    }
}

function renderPowerChart() {
    if (!powerPieCanvas.value) return;

    const metrics = analyticsStore.groupMetrics?.metrics;
    const powerValues = metrics?.power?.values || [];

    if (powerValues.length === 0) {
        powerChart?.destroy();
        powerChart = null;
        return;
    }

    const ctx = powerPieCanvas.value.getContext('2d');
    if (!ctx) return;

    // Get device names from groupMetrics
    const devices = analyticsStore.groupMetrics?.devices || [];
    const deviceMap = new Map(
        devices.map((d: any) => [d.id, d.name || d.shellyID])
    );

    // Aggregate power by device
    const powerByDevice = new Map<string, number>();
    for (const pv of powerValues) {
        const deviceName =
            deviceMap.get(pv.deviceId) || `Device ${pv.deviceId}`;
        powerByDevice.set(
            deviceName,
            (powerByDevice.get(deviceName) || 0) + pv.value
        );
    }

    const labels = Array.from(powerByDevice.keys());
    const values = Array.from(powerByDevice.values());

    // Generate colors
    const colors = [
        'rgba(59, 130, 246, 0.8)', // blue
        'rgba(16, 185, 129, 0.8)', // green
        'rgba(249, 115, 22, 0.8)', // orange
        'rgba(139, 92, 246, 0.8)', // purple
        'rgba(236, 72, 153, 0.8)', // pink
        'rgba(245, 158, 11, 0.8)', // amber
        'rgba(6, 182, 212, 0.8)', // cyan
        'rgba(239, 68, 68, 0.8)' // red
    ];

    powerChart?.destroy();
    powerChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [
                {
                    data: values,
                    backgroundColor: colors.slice(0, labels.length),
                    borderColor: 'rgba(30, 41, 59, 1)',
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#9ca3af',
                        padding: 10
                    }
                },
                tooltip: {
                    callbacks: {
                        label(ctx) {
                            const value = ctx.parsed;
                            const total = values.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(
                                1
                            );
                            return `${ctx.label}: ${value.toFixed(1)} W (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
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
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    if (reportTimer) {
        clearInterval(reportTimer);
    }
    powerChart?.destroy();
    analyticsStore.clearData();
});

// Watch for dashboard ID changes (navigating between analytics dashboards)
watch(dashboardId, async (newId, oldId) => {
    if (newId && newId !== oldId) {
        analyticsStore.clearData();
        loading.value = true;
        await fetchDashboard();
        if (dashboard.value) {
            await Promise.all([fetchSettings(), fetchCapabilities()]);
            await refreshData();
            setupAutoRefresh();
        }
        loading.value = false;
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
