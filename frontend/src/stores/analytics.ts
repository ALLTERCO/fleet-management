import type {EnergyQueryResponse, EnergyQueryRow} from '@api/energy';
import {defineStore} from 'pinia';
import {computed, ref} from 'vue';
import {normaliseDashboardSettings} from '@/helpers/dashboardSettings';
import {toastRpcError} from '@/helpers/domainErrors';
import type {PhaseMetrics} from '@/helpers/liveMetrics';
import {createStaleGuard, type StaleGuard} from '@/stores/staleGuard';
import {useToastStore} from '@/stores/toast';
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
    phaseMetrics: PhaseMetrics | null;
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
    const toast = useToastStore();
    // State — use a counter so concurrent fetches don't prematurely clear loading
    const loadingCount = ref(0);
    const loading = computed(() => loadingCount.value > 0);
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

    // Per-ref stale guards so a stale (older) response can't overwrite
    // a newer one when filters change faster than RPCs settle.
    const scopeMetricsGuard = createStaleGuard();
    const consumptionGuard = createStaleGuard();
    const environmentalGuard = createStaleGuard();
    const capabilitiesGuard = createStaleGuard();
    const settingsGuard = createStaleGuard();
    const metricHistoryGuards: Record<string, StaleGuard> = {
        consumption: createStaleGuard(),
        voltage: createStaleGuard(),
        current: createStaleGuard(),
        returned_energy: createStaleGuard()
    };

    // Actions
    async function fetchScopeMetrics(groupId: number) {
        const token = scopeMetricsGuard.bump();
        loadingCount.value++;
        try {
            const result = await ws.sendRPC<ScopeMetrics>(
                'FLEET_MANAGER',
                'fleet.GetMetrics',
                {scope: {groupId}}
            );
            if (scopeMetricsGuard.isStale(token)) return null;
            scopeMetrics.value = result;
            return result;
        } catch (err: any) {
            if (scopeMetricsGuard.isStale(token)) return null;
            toastRpcError(toast, err, 'Failed to load scope metrics');
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
        const token = consumptionGuard.bump();
        loadingCount.value++;
        try {
            const result = await ws.sendRPC<EnergyQueryResponse>(
                'FLEET_MANAGER',
                'energy.query',
                {
                    scope: {groupId},
                    from,
                    to,
                    tags: ['total_act_energy'],
                    // AC grid electricity view — keep DC energy out of the total.
                    commodity: 'electricity',
                    electricalSource: 'ac_mains',
                    bucket: GRAN_TO_BUCKET[granularity]
                }
            );
            if (consumptionGuard.isStale(token)) return null;
            const data = applyTariffCost(
                (result?.items ?? []).map(toConsumption)
            );
            consumptionHistory.value = data;
            return result;
        } catch (err: any) {
            if (consumptionGuard.isStale(token)) return null;
            toastRpcError(toast, err, 'Failed to load consumption history');
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
        const token = metricHistoryGuards[metric].bump();
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
                    // AC electrical metrics — DC readings have their own view.
                    commodity: 'electricity',
                    electricalSource: 'ac_mains',
                    bucket: GRAN_TO_BUCKET[granularity]
                }
            );
            if (metricHistoryGuards[metric].isStale(token)) return null;
            const data = (result?.items ?? []).map(toConsumption);
            const target = metricHistoryRefs[metric];
            if (target) target.value = data;
            return result;
        } catch (err: any) {
            if (metricHistoryGuards[metric].isStale(token)) return null;
            toastRpcError(toast, err, `Failed to load ${metric} history`);
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
        const token = environmentalGuard.bump();
        loadingCount.value++;
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
            if (environmentalGuard.isStale(token)) return null;
            environmentalHistory.value = (result?.items ?? []).map(
                toEnvironmental
            );
            return result;
        } catch (err: any) {
            if (environmentalGuard.isStale(token)) return null;
            toastRpcError(toast, err, 'Failed to load environmental history');
            return null;
        } finally {
            loadingCount.value--;
        }
    }

    async function fetchScopeCapabilities(groupId: number) {
        const token = capabilitiesGuard.bump();
        try {
            const result = await ws.sendRPC<ScopeCapabilities>(
                'FLEET_MANAGER',
                'fleet.GetCapabilities',
                {scope: {groupId}}
            );
            if (capabilitiesGuard.isStale(token)) return null;
            capabilities.value = result;
            return result;
        } catch (err: any) {
            toastRpcError(toast, err, 'Failed to load scope capabilities');
            return null;
        }
    }

    async function fetchDashboardSettings(dashboardId: number) {
        const token = settingsGuard.bump();
        try {
            const result = await ws.sendRPC<DashboardSettings>(
                'FLEET_MANAGER',
                'dashboard.getsettings',
                {dashboardId}
            );
            if (settingsGuard.isStale(token)) return null;
            const normalised = normaliseDashboardSettings(result);
            settings.value = normalised;
            return normalised;
        } catch (err: any) {
            toastRpcError(toast, err, 'Failed to load dashboard settings');
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
            toastRpcError(toast, err, 'Failed to save dashboard settings');
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
            toastRpcError(toast, err, 'Failed to generate report');
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
    }

    return {
        // State
        loading,
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
        createDomainDashboard,
        generateReport,
        clearData
    };
});
