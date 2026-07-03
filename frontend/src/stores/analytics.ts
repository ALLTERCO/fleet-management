import type {EnergyQueryResponse, EnergyQueryRow} from '@api/energy';
import {defineStore} from 'pinia';
import {computed, ref} from 'vue';
import {normaliseDashboardSettings} from '@/helpers/dashboardSettings';
import type {
    DashboardSettings,
    DashboardType,
    DomainDashboard,
    DomainDashboardType
} from '@/types/dashboard';
import * as ws from '../tools/websocket';

// Types
export type ScopeKind = 'group' | 'location' | 'tag' | 'fleet';

export interface ScopeMetrics {
    scopeKind: ScopeKind;
    scopeId: number | null;
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
    phaseMetrics: PhaseMetricsSnapshot | null;
}

export interface PhaseMetricsSnapshot {
    threePhaseDeviceCount: number;
    phases: {
        label: string;
        totalPower: number;
        avgVoltage: number | null;
        avgCurrent: number | null;
    }[];
    imbalancedCount: number;
    worstImbalanced: {
        deviceId: number;
        shellyId: string;
        deviceName: string;
        imbalancePct: number;
        channels: unknown[];
    }[];
}

export interface DeviceInfo {
    id: number;
    shellyID: string;
    name: string;
    hasEmChannels?: boolean;
    hasEm1Channels?: boolean;
}

export interface MetricData {
    avg: number;
    min: number;
    max: number;
    total?: number;
    values: {deviceId: number; deviceName?: string; value: number}[];
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

// --- energy.query envelope + mapping helpers -----------------------------

// Legacy `granularity` enum → bucket string accepted by energy.query.
const GRAN_TO_BUCKET: Record<'hour' | 'day' | 'month', string> = {
    hour: '1 hour',
    day: '1 day',
    month: '1 month'
};

// Legacy metric name → energy.query tag.
const METRIC_TO_TAG: Record<string, string> = {
    consumption: 'total_act_energy',
    returned_energy: 'total_act_ret_energy',
    voltage: 'voltage',
    current: 'current',
    power: 'power'
};

function toConsumption(r: EnergyQueryRow): ConsumptionData {
    return {
        bucket: r.bucket,
        deviceId: r.device,
        shellyId: r.shellyID ?? undefined,
        value: r.value
    };
}

function toEnvironmental(r: EnergyQueryRow): EnvironmentalData {
    return {
        bucket: r.bucket,
        deviceId: r.device,
        avgValue: r.value,
        minValue: r.min ?? r.value,
        maxValue: r.max ?? r.value
    };
}

export {DOMAIN_TYPE_META, DOMAIN_TYPES} from '@/types/dashboard';
export type {DashboardSettings, DomainDashboard, DomainDashboardType};

export interface ScopeCapabilities {
    scopeKind: ScopeKind;
    scopeId: number | null;
    capabilities: string[];
    deviceCount: number;
}

export const useAnalyticsStore = defineStore('analytics', () => {
    // State — use a counter so concurrent fetches don't prematurely clear loading
    const loadingCount = ref(0);
    const loading = computed(() => loadingCount.value > 0);
    const error = ref<string | null>(null);
    const scopeMetrics = ref<ScopeMetrics | null>(null);
    const consumptionHistory = ref<ConsumptionData[]>([]);
    const voltageHistory = ref<ConsumptionData[]>([]);
    const currentHistory = ref<ConsumptionData[]>([]);
    const returnedEnergyHistory = ref<ConsumptionData[]>([]);
    const environmentalHistory = ref<EnvironmentalData[]>([]);
    const settings = ref<DashboardSettings | null>(null);
    const capabilities = ref<ScopeCapabilities | null>(null);

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

    // Per-ref seq tokens so a stale (older) response can't overwrite
    // a newer one when filters change faster than RPCs settle.
    let scopeMetricsSeq = 0;
    let consumptionSeq = 0;
    let environmentalSeq = 0;
    let capabilitiesSeq = 0;
    let settingsSeq = 0;
    const metricHistorySeq: Record<string, number> = {
        consumption: 0,
        voltage: 0,
        current: 0,
        returned_energy: 0
    };

    // Actions
    async function fetchScopeMetrics(groupId: number) {
        const seq = ++scopeMetricsSeq;
        loadingCount.value++;
        error.value = null;
        try {
            const result = await ws.sendRPC<ScopeMetrics>(
                'FLEET_MANAGER',
                'fleet.GetMetrics',
                {scope: {groupId}}
            );
            if (seq !== scopeMetricsSeq) return null;
            scopeMetrics.value = result;
            return result;
        } catch (err: any) {
            if (seq !== scopeMetricsSeq) return null;
            error.value = err?.message ?? 'Failed to fetch scope metrics';
            console.error('[Analytics] fetchScopeMetrics error:', err);
            return null;
        } finally {
            loadingCount.value--;
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
        const seq = ++consumptionSeq;
        loadingCount.value++;
        error.value = null;
        try {
            const result = await ws.sendRPC<EnergyQueryResponse>(
                'FLEET_MANAGER',
                'energy.query',
                {
                    scope: {groupId},
                    from,
                    to,
                    tags: ['total_act_energy'],
                    bucket: GRAN_TO_BUCKET[granularity]
                }
            );
            if (seq !== consumptionSeq) return null;
            const data = applyTariffCost(
                (result?.items ?? []).map(toConsumption)
            );
            consumptionHistory.value = data;
            return result;
        } catch (err: any) {
            if (seq !== consumptionSeq) return null;
            error.value = err?.message ?? 'Failed to fetch consumption history';
            console.error('[Analytics] fetchConsumptionHistory error:', err);
            return null;
        } finally {
            loadingCount.value--;
        }
    }

    /** Map from metric name to its corresponding state ref. */
    const metricHistoryRefs: Record<string, typeof voltageHistory> = {
        consumption: consumptionHistory,
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
        const seq = ++metricHistorySeq[metric];
        loadingCount.value++;
        try {
            const result = await ws.sendRPC<EnergyQueryResponse>(
                'FLEET_MANAGER',
                'energy.query',
                {
                    scope: {groupId},
                    from,
                    to,
                    tags: [METRIC_TO_TAG[metric]],
                    bucket: GRAN_TO_BUCKET[granularity]
                }
            );
            if (seq !== metricHistorySeq[metric]) return null;
            const data = (result?.items ?? []).map(toConsumption);
            const target = metricHistoryRefs[metric];
            if (target) target.value = data;
            return result;
        } catch (err: any) {
            if (seq !== metricHistorySeq[metric]) return null;
            error.value = err?.message ?? 'Failed to fetch metric history';
            console.error(
                `[Analytics] fetchMetricHistory(${metric}) error:`,
                err
            );
            return null;
        } finally {
            loadingCount.value--;
        }
    }

    async function fetchEnvironmentalHistory(
        groupId: number,
        from: string,
        to: string,
        metric: 'temperature' | 'humidity' | 'luminance'
    ) {
        const seq = ++environmentalSeq;
        loadingCount.value++;
        error.value = null;
        try {
            const result = await ws.sendRPC<EnergyQueryResponse>(
                'FLEET_MANAGER',
                'energy.query',
                {
                    scope: {groupId},
                    from,
                    to,
                    tags: [metric]
                }
            );
            if (seq !== environmentalSeq) return null;
            environmentalHistory.value = (result?.items ?? []).map(
                toEnvironmental
            );
            return result;
        } catch (err: any) {
            if (seq !== environmentalSeq) return null;
            error.value =
                err?.message ?? 'Failed to fetch environmental history';
            console.error('[Analytics] fetchEnvironmentalHistory error:', err);
            return null;
        } finally {
            loadingCount.value--;
        }
    }

    async function fetchScopeCapabilities(groupId: number) {
        const seq = ++capabilitiesSeq;
        try {
            const result = await ws.sendRPC<ScopeCapabilities>(
                'FLEET_MANAGER',
                'fleet.GetCapabilities',
                {scope: {groupId}}
            );
            if (seq !== capabilitiesSeq) return null;
            capabilities.value = result;
            return result;
        } catch (err: any) {
            console.error('[Analytics] fetchScopeCapabilities error:', err);
            return null;
        }
    }

    async function fetchDashboardSettings(dashboardId: number) {
        const seq = ++settingsSeq;
        try {
            const result = await ws.sendRPC<DashboardSettings>(
                'FLEET_MANAGER',
                'dashboard.getsettings',
                {dashboardId}
            );
            if (seq !== settingsSeq) return null;
            const normalised = normaliseDashboardSettings(result);
            settings.value = normalised;
            return normalised;
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
            await ws.sendRPC('FLEET_MANAGER', 'dashboard.setsettings', {
                dashboardId,
                ...normaliseDashboardSettings(newSettings)
            });
            // Refresh settings
            await fetchDashboardSettings(dashboardId);
            return true;
        } catch (err: any) {
            console.error('[Analytics] updateDashboardSettings error:', err);
            return false;
        }
    }

    async function createDashboard(
        name: string,
        dashboardType: DashboardType,
        groupId?: number
    ): Promise<DomainDashboard> {
        const params = {
            name,
            dashboardType,
            ...(typeof groupId === 'number' ? {scope: {groupId}} : {})
        };
        try {
            return await ws.sendRPC<DomainDashboard>(
                'FLEET_MANAGER',
                'dashboard.create',
                params
            );
        } catch (err: any) {
            console.error('[Analytics] createDashboard error:', err);
            throw err;
        }
    }

    function createAnalyticsDashboard(name: string, groupId: number) {
        return createDashboard(name, 'analytics', groupId);
    }

    function createDomainDashboard(
        name: string,
        dashboardType: DomainDashboardType,
        groupId?: number
    ): Promise<DomainDashboard> {
        return createDashboard(name, dashboardType, groupId);
    }

    async function generateReport(params: {
        groupId: number;
        reportType: 'monthly' | 'daily' | 'custom';
        from?: string;
        to?: string;
        tariff?: number;
    }) {
        loadingCount.value++;
        error.value = null;
        try {
            if (params.reportType === 'monthly') {
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
            }
            const result = await fetchConsumptionHistory(
                params.groupId,
                params.from ||
                    new Date(
                        Date.now() - 7 * 24 * 60 * 60 * 1000
                    ).toISOString(),
                params.to || new Date().toISOString(),
                'day'
            );
            return result;
        } catch (err: any) {
            error.value = err?.message ?? 'Failed to generate report';
            console.error('[Analytics] generateReport error:', err);
            return null;
        } finally {
            loadingCount.value--;
        }
    }

    function clearData() {
        scopeMetrics.value = null;
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
        scopeMetrics,
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
        fetchScopeMetrics,
        fetchConsumptionHistory,
        fetchMetricHistory,
        fetchEnvironmentalHistory,
        fetchScopeCapabilities,
        fetchDashboardSettings,
        updateDashboardSettings,
        createAnalyticsDashboard,
        createDomainDashboard,
        generateReport,
        clearData
    };
});
