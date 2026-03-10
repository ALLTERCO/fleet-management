import {defineStore} from 'pinia';
import {computed, ref} from 'vue';
import * as ws from '../tools/websocket';

// Types
export interface GroupMetrics {
    groupId: number;
    devices: DeviceInfo[];
    metrics: {
        uptime: MetricData;
        voltage: MetricData;
        current: MetricData;
        power: MetricData;
        consumption: MetricData;
        returned_energy: MetricData;
        temperature: MetricData;
        humidity: MetricData;
        luminance: MetricData;
    };
}

export interface DeviceInfo {
    id: number;
    shellyID: string;
    name: string;
}

export interface MetricData {
    avg: number;
    min: number;
    max: number;
    total?: number;
    values: {deviceId: number; value: number}[];
}

export interface ConsumptionData {
    bucket: string;
    deviceId: number;
    deviceName?: string;
    shellyId?: string;
    value: number;
    cost?: number;
}

export interface EnvironmentalData {
    bucket: string;
    deviceId: number;
    avgValue: number;
    minValue: number;
    maxValue: number;
}

export interface DashboardSettings {
    dashboardId: number;
    tariff: number;
    currency: string;
    defaultRange: string;
    refreshInterval: number;
    enabledMetrics: string[];
    chartSettings: Record<string, any>;
}

export interface GroupCapabilities {
    groupId: number;
    capabilities: string[];
    deviceCount: number;
}

export const useAnalyticsStore = defineStore('analytics', () => {
    // State
    const loading = ref(false);
    const error = ref<string | null>(null);
    const groupMetrics = ref<GroupMetrics | null>(null);
    const consumptionHistory = ref<ConsumptionData[]>([]);
    const voltageHistory = ref<ConsumptionData[]>([]);
    const currentHistory = ref<ConsumptionData[]>([]);
    const returnedEnergyHistory = ref<ConsumptionData[]>([]);
    const environmentalHistory = ref<EnvironmentalData[]>([]);
    const settings = ref<DashboardSettings | null>(null);
    const capabilities = ref<GroupCapabilities | null>(null);

    // Computed — capability checks
    function hasCapability(name: string) {
        return computed(
            () => capabilities.value?.capabilities.includes(name) ?? false
        );
    }
    const hasUptime = hasCapability('uptime');
    const hasVoltage = hasCapability('voltage');
    const hasCurrent = hasCapability('current');
    const hasPower = hasCapability('power');
    const hasConsumption = hasCapability('consumption');
    const hasReturnedEnergy = hasCapability('returned_energy');
    const hasTemperature = hasCapability('temperature');
    const hasHumidity = hasCapability('humidity');
    const hasLuminance = hasCapability('luminance');

    const tariff = computed(() => settings.value?.tariff ?? 0);
    const currency = computed(() => settings.value?.currency ?? 'EUR');

    // Actions
    async function fetchGroupMetrics(groupId: number) {
        loading.value = true;
        error.value = null;
        try {
            const result = await ws.sendRPC<GroupMetrics>(
                'FLEET_MANAGER',
                'fleetmanager.GetGroupMetrics',
                {groupId}
            );
            groupMetrics.value = result;
            return result;
        } catch (err: any) {
            error.value = err?.message ?? 'Failed to fetch group metrics';
            console.error('[Analytics] fetchGroupMetrics error:', err);
            return null;
        } finally {
            loading.value = false;
        }
    }

    /** Apply tariff cost to raw consumption data points. */
    function applyTariffCost(data: ConsumptionData[]): ConsumptionData[] {
        if (tariff.value <= 0) return data;
        return data.map((d) => ({...d, cost: d.value * tariff.value}));
    }

    async function fetchConsumptionHistory(
        groupId: number,
        from: string,
        to: string,
        granularity: 'hour' | 'day' | 'month' = 'day'
    ) {
        loading.value = true;
        error.value = null;
        try {
            const result = await ws.sendRPC<{
                groupId: number;
                data: ConsumptionData[];
                total: number;
            }>('FLEET_MANAGER', 'fleetmanager.GetConsumptionHistory', {
                groupId,
                from,
                to,
                granularity
            });

            // Separate query result from state mutation
            const data = applyTariffCost(result?.data ?? []);
            consumptionHistory.value = data;

            return result;
        } catch (err: any) {
            error.value = err?.message ?? 'Failed to fetch consumption history';
            console.error('[Analytics] fetchConsumptionHistory error:', err);
            return null;
        } finally {
            loading.value = false;
        }
    }

    /** Map from metric name to its corresponding state ref. */
    const metricHistoryRefs: Record<string, typeof voltageHistory> = {
        voltage: voltageHistory,
        current: currentHistory,
        returned_energy: returnedEnergyHistory
    };

    async function fetchMetricHistory(
        groupId: number,
        from: string,
        to: string,
        metric: 'consumption' | 'returned_energy' | 'voltage' | 'current',
        granularity: 'hour' | 'day' | 'month' = 'day'
    ) {
        try {
            const result = await ws.sendRPC<{
                groupId: number;
                data: ConsumptionData[];
                total: number;
            }>('FLEET_MANAGER', 'fleetmanager.GetMetricHistory', {
                groupId,
                from,
                to,
                metric,
                granularity
            });
            const data = result?.data ?? [];

            // State mutation — separated from the query above
            const target = metricHistoryRefs[metric];
            if (target) target.value = data;

            return result;
        } catch (err: any) {
            console.error(
                `[Analytics] fetchMetricHistory(${metric}) error:`,
                err
            );
            return null;
        }
    }

    async function fetchEnvironmentalHistory(
        groupId: number,
        from: string,
        to: string,
        metric: 'temperature' | 'humidity' | 'luminance'
    ) {
        loading.value = true;
        error.value = null;
        try {
            const result = await ws.sendRPC<{
                groupId: number;
                data: EnvironmentalData[];
                metric: string;
            }>('FLEET_MANAGER', 'fleetmanager.GetEnvironmentalHistory', {
                groupId,
                from,
                to,
                metric
            });
            environmentalHistory.value = result?.data ?? [];
            return result;
        } catch (err: any) {
            error.value =
                err?.message ?? 'Failed to fetch environmental history';
            console.error('[Analytics] fetchEnvironmentalHistory error:', err);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function fetchGroupCapabilities(groupId: number) {
        try {
            const result = await ws.sendRPC<GroupCapabilities>(
                'FLEET_MANAGER',
                'fleetmanager.GetGroupCapabilities',
                {groupId}
            );
            capabilities.value = result;
            return result;
        } catch (err: any) {
            console.error('[Analytics] fetchGroupCapabilities error:', err);
            return null;
        }
    }

    async function fetchDashboardSettings(dashboardId: number) {
        try {
            const result = await ws.sendRPC<DashboardSettings>(
                'FLEET_MANAGER',
                'fleetmanager.GetDashboardSettings',
                {dashboardId}
            );
            settings.value = result;
            return result;
        } catch (err: any) {
            console.error('[Analytics] fetchDashboardSettings error:', err);
            return null;
        }
    }

    async function updateDashboardSettings(
        dashboardId: number,
        newSettings: Partial<DashboardSettings>
    ) {
        try {
            await ws.sendRPC(
                'FLEET_MANAGER',
                'fleetmanager.SetDashboardSettings',
                {dashboardId, ...newSettings}
            );
            // Refresh settings
            await fetchDashboardSettings(dashboardId);
            return true;
        } catch (err: any) {
            console.error('[Analytics] updateDashboardSettings error:', err);
            return false;
        }
    }

    async function createAnalyticsDashboard(name: string, groupId: number) {
        try {
            const result = await ws.sendRPC<{
                id: number;
                name: string;
                groupId: number;
                dashboardType: string;
            }>('FLEET_MANAGER', 'fleetmanager.CreateAnalyticsDashboard', {
                name,
                groupId
            });
            return result;
        } catch (err: any) {
            console.error('[Analytics] createAnalyticsDashboard error:', err);
            throw err;
        }
    }

    async function generateReport(params: {
        groupId: number;
        reportType: 'monthly' | 'daily' | 'custom';
        from?: string;
        to?: string;
        tariff?: number;
    }) {
        loading.value = true;
        error.value = null;
        try {
            // For monthly reports, use FetchMonthlyReport with report_config_id
            // For custom range reports, use FetchRange
            if (params.reportType === 'monthly') {
                // Note: FetchMonthlyReport requires a report_config_id from logging.report_configs
                // For now, return consumption history data as report
                const result = await fetchConsumptionHistory(
                    params.groupId,
                    params.from ||
                        new Date(
                            Date.now() - 30 * 24 * 60 * 60 * 1000
                        ).toISOString(),
                    params.to || new Date().toISOString(),
                    'day'
                );
                return result;
            } else {
                // Use consumption history for daily/custom reports
                const result = await fetchConsumptionHistory(
                    params.groupId,
                    params.from ||
                        new Date(
                            Date.now() - 7 * 24 * 60 * 60 * 1000
                        ).toISOString(),
                    params.to || new Date().toISOString(),
                    params.reportType === 'daily' ? 'day' : 'day'
                );
                return result;
            }
        } catch (err: any) {
            error.value = err?.message ?? 'Failed to generate report';
            console.error('[Analytics] generateReport error:', err);
            return null;
        } finally {
            loading.value = false;
        }
    }

    function clearData() {
        groupMetrics.value = null;
        consumptionHistory.value = [];
        voltageHistory.value = [];
        currentHistory.value = [];
        returnedEnergyHistory.value = [];
        environmentalHistory.value = [];
        settings.value = null;
        capabilities.value = null;
        error.value = null;
    }

    return {
        // State
        loading,
        error,
        groupMetrics,
        consumptionHistory,
        voltageHistory,
        currentHistory,
        returnedEnergyHistory,
        environmentalHistory,
        settings,
        capabilities,

        // Computed
        hasUptime,
        hasVoltage,
        hasCurrent,
        hasPower,
        hasConsumption,
        hasReturnedEnergy,
        hasTemperature,
        hasHumidity,
        hasLuminance,
        tariff,
        currency,

        // Actions
        fetchGroupMetrics,
        fetchConsumptionHistory,
        fetchMetricHistory,
        fetchEnvironmentalHistory,
        fetchGroupCapabilities,
        fetchDashboardSettings,
        updateDashboardSettings,
        createAnalyticsDashboard,
        generateReport,
        clearData
    };
});
