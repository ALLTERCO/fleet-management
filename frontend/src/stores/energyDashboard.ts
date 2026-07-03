import type {EnergyQueryResponse, EnergyQueryRow} from '@api/energy';
import {defineStore} from 'pinia';
import {computed, ref} from 'vue';
import {normaliseDashboardSettings} from '@/helpers/dashboardSettings';
import {getDeviceName} from '@/helpers/device';
import type {EmChannel, PhaseMetrics} from '@/helpers/liveMetrics';
import {computePhaseMetrics, extractEmChannels} from '@/helpers/liveMetrics';
import * as ws from '@/tools/websocket';
import type {DashboardSettings} from '@/types/dashboard';

export type {EmChannel, PhaseMetrics};

function extractDevicePower(status: any): number {
    if (!status) return 0;
    let total = 0;
    for (let i = 0; i < 5; i++) {
        const sw = status[`switch:${i}`];
        if (sw?.apower != null) total += sw.apower;
        const em = status[`em:${i}`];
        if (em?.act_power != null) total += em.act_power;
        const em1 = status[`em1:${i}`];
        if (em1?.act_power != null) total += em1.act_power;
        const pm = status[`pm1:${i}`];
        if (pm?.apower != null) total += pm.apower;
    }
    return total;
}

export interface ConsumptionDataPoint {
    bucket: string;
    deviceId: number;
    value: number; // kWh
    shellyId?: string | null;
}

const GRAN_TO_BUCKET: Record<'hour' | 'day' | 'month', string> = {
    hour: '1 hour',
    day: '1 day',
    month: '1 month'
};

function toConsumption(r: EnergyQueryRow): ConsumptionDataPoint {
    return {
        bucket: r.bucket,
        deviceId: r.device,
        value: r.value,
        shellyId: r.shellyID
    };
}

export interface EnergyPeriodData {
    current: ConsumptionDataPoint[];
    previous: ConsumptionDataPoint[];
    granularity: 'hour' | 'day' | 'month';
    from: string;
    to: string;
}

export interface MeterRow {
    deviceId: number;
    shellyId: string;
    deviceName: string;
    consumptionPeriod: number;
    costPeriod: number;
    livePower: number;
    online: boolean;
    share: number;
    hasEmChannels: boolean;
    hasEm1Channels: boolean;
}

export function calculateCostFromFlat(
    data: ConsumptionDataPoint[],
    s: DashboardSettings,
    deviceId?: number
): number {
    const filtered =
        deviceId !== undefined
            ? data.filter((d) => d.deviceId === deviceId)
            : data;
    if (s.tariffMode === 'single') {
        return filtered.reduce((sum, point) => sum + point.value * s.tariff, 0);
    }
    const dayRate = s.dayRate ?? s.tariff ?? 0;
    const nightRate = s.nightRate ?? s.tariff ?? 0;
    const dayStartH = Number.parseInt(s.dayStart.slice(0, 2), 10);
    const dayEndH = Number.parseInt(s.dayEnd.slice(0, 2), 10);
    const dayFraction = Math.max(0, Math.min(24, dayEndH - dayStartH)) / 24;
    // Hourly buckets classify by their hour; whole-day/month buckets sit at 00:00
    // and span both windows, so blend by the day-hour share — else getUTCHours()===0
    // prices every daily bucket at the night rate.
    const hourly = filtered.some((p) => new Date(p.bucket).getUTCHours() !== 0);
    return filtered.reduce((sum, point) => {
        if (hourly) {
            const hour = new Date(point.bucket).getUTCHours();
            return sum + point.value * (hour >= dayStartH && hour < dayEndH ? dayRate : nightRate);
        }
        return sum + point.value * (dayFraction * dayRate + (1 - dayFraction) * nightRate);
    }, 0);
}

export function buildHeatmap(
    data: ConsumptionDataPoint[]
): {hour: number; day: number; value: number}[] {
    const matrix: Record<string, number> = {};
    for (const point of data) {
        const date = new Date(point.bucket);
        const key = `${date.getUTCDay()}-${date.getUTCHours()}`;
        matrix[key] = (matrix[key] ?? 0) + point.value;
    }
    return Object.entries(matrix).map(([key, value]) => {
        const [day, hour] = key.split('-').map(Number);
        return {day, hour, value};
    });
}

interface LiveDevice {
    id: number;
    shellyId: string;
    name: string;
    power: number;
    online: boolean;
    hasEmChannels: boolean;
    hasEm1Channels: boolean;
}

export const useEnergyDashboardStore = defineStore('energyDashboard', () => {
    const loading = ref(false);
    const error = ref<string | null>(null);
    const settings = ref<DashboardSettings | null>(null);
    const periodData = ref<EnergyPeriodData | null>(null);
    const liveDevices = ref<LiveDevice[]>([]);
    const phaseMetrics = ref<PhaseMetrics | null>(null);
    const groupId = ref<number | null>(null);

    const totalConsumption = computed(
        () =>
            periodData.value?.current.reduce((sum, d) => sum + d.value, 0) ??
            null
    );

    const totalPreviousConsumption = computed(
        () =>
            periodData.value?.previous.reduce((sum, d) => sum + d.value, 0) ??
            null
    );

    const consumptionDelta = computed(() => {
        const cur = totalConsumption.value;
        const prev = totalPreviousConsumption.value;
        if (cur === null || !prev || prev === 0) return null;
        return Math.round(((cur - prev) / prev) * 100);
    });

    const totalCost = computed(() => {
        const data = periodData.value?.current;
        if (!data?.length || !settings.value) return null;
        return calculateCostFromFlat(data, settings.value);
    });

    const projectedMonthlyCost = computed(() => {
        const pd = periodData.value;
        if (!totalCost.value || !pd) return null;
        const from = new Date(pd.from);
        const to = new Date(pd.to);
        const daysElapsed = Math.max(
            1,
            (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
        );
        const daysInMonth = new Date(
            from.getFullYear(),
            from.getMonth() + 1,
            0
        ).getDate();
        return (totalCost.value / daysElapsed) * daysInMonth;
    });

    const heatmapData = computed(() =>
        periodData.value ? buildHeatmap(periodData.value.current) : []
    );

    const peakHourInsight = computed(() => {
        const data = heatmapData.value;
        if (!data.length) return null;
        const peak = data.reduce(
            (max, b) => (b.value > max.value ? b : max),
            data[0]
        );
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return `Highest usage: ${days[peak.day]} at ${peak.hour}:00`;
    });

    const meterRows = computed((): MeterRow[] => {
        const data = periodData.value?.current;
        if (!data?.length || !settings.value) return [];

        const deviceMap = new Map(liveDevices.value.map((d) => [d.id, d]));

        const totals: Record<number, number> = {};
        for (const point of data) {
            totals[point.deviceId] =
                (totals[point.deviceId] ?? 0) + point.value;
        }

        const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);
        const s = settings.value;

        return Object.entries(totals)
            .map(([id, consumption]) => {
                const numId = Number(id);
                const dev = deviceMap.get(numId);
                return {
                    deviceId: numId,
                    shellyId: dev?.shellyId ?? '',
                    deviceName: dev?.name ?? `Device ${numId}`,
                    consumptionPeriod: consumption,
                    costPeriod: calculateCostFromFlat(data, s, numId),
                    livePower: dev?.power ?? 0,
                    online: dev?.online ?? false,
                    share:
                        grandTotal > 0
                            ? Math.round((consumption / grandTotal) * 100)
                            : 0,
                    hasEmChannels: dev?.hasEmChannels ?? false,
                    hasEm1Channels: dev?.hasEm1Channels ?? false
                };
            })
            .sort((a, b) => b.consumptionPeriod - a.consumptionPeriod);
    });

    const hasThreePhaseDevices = computed(
        () => (phaseMetrics.value?.threePhaseDeviceCount ?? 0) > 0
    );

    async function fetchPeriodData(
        gId: number,
        from: string,
        to: string,
        granularity: 'hour' | 'day' | 'month'
    ) {
        loading.value = true;
        error.value = null;
        try {
            const [currentRes, previousRes] = await Promise.all([
                ws.sendRPC<EnergyQueryResponse>(
                    'FLEET_MANAGER',
                    'energy.query',
                    {
                        scope: {groupId: gId},
                        from,
                        to,
                        tags: ['total_act_energy'],
                        bucket: GRAN_TO_BUCKET[granularity]
                    }
                ),
                (() => {
                    const duration =
                        new Date(to).getTime() - new Date(from).getTime();
                    const prevFrom = new Date(
                        new Date(from).getTime() - duration
                    ).toISOString();
                    const prevTo = new Date(
                        new Date(to).getTime() - duration
                    ).toISOString();
                    return ws.sendRPC<EnergyQueryResponse>(
                        'FLEET_MANAGER',
                        'energy.query',
                        {
                            scope: {groupId: gId},
                            from: prevFrom,
                            to: prevTo,
                            tags: ['total_act_energy'],
                            bucket: GRAN_TO_BUCKET[granularity]
                        }
                    );
                })()
            ]);
            periodData.value = {
                current: (currentRes?.items ?? []).map(toConsumption),
                previous: (previousRes?.items ?? []).map(toConsumption),
                granularity,
                from,
                to
            };
        } catch (err: any) {
            error.value = err?.message ?? 'Failed to fetch energy data';
            console.error('[EnergyDashboard] fetchPeriodData error:', err);
        } finally {
            loading.value = false;
        }
    }

    async function fetchSettings(dashboardId: number) {
        try {
            const result = await ws.sendRPC<DashboardSettings>(
                'FLEET_MANAGER',
                'dashboard.getsettings',
                {dashboardId}
            );
            settings.value = normaliseDashboardSettings(result);
        } catch (err: any) {
            error.value = err?.message ?? 'Failed to fetch settings';
            console.error('[EnergyDashboard] fetchSettings error:', err);
        }
    }

    async function fetchPeriodDataFleet(
        from: string,
        to: string,
        granularity: 'hour' | 'day' | 'month'
    ) {
        loading.value = true;
        error.value = null;
        try {
            const duration = new Date(to).getTime() - new Date(from).getTime();
            const prevFrom = new Date(
                new Date(from).getTime() - duration
            ).toISOString();
            const prevTo = new Date(
                new Date(to).getTime() - duration
            ).toISOString();

            const [currentRes, prevRes] = await Promise.all([
                ws.sendRPC<EnergyQueryResponse>(
                    'FLEET_MANAGER',
                    'energy.query',
                    {
                        from,
                        to,
                        tags: ['total_act_energy'],
                        bucket: GRAN_TO_BUCKET[granularity]
                    }
                ),
                ws.sendRPC<EnergyQueryResponse>(
                    'FLEET_MANAGER',
                    'energy.query',
                    {
                        from: prevFrom,
                        to: prevTo,
                        tags: ['total_act_energy'],
                        bucket: GRAN_TO_BUCKET[granularity]
                    }
                )
            ]);

            periodData.value = {
                current: (currentRes?.items ?? []).map(toConsumption),
                previous: (prevRes?.items ?? []).map(toConsumption),
                granularity,
                from,
                to
            };
        } catch (err: any) {
            error.value = err?.message ?? 'Failed to fetch energy data';
            console.error('[EnergyDashboard] fetchPeriodDataFleet error:', err);
        } finally {
            loading.value = false;
        }
    }

    function setLiveDevicesNoGroup(
        shellyIds: string[],
        deviceMap: Record<string, any>
    ) {
        const emChannelsList: EmChannel[][] = [];

        liveDevices.value = shellyIds.map((shellyId, idx) => {
            const dev = deviceMap[shellyId];
            const status = dev?.status ?? {};
            const {emChannels, em1Channels} = extractEmChannels(status);
            emChannelsList.push(emChannels);
            return {
                id: dev?.id ?? idx + 1,
                shellyId,
                name: getDeviceName(dev?.info, shellyId),
                power: extractDevicePower(status),
                online: dev?.online ?? false,
                hasEmChannels: emChannels.length > 0,
                hasEm1Channels: em1Channels.length > 0
            };
        });

        // Compute phase metrics server-side equivalent — runs once, not on every render
        phaseMetrics.value = computePhaseMetrics(
            liveDevices.value.map((d) => d.id),
            liveDevices.value.map((d) => d.shellyId),
            liveDevices.value.map((d) => d.name),
            emChannelsList
        );
    }

    async function fetchLiveMetrics(gId: number) {
        try {
            const result = await ws.sendRPC<{
                devices: {
                    id: number;
                    shellyID: string;
                    name: string;
                    hasEmChannels: boolean;
                    hasEm1Channels: boolean;
                }[];
                metrics: {power: {values: {deviceId: number; value: number}[]}};
                phaseMetrics: PhaseMetrics | null;
            }>('FLEET_MANAGER', 'fleet.GetMetrics', {scope: {groupId: gId}});

            // Sum per deviceId — a 3-phase device contributes one entry per em channel
            const powerMap = new Map<number, number>();
            for (const v of result?.metrics?.power?.values ?? []) {
                powerMap.set(
                    v.deviceId,
                    (powerMap.get(v.deviceId) ?? 0) + v.value
                );
            }

            liveDevices.value = (result?.devices ?? []).map((d) => ({
                id: d.id,
                shellyId: d.shellyID,
                name: d.name,
                power: powerMap.get(d.id) ?? 0,
                online: true,
                hasEmChannels: d.hasEmChannels ?? false,
                hasEm1Channels: d.hasEm1Channels ?? false
            }));

            phaseMetrics.value = result?.phaseMetrics ?? null;
        } catch (err: any) {
            error.value = err?.message ?? 'Failed to fetch live metrics';
            console.error('[EnergyDashboard] fetchLiveMetrics error:', err);
        }
    }

    // Fetches live channel detail for a single device — called on MeterTable row expand
    async function fetchDeviceChannels(
        shellyId: string
    ): Promise<{emChannels: EmChannel[]; em1Channels: EmChannel[]}> {
        const result = await ws.sendRPC<{
            emChannels: EmChannel[];
            em1Channels: EmChannel[];
        }>('FLEET_MANAGER', 'device.getdevicechannels', {shellyID: shellyId});
        return {
            emChannels: result?.emChannels ?? [],
            em1Channels: result?.em1Channels ?? []
        };
    }

    return {
        loading,
        error,
        settings,
        periodData,
        liveDevices,
        phaseMetrics,
        heatmapData,
        groupId,
        totalConsumption,
        totalPreviousConsumption,
        consumptionDelta,
        totalCost,
        projectedMonthlyCost,
        peakHourInsight,
        meterRows,
        hasThreePhaseDevices,
        fetchPeriodData,
        fetchPeriodDataFleet,
        fetchSettings,
        fetchLiveMetrics,
        setLiveDevicesNoGroup,
        fetchDeviceChannels
    };
});
