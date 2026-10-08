import {roundCurrencyAmount} from '@api/_currency';
import {
    AC_ACTIVE_POWER_COMPONENTS,
    componentActivePower,
    devicePhaseChannels
} from '@api/componentPower';
import type {
    EnergyProjectionResponse,
    EnergyQueryPricingSummary,
    EnergyQueryResponse,
    EnergyQueryRow
} from '@api/energy';
import type {DashboardScope, FleetMetricsDevice} from '@api/fleet';
import {defineStore} from 'pinia';
import {computed, ref} from 'vue';
import {normaliseDashboardSettings} from '@/helpers/dashboardSettings';
import {getDeviceName} from '@/helpers/device';
import {toastRpcError} from '@/helpers/domainErrors';
import type {EmChannel, PhaseMetrics} from '@/helpers/liveMetrics';
import {
    computePhaseMetrics,
    extractEmChannels,
    tariffLocalTime
} from '@/helpers/liveMetrics';
import {createStaleGuard} from '@/stores/staleGuard';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import type {DashboardSettings} from '@/types/dashboard';

export type {EmChannel, PhaseMetrics};

// A device's live power = the active power of every AC power component it
// reports. The component list and the field rule both live in one home
// (componentPower.ts): AC_ACTIVE_POWER_COMPONENTS + componentActivePower
// (per-phase a/b/c → single apower/act_power → total, never double-counts).
// Same list + rule the backend fleet metrics use, so both tiers agree.
export function extractDevicePower(status: any): number {
    if (!status || typeof status !== 'object') return 0;
    let total = 0;
    for (let i = 0; i < 5; i++) {
        for (const type of AC_ACTIVE_POWER_COMPONENTS) {
            const comp = status[`${type}:${i}`];
            if (comp && typeof comp === 'object') {
                const power = componentActivePower(comp);
                if (power !== null) total += power;
            }
        }
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

/**
 * What the dashboard asks the backend to project. The run rate itself has one
 * home — `energy.projection`, over `model/report/projection.ts` — so nothing
 * here decides how thin is too thin.
 */
export interface ProjectionRequest {
    scope?: DashboardScope;
    /** Narrows to the funnel's surviving devices; omit for the whole scope. */
    devices?: string[];
    /** Start of the period being projected. */
    from: string;
    /** End of that period; in the future while the period is still running. */
    to: string;
    /** The caller's own priced total so far; null = nothing to project. */
    costSoFar: number | null;
}

export interface DashboardPricingRequest {
    scope?: DashboardScope;
    /** Exact surviving device ids when the dashboard funnel is active. */
    devices?: string[];
    from: string;
    to: string;
}

const PRICING_CHUNK_MS = 30 * 24 * 60 * 60 * 1000;

export function splitPricingRange(
    from: string,
    to: string
): {from: string; to: string}[] {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    if (!(end > start)) return [];
    const chunks: {from: string; to: string}[] = [];
    for (let cursor = start; cursor < end; cursor += PRICING_CHUNK_MS) {
        chunks.push({
            from: new Date(cursor).toISOString(),
            to: new Date(Math.min(end, cursor + PRICING_CHUNK_MS)).toISOString()
        });
    }
    return chunks;
}

function oneValue<T>(values: readonly T[], label: string): T | null {
    const unique = [...new Set(values)];
    if (unique.length > 1)
        throw new Error(`Pricing chunks use different ${label}.`);
    return unique[0] ?? null;
}

/** Deterministic merge for the backend's bounded pricing summaries. */
export function mergePricingSummaries(
    chunks: readonly EnergyQueryPricingSummary[]
): EnergyQueryPricingSummary | null {
    if (!chunks.length) return null;
    const billedUnit = oneValue(
        chunks.map((chunk) => chunk.billedUnit),
        'billed units'
    );
    if (!billedUnit)
        throw new Error('Pricing chunks do not declare a billed unit.');
    const currencies = chunks
        .map((chunk) => chunk.currency)
        .filter((value): value is string => value !== null);
    const currency = oneValue(currencies, 'currencies');
    const exportCurrencies = chunks
        .map((chunk) => chunk.exportCurrency)
        .filter((value): value is string => value !== null);
    const exportCurrency = oneValue(exportCurrencies, 'export currencies');
    const exportIds = chunks
        .map((chunk) => chunk.exportTariffId)
        .filter((value): value is number => value !== null);
    const exportTariffId = oneValue(exportIds, 'export tariffs');
    const exportSources = chunks
        .map((chunk) => chunk.exportSource)
        .filter((source) => source !== 'none');
    const exportSource =
        oneValue(exportSources, 'export tariff sources') ?? 'none';
    const sum = (pick: (chunk: EnergyQueryPricingSummary) => number) =>
        chunks.reduce((total, chunk) => total + pick(chunk), 0);
    const money = (value: number, code: string | null) =>
        roundCurrencyAmount(value, code);
    const quantity = (value: number) => +value.toFixed(6);
    const coveredConsumptionKWh = sum((chunk) => chunk.coveredConsumptionKWh);
    const unpricedConsumptionKWh = sum((chunk) => chunk.unpricedConsumptionKWh);
    const status: EnergyQueryPricingSummary['status'] =
        unpricedConsumptionKWh > 1e-12
            ? coveredConsumptionKWh > 1e-12
                ? 'partial'
                : 'unconfigured'
            : coveredConsumptionKWh > 1e-12
              ? 'priced'
              : 'unconfigured';
    const sources = new Set(
        chunks
            .map((chunk) => chunk.source)
            .filter((source) => source !== 'none')
    );
    const source: EnergyQueryPricingSummary['source'] =
        sources.size === 0
            ? 'none'
            : sources.size === 1
              ? [...sources][0]
              : 'mixed';
    const assignmentSources = [
        ...new Set(chunks.flatMap((chunk) => chunk.assignmentSources ?? []))
    ].sort();
    const exportAssignmentSources = [
        ...new Set(
            chunks.flatMap((chunk) => chunk.exportAssignmentSources ?? [])
        )
    ].sort();
    const exportCredit = chunks.every((chunk) => chunk.exportCredit !== null)
        ? money(
              sum((chunk) => chunk.exportCredit ?? 0),
              exportCurrency
          )
        : null;
    const netEnergyCost = chunks.every((chunk) => chunk.netEnergyCost !== null)
        ? money(
              sum((chunk) => chunk.netEnergyCost ?? 0),
              currency
          )
        : null;
    const gasConversions = new Map<
        string,
        NonNullable<EnergyQueryPricingSummary['gasConversions']>[number]
    >();
    for (const disclosure of chunks.flatMap(
        (chunk) => chunk.gasConversions ?? []
    )) {
        const key = `${disclosure.profileId}|${disclosure.profileRevision}|${disclosure.billedUnit}`;
        const prior = gasConversions.get(key);
        const revisions = new Map<number, number>();
        for (const [index, id] of [
            ...(prior?.calorificValueIds ?? []),
            ...disclosure.calorificValueIds
        ].entries()) {
            const revision = [
                ...(prior?.calorificValueRevisions ?? []),
                ...disclosure.calorificValueRevisions
            ][index];
            if (revision !== undefined) revisions.set(id, revision);
        }
        const calorificValueIds = [...revisions.keys()].sort((a, b) => a - b);
        gasConversions.set(key, {
            ...disclosure,
            calorificValueIds,
            calorificValueRevisions: calorificValueIds.map(
                (id) => revisions.get(id)!
            )
        });
    }
    return {
        status,
        billedUnit,
        currency,
        energyCost:
            status === 'priced'
                ? money(
                      sum((chunk) => chunk.energyCost ?? 0),
                      currency
                  )
                : null,
        coveredEnergyCost: money(
            sum((chunk) => chunk.coveredEnergyCost),
            currency
        ),
        consumptionQuantity: quantity(
            sum((chunk) => chunk.consumptionQuantity)
        ),
        returnedQuantity: quantity(sum((chunk) => chunk.returnedQuantity)),
        coveredConsumptionQuantity: quantity(
            sum((chunk) => chunk.coveredConsumptionQuantity)
        ),
        unpricedConsumptionQuantity: quantity(
            sum((chunk) => chunk.unpricedConsumptionQuantity)
        ),
        estimatedQuantity: quantity(sum((chunk) => chunk.estimatedQuantity)),
        consumptionKWh: quantity(sum((chunk) => chunk.consumptionKWh)),
        returnedKWh: quantity(sum((chunk) => chunk.returnedKWh)),
        coveredConsumptionKWh: quantity(coveredConsumptionKWh),
        unpricedConsumptionKWh: quantity(unpricedConsumptionKWh),
        dayEnergyCost: money(
            sum((chunk) => chunk.dayEnergyCost),
            currency
        ),
        nightEnergyCost: money(
            sum((chunk) => chunk.nightEnergyCost),
            currency
        ),
        estimatedKWh: quantity(sum((chunk) => chunk.estimatedKWh)),
        source,
        assignmentSources,
        tariffIds: [
            ...new Set(chunks.flatMap((chunk) => chunk.tariffIds))
        ].sort((a, b) => a - b),
        exportCurrency,
        exportCredit,
        netEnergyCost,
        exportTariffId,
        exportTariffIds: [
            ...new Set(chunks.flatMap((chunk) => chunk.exportTariffIds))
        ].sort((a, b) => a - b),
        exportSource,
        exportAssignmentSources,
        ...(gasConversions.size
            ? {gasConversions: [...gasConversions.values()]}
            : {})
    };
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

export function buildHeatmap(
    data: ConsumptionDataPoint[],
    timeZone?: string | null
): {hour: number; day: number; value: number}[] {
    const matrix: Record<string, number> = {};
    for (const point of data) {
        const {hour, day} = tariffLocalTime(point.bucket, timeZone);
        const key = `${day}-${hour}`;
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
    const toast = useToastStore();
    const loading = ref(false);
    const settings = ref<DashboardSettings | null>(null);
    const periodData = ref<EnergyPeriodData | null>(null);
    const liveDevices = ref<LiveDevice[]>([]);
    const phaseMetrics = ref<PhaseMetrics | null>(null);
    const groupId = ref<number | null>(null);
    const projection = ref<EnergyProjectionResponse | null>(null);
    const periodPricing = ref<EnergyQueryPricingSummary | null>(null);
    const previousPeriodPricing = ref<EnergyQueryPricingSummary | null>(null);
    const pricingError = ref<string | null>(null);
    // Latest-wins guards: one per state slice.
    const periodGuard = createStaleGuard();
    const liveGuard = createStaleGuard();
    const projectionGuard = createStaleGuard();
    const pricingGuard = createStaleGuard();

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
        return periodPricing.value?.status === 'priced'
            ? periodPricing.value.energyCost
            : null;
    });

    const heatmapData = computed(() =>
        periodData.value
            ? buildHeatmap(
                  periodData.value.current,
                  settings.value?.tariffTimezone
              )
            : []
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
        return Object.entries(totals)
            .map(([id, consumption]) => {
                const numId = Number(id);
                const dev = deviceMap.get(numId);
                return {
                    deviceId: numId,
                    shellyId: dev?.shellyId ?? '',
                    deviceName: dev?.name ?? `Device ${numId}`,
                    consumptionPeriod: consumption,
                    // The aggregate may span unlike per-channel tariffs. A
                    // per-device cost needs a dedicated authoritative split.
                    costPeriod: 0,
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

    // A null confidence band is the backend saying it had nothing to project
    // from. Showing its zero would be a confident number nobody measured.
    const projectedCost = computed(() =>
        projection.value === null || projection.value.confidenceBand === null
            ? null
            : projection.value.projectedCost
    );

    /** Days of readings behind the projection — what the card is waiting on. */
    const projectionObservedDays = computed(
        () => projection.value?.observedDays ?? 0
    );

    /** The projection as a kWh range, so a thin one does not read as a firm one. */
    const projectionRangeKwh = computed(() =>
        projectedCost.value === null ? null : (projection.value?.range ?? null)
    );

    async function fetchPeriodData(
        scope: DashboardScope,
        from: string,
        to: string,
        granularity: 'hour' | 'day' | 'month'
    ) {
        loading.value = true;
        const token = periodGuard.bump();
        try {
            const [currentRes, previousRes] = await Promise.all([
                ws.sendRPC<EnergyQueryResponse>(
                    'FLEET_MANAGER',
                    'energy.query',
                    {
                        ...(Object.keys(scope).length > 0 ? {scope} : {}),
                        from,
                        to,
                        tags: ['total_act_energy'],
                        // AC grid electricity — exclude DC / other commodities.
                        commodity: 'electricity',
                        electricalSource: 'ac_mains',
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
                            ...(Object.keys(scope).length > 0 ? {scope} : {}),
                            from: prevFrom,
                            to: prevTo,
                            tags: ['total_act_energy'],
                            // AC grid electricity — exclude DC / other commodities.
                            commodity: 'electricity',
                            electricalSource: 'ac_mains',
                            bucket: GRAN_TO_BUCKET[granularity]
                        }
                    );
                })()
            ]);
            if (periodGuard.isStale(token)) return;
            periodData.value = {
                current: (currentRes?.items ?? []).map(toConsumption),
                previous: (previousRes?.items ?? []).map(toConsumption),
                granularity,
                from,
                to
            };
        } catch (err: any) {
            if (periodGuard.isStale(token)) return;
            toastRpcError(toast, err, 'Failed to load energy data');
        } finally {
            loading.value = false;
        }
    }

    async function fetchProjection(request: ProjectionRequest) {
        const token = projectionGuard.bump();
        // No priced total means there is no money to project. The card says
        // what it is waiting for rather than guessing at one.
        if (request.costSoFar === null) {
            projection.value = null;
            return;
        }
        try {
            const result = await ws.sendRPC<EnergyProjectionResponse>(
                'FLEET_MANAGER',
                'energy.projection',
                {
                    ...(request.scope && Object.keys(request.scope).length > 0
                        ? {scope: request.scope}
                        : {}),
                    ...(request.devices?.length
                        ? {devices: request.devices}
                        : {}),
                    from: request.from,
                    to: request.to,
                    costSoFar: request.costSoFar
                }
            );
            if (projectionGuard.isStale(token)) return;
            projection.value = result ?? null;
        } catch (err: any) {
            if (projectionGuard.isStale(token)) return;
            projection.value = null;
            toastRpcError(toast, err, 'Failed to project the period total');
        }
    }

    /**
     * Price the current and mirror-prior windows through Energy.Query's stored
     * tariff engine. This is deliberately separate from the chart read: a
     * missing reports:read permission or an invalid tariff must not erase the
     * measured kWh, and the UI can explain why money is unavailable.
     */
    async function fetchPeriodPricing(request: DashboardPricingRequest) {
        const token = pricingGuard.bump();
        pricingError.value = null;
        periodPricing.value = null;
        previousPeriodPricing.value = null;
        const span =
            new Date(request.to).getTime() - new Date(request.from).getTime();
        if (!(span > 0) || request.devices?.length === 0) {
            periodPricing.value = null;
            previousPeriodPricing.value = null;
            return;
        }
        const selector = request.devices?.length
            ? {devices: request.devices}
            : request.scope && Object.keys(request.scope).length > 0
              ? {scope: request.scope}
              : {};
        const priorFrom = new Date(
            new Date(request.from).getTime() - span
        ).toISOString();
        const common = {
            ...selector,
            tags: ['total_act_energy'] as const,
            commodity: 'electricity' as const,
            electricalSource: 'ac_mains' as const,
            bucket: '1 day' as const,
            perDevice: false,
            pricing: {}
        };
        const priceRange = async (from: string, to: string) => {
            const pages = await Promise.all(
                splitPricingRange(from, to).map((range) =>
                    ws.sendRPC<EnergyQueryResponse>(
                        'FLEET_MANAGER',
                        'energy.query',
                        {
                            ...common,
                            ...range
                        }
                    )
                )
            );
            const summaries = pages
                .map((page) => page?.pricing)
                .filter(
                    (pricing): pricing is EnergyQueryPricingSummary =>
                        pricing != null
                );
            if (summaries.length !== pages.length) {
                throw new Error('Stored-tariff pricing was not returned.');
            }
            return mergePricingSummaries(summaries);
        };
        try {
            const [current, previous] = await Promise.all([
                priceRange(request.from, request.to),
                priceRange(priorFrom, request.from)
            ]);
            if (pricingGuard.isStale(token)) return;
            periodPricing.value = current;
            previousPeriodPricing.value = previous;
        } catch (err: any) {
            if (pricingGuard.isStale(token)) return;
            periodPricing.value = null;
            previousPeriodPricing.value = null;
            pricingError.value =
                err?.message ?? 'Stored-tariff pricing is unavailable.';
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
            toastRpcError(toast, err, 'Failed to load dashboard settings');
        }
    }

    async function fetchPeriodDataFleet(
        from: string,
        to: string,
        granularity: 'hour' | 'day' | 'month'
    ) {
        return fetchPeriodData({}, from, to, granularity);
    }

    function setLiveDevicesNoGroup(
        shellyIds: string[],
        deviceMap: Record<string, any>
    ) {
        // Phase channels fold both Pro 3EM profiles (em:0 a/b/c OR em1:0/1/2);
        // count decides 3-phase in computePhaseMetrics.
        const phaseChannelsList: EmChannel[][] = [];

        liveDevices.value = shellyIds.map((shellyId, idx) => {
            const dev = deviceMap[shellyId];
            const status = dev?.status ?? {};
            const {emChannels, em1Channels} = extractEmChannels(status);
            phaseChannelsList.push(devicePhaseChannels(status));
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
            phaseChannelsList
        );
        // Selection write: any in-flight live fetch is now stale.
        liveGuard.bump();
    }

    async function fetchLiveMetrics(scope: DashboardScope = {}) {
        const token = liveGuard.bump();
        try {
            const result = await ws.sendRPC<{
                devices: FleetMetricsDevice[];
                metrics: {power: {values: {deviceId: number; value: number}[]}};
                phaseMetrics: PhaseMetrics | null;
            }>('FLEET_MANAGER', 'fleet.GetMetrics', {
                ...(Object.keys(scope).length > 0 ? {scope} : {})
            });

            if (liveGuard.isStale(token)) return;
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
                online: d.online ?? false,
                hasEmChannels: d.hasEmChannels ?? false,
                hasEm1Channels: d.hasEm1Channels ?? false
            }));

            phaseMetrics.value = result?.phaseMetrics ?? null;
        } catch (err: any) {
            if (liveGuard.isStale(token)) return;
            toastRpcError(toast, err, 'Failed to load live metrics');
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
        settings,
        periodData,
        liveDevices,
        phaseMetrics,
        heatmapData,
        groupId,
        projection,
        periodPricing,
        previousPeriodPricing,
        pricingError,
        projectedCost,
        projectionObservedDays,
        projectionRangeKwh,
        totalConsumption,
        totalPreviousConsumption,
        consumptionDelta,
        totalCost,
        peakHourInsight,
        meterRows,
        hasThreePhaseDevices,
        fetchPeriodData,
        fetchPeriodDataFleet,
        fetchProjection,
        fetchPeriodPricing,
        fetchSettings,
        fetchLiveMetrics,
        setLiveDevicesNoGroup,
        fetchDeviceChannels
    };
});
