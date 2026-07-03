<template>
    <!-- Backdrop for fullscreen mode -->
    <div v-if="fullscreen" class="device-charts__backdrop" @click="fullscreen = false" />

    <div class="device-charts" :class="{'device-charts--fullscreen': fullscreen}">
        <!-- Live readings -->
        <div v-if="liveValues.length" class="device-charts__live">
            <div v-for="lv in liveValues" :key="lv.label" class="device-charts__live-item">
                <span class="device-charts__live-label">{{ lv.label }}</span>
                <span class="device-charts__live-value">{{ lv.value }}</span>
            </div>
        </div>

        <!-- Time range selector + fullscreen toggle -->
        <div class="device-charts__toolbar">
            <button
                v-for="range in ranges"
                :key="range.value"
                class="device-charts__range-btn"
                :class="activeRange === range.value && 'device-charts__range-btn--active'"
                @click="changeRange(range.value)"
            >
                {{ range.label }}
            </button>
            <button class="device-charts__fs-btn" aria-label="Toggle fullscreen" @click="fullscreen = !fullscreen">
                <i :class="fullscreen ? 'fas fa-compress' : 'fas fa-expand'" />
            </button>
        </div>

        <!-- Loading state -->
        <div v-if="loading" class="device-charts__empty">
            <Spinner size="sm" />
            <span class="text-[var(--color-text-disabled)] text-sm">Loading chart data…</span>
        </div>

        <!-- No data state -->
        <div v-else-if="!hasData && !liveValues.length" class="device-charts__empty">
            <i class="fas fa-chart-line text-2xl text-[var(--color-text-disabled)]"></i>
            <span class="text-[var(--color-text-disabled)] text-sm">No historical data available for this device</span>
        </div>

        <!-- No historical data but live values exist -->
        <div v-else-if="!hasData" class="device-charts__empty">
            <span class="text-[var(--color-text-disabled)] text-sm">Historical data not yet available for this device</span>
        </div>

        <!-- Charts -->
        <template v-else>
            <div class="device-charts__chart-wrap" :style="{'animation-delay': '0s'}">
                <MetricChart
                    v-if="consumptionData.length"
                    :data="consumptionData"
                    title="Consumption"
                    unit="kWh"
                    icon="fas fa-bolt text-[var(--color-success-text)]"
                    color="rgba(var(--color-success-rgb), 1)"
                    chart-type="bar"
                    :precision="3"
                />
            </div>

            <div class="device-charts__chart-wrap" :style="{'animation-delay': '0.05s'}">
                <MetricChart
                    v-if="returnedEnergyData.length"
                    :data="returnedEnergyData"
                    title="Returned Energy"
                    unit="kWh"
                    icon="fas fa-solar-panel text-[var(--color-orange-text)]"
                    color="rgba(249, 115, 22, 1)"
                    chart-type="bar"
                    :precision="3"
                />
            </div>

            <div class="device-charts__chart-wrap" :style="{'animation-delay': '0.1s'}">
                <MetricChart
                    v-if="powerData.length"
                    :data="powerData"
                    title="Power"
                    unit="W"
                    icon="fas fa-bolt text-[var(--color-danger-text)]"
                    color="rgba(248, 113, 113, 1)"
                    chart-type="line"
                    :precision="1"
                />
            </div>

            <div class="device-charts__chart-wrap" :style="{'animation-delay': '0.15s'}">
                <MetricChart
                    v-if="voltageData.length"
                    :data="voltageData"
                    title="Voltage"
                    unit="V"
                    icon="fas fa-plug text-[var(--color-warning-text)]"
                    color="rgba(250, 204, 21, 1)"
                    chart-type="line"
                    :precision="1"
                />
            </div>

            <div class="device-charts__chart-wrap" :style="{'animation-delay': '0.2s'}">
                <MetricChart
                    v-if="currentData.length"
                    :data="currentData"
                    title="Current"
                    unit="A"
                    icon="fas fa-water text-[var(--color-primary-text)]"
                    color="rgba(var(--color-primary-rgb), 1)"
                    chart-type="line"
                    :precision="3"
                />
            </div>

            <div class="device-charts__chart-wrap" :style="{'animation-delay': '0.25s'}">
                <MetricChart
                    v-if="temperatureData.length"
                    :data="temperatureData"
                    title="Temperature"
                    unit="°C"
                    icon="fas fa-thermometer-half text-[var(--color-danger-text)]"
                    color="rgba(248, 113, 113, 1)"
                    chart-type="line"
                    :precision="1"
                />
            </div>

            <div class="device-charts__chart-wrap" :style="{'animation-delay': '0.3s'}">
                <MetricChart
                    v-if="humidityData.length"
                    :data="humidityData"
                    title="Humidity"
                    unit="%"
                    icon="fas fa-droplet text-[var(--color-primary-text)]"
                    color="rgba(var(--color-primary-rgb), 1)"
                    chart-type="line"
                    :precision="1"
                />
            </div>

            <div class="device-charts__chart-wrap" :style="{'animation-delay': '0.35s'}">
                <MetricChart
                    v-if="luminanceData.length"
                    :data="luminanceData"
                    title="Luminance"
                    unit="lux"
                    icon="fas fa-sun text-[var(--color-warning-text)]"
                    color="rgba(250, 204, 21, 1)"
                    chart-type="line"
                    :precision="0"
                />
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import MetricChart from '@/components/analytics/charts/MetricChart.vue';
import Spinner from '@/components/core/Spinner.vue';
import {useDevicesStore} from '@/stores/devices';
import * as ws from '@/tools/websocket';

const props = defineProps<{
    shellyId: string;
}>();

interface DataPoint {
    bucket: string;
    value: number;
    min?: number | null;
    max?: number | null;
}

const ranges = [
    {label: '24h', value: '24h'},
    {label: '7d', value: '7d'},
    {label: '30d', value: '30d'}
];

const deviceStore = useDevicesStore();
const device = computed(() => deviceStore.devices[props.shellyId]);

const activeRange = ref('24h');
const loading = ref(false);
const fullscreen = ref(false);
const consumptionData = ref<DataPoint[]>([]);
const returnedEnergyData = ref<DataPoint[]>([]);
const powerData = ref<DataPoint[]>([]);
const voltageData = ref<DataPoint[]>([]);
const currentData = ref<DataPoint[]>([]);
const temperatureData = ref<DataPoint[]>([]);
const humidityData = ref<DataPoint[]>([]);
const luminanceData = ref<DataPoint[]>([]);

// Cache per device + range (5-minute TTL)
const cache = new Map<
    string,
    {ts: number; data: Record<string, DataPoint[]>}
>();
const CACHE_TTL = 5 * 60 * 1000;

const hasData = computed(
    () =>
        consumptionData.value.length > 0 ||
        returnedEnergyData.value.length > 0 ||
        powerData.value.length > 0 ||
        voltageData.value.length > 0 ||
        currentData.value.length > 0 ||
        temperatureData.value.length > 0 ||
        humidityData.value.length > 0 ||
        luminanceData.value.length > 0
);

/** Live readings extracted from device status */
const liveValues = computed(() => {
    const status = device.value?.status ?? {};
    const values: {label: string; value: string}[] = [];

    for (let i = 0; i < 5; i++) {
        const sw = status[`switch:${i}`];
        if (sw?.apower != null)
            values.push({
                label: `Switch ${i} power`,
                value: `${Number(sw.apower).toFixed(1)} W`
            });
    }
    for (let i = 0; i < 5; i++) {
        const em = status[`em:${i}`];
        if (em?.act_power != null)
            values.push({
                label: `L${i + 1} power`,
                value: `${Number(em.act_power).toFixed(1)} W`
            });
        if (em?.voltage != null)
            values.push({
                label: `L${i + 1} voltage`,
                value: `${Number(em.voltage).toFixed(1)} V`
            });
        if (em?.current != null)
            values.push({
                label: `L${i + 1} current`,
                value: `${Number(em.current).toFixed(2)} A`
            });
    }
    for (let i = 0; i < 5; i++) {
        const em1 = status[`em1:${i}`];
        if (em1?.act_power != null)
            values.push({
                label: `CH${i} power`,
                value: `${Number(em1.act_power).toFixed(1)} W`
            });
    }
    for (let i = 0; i < 5; i++) {
        const pm = status[`pm1:${i}`];
        if (pm?.apower != null)
            values.push({
                label: `PM${i} power`,
                value: `${Number(pm.apower).toFixed(1)} W`
            });
    }
    for (const key of Object.keys(status)) {
        if (key.startsWith('temperature:') && status[key]?.tC != null) {
            values.push({
                label: 'Temperature',
                value: `${Number(status[key].tC).toFixed(1)} \u00B0C`
            });
        }
        if (key.startsWith('humidity:') && status[key]?.rh != null) {
            values.push({
                label: 'Humidity',
                value: `${Number(status[key].rh).toFixed(1)} %`
            });
        }
        if (key.startsWith('illuminance:') && status[key]?.lux != null) {
            values.push({
                label: 'Luminance',
                value: `${Number(status[key].lux).toFixed(0)} lux`
            });
        }
    }
    return values;
});

function getTimeRange(range: string): {
    from: string;
    to: string;
    granularity: 'hour' | 'day' | 'month';
} {
    const to = new Date();
    const from = new Date();
    let granularity: 'hour' | 'day' | 'month' = 'hour';

    switch (range) {
        case '24h':
            from.setHours(from.getHours() - 24);
            granularity = 'hour';
            break;
        case '7d':
            from.setDate(from.getDate() - 7);
            granularity = 'hour';
            break;
        case '30d':
            from.setDate(from.getDate() - 30);
            granularity = 'day';
            break;
    }

    return {from: from.toISOString(), to: to.toISOString(), granularity};
}

const METRIC_TO_TAG: Record<string, string> = {
    consumption: 'total_act_energy',
    returned_energy: 'total_act_ret_energy',
    voltage: 'voltage',
    current: 'current',
    power: 'power',
    temperature: 'temperature',
    humidity: 'humidity',
    luminance: 'luminance'
};

const GRAN_TO_BUCKET: Record<string, string> = {
    hour: '1 hour',
    day: '1 day',
    month: '1 month'
};

async function fetchMetric(
    shellyId: string,
    metric: string,
    from: string,
    to: string,
    granularity: string
): Promise<DataPoint[]> {
    try {
        const result = await ws.sendRPC<{
            items: Array<{
                bucket: string;
                value: number;
                min?: number | null;
                max?: number | null;
            }>;
        }>('FLEET_MANAGER', 'energy.query', {
            devices: [shellyId],
            from,
            to,
            tags: [METRIC_TO_TAG[metric]],
            bucket: GRAN_TO_BUCKET[granularity] ?? '1 hour',
            perDevice: false
        });
        return (result?.items ?? []).map((r) => ({
            bucket: r.bucket,
            value: r.value,
            min: r.min ?? null,
            max: r.max ?? null
        }));
    } catch {
        return [];
    }
}

// Seq-token: rapid range/shellyId changes can fire overlapping loads.
// Only the latest call's result is applied.
let loadSeq = 0;
async function loadData() {
    const seq = ++loadSeq;
    const {from, to, granularity} = getTimeRange(activeRange.value);
    const cacheKey = `${props.shellyId}_${activeRange.value}`;

    // Detect available env sensors from device status
    const status = device.value?.status ?? {};
    const statusKeys = Object.keys(status);
    const hasTemp = statusKeys.some((k) => k.startsWith('temperature:'));
    const hasHumidity = statusKeys.some((k) => k.startsWith('humidity:'));
    const hasLuminance = statusKeys.some((k) => k.startsWith('illuminance:'));

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        consumptionData.value = cached.data.consumption ?? [];
        returnedEnergyData.value = cached.data.returned_energy ?? [];
        powerData.value = cached.data.power ?? [];
        voltageData.value = cached.data.voltage ?? [];
        currentData.value = cached.data.current ?? [];
        temperatureData.value = cached.data.temperature ?? [];
        humidityData.value = cached.data.humidity ?? [];
        luminanceData.value = cached.data.luminance ?? [];
        return;
    }

    loading.value = true;

    // Build fetch list — always fetch the core 5, conditionally fetch env sensors
    const promises = [
        fetchMetric(props.shellyId, 'consumption', from, to, granularity),
        fetchMetric(props.shellyId, 'returned_energy', from, to, granularity),
        fetchMetric(props.shellyId, 'power', from, to, granularity),
        fetchMetric(props.shellyId, 'voltage', from, to, granularity),
        fetchMetric(props.shellyId, 'current', from, to, granularity)
    ];

    // Track which env metrics we're fetching and their indices
    const envMetrics: {key: string; index: number}[] = [];
    if (hasTemp) {
        envMetrics.push({key: 'temperature', index: promises.length});
        promises.push(
            fetchMetric(props.shellyId, 'temperature', from, to, granularity)
        );
    }
    if (hasHumidity) {
        envMetrics.push({key: 'humidity', index: promises.length});
        promises.push(
            fetchMetric(props.shellyId, 'humidity', from, to, granularity)
        );
    }
    if (hasLuminance) {
        envMetrics.push({key: 'luminance', index: promises.length});
        promises.push(
            fetchMetric(props.shellyId, 'luminance', from, to, granularity)
        );
    }

    const results = await Promise.all(promises);
    // Race-guard: discard stale result if a newer load started.
    if (seq !== loadSeq) return;

    // Assign core metrics
    const consumption = results[0];
    const returnedEnergy = results[1];
    const power = results[2];
    const voltage = results[3];
    const current = results[4];

    consumptionData.value = consumption;
    returnedEnergyData.value = returnedEnergy;
    powerData.value = power;
    voltageData.value = voltage;
    currentData.value = current;

    // Assign env metrics
    const cacheData: Record<string, DataPoint[]> = {
        consumption,
        returned_energy: returnedEnergy,
        power,
        voltage,
        current
    };

    temperatureData.value = [];
    humidityData.value = [];
    luminanceData.value = [];

    for (const em of envMetrics) {
        const data = results[em.index];
        cacheData[em.key] = data;
        if (em.key === 'temperature') temperatureData.value = data;
        if (em.key === 'humidity') humidityData.value = data;
        if (em.key === 'luminance') luminanceData.value = data;
    }

    // Cache results
    cache.set(cacheKey, {ts: Date.now(), data: cacheData});

    loading.value = false;
}

function changeRange(range: string) {
    activeRange.value = range;
    loadData();
}

// Fullscreen escape handler
function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && fullscreen.value) fullscreen.value = false;
}

// Load on mount and when shellyId changes
onMounted(() => {
    loadData();
    document.addEventListener('keydown', onKeydown);
});
onUnmounted(() => document.removeEventListener('keydown', onKeydown));
watch(() => props.shellyId, loadData);
</script>

<style scoped>
/* ------------------------------------------------------------------ */
/*  Animations                                                        */
/* ------------------------------------------------------------------ */

@keyframes chartFadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
}

/* ------------------------------------------------------------------ */
/*  Backdrop (fullscreen mode)                                        */
/* ------------------------------------------------------------------ */

.device-charts__backdrop {
    position: fixed;
    inset: 0;
    z-index: 9998;
    background: var(--color-overlay-heavy);
    backdrop-filter: blur(var(--scrim-blur));
}

/* ------------------------------------------------------------------ */
/*  Container                                                         */
/* ------------------------------------------------------------------ */

.device-charts {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.device-charts--fullscreen {
    position: fixed;
    inset: 16px;
    z-index: 9999;
    overflow-y: auto;
    background: var(--color-surface-bg);
    border: 1px solid var(--color-border-default);
    border-radius: 12px;
    padding: var(--space-4);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
}

/* ------------------------------------------------------------------ */
/*  Live readings                                                     */
/* ------------------------------------------------------------------ */

.device-charts__live {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-2) 0 var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
    margin-bottom: var(--space-2);
}

.device-charts__live-item {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
}

.device-charts__live-label {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

.device-charts__live-value {
    font-size: var(--type-body);
    font-weight: 500;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
}

/* ------------------------------------------------------------------ */
/*  Toolbar                                                           */
/* ------------------------------------------------------------------ */

.device-charts__toolbar {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2);
    background-color: var(--color-surface-2);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-default);
}

.device-charts__range-btn {
    flex: 1;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default),
                border-color var(--duration-fast) var(--ease-default);
}

.device-charts__range-btn:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}

.device-charts__range-btn--active {
    background-color: var(--color-primary);
    color: var(--color-text-primary);
    border-color: var(--color-primary);
}

.device-charts__fs-btn {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: var(--space-1);
    font-size: var(--type-body);
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color var(--duration-fast) var(--ease-default),
                background-color var(--duration-fast) var(--ease-default);
}

.device-charts__fs-btn:hover {
    color: var(--color-text-primary);
    background-color: var(--color-surface-3);
}

/* ------------------------------------------------------------------ */
/*  Empty / loading states                                            */
/* ------------------------------------------------------------------ */

.device-charts__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-8) 0;
}

/* ------------------------------------------------------------------ */
/*  Chart wrappers with stagger animation                             */
/* ------------------------------------------------------------------ */

.device-charts__chart-wrap {
    animation: chartFadeIn 0.3s ease both;
}
</style>
