<template>
    <!-- Backdrop for fullscreen mode -->
    <div v-if="fullscreen" class="ddd-backdrop" @click="fullscreen = false" />

    <div
        class="ddd"
        :class="{'ddd--fullscreen': fullscreen}"
        :role="fullscreen ? 'dialog' : undefined"
        :aria-modal="fullscreen ? 'true' : undefined"
        aria-labelledby="ddd-title"
    >
        <div class="ddd-header">
            <div class="ddd-device-info">
                <span id="ddd-title" class="ddd-device-name">{{ deviceName }}</span>
                <span class="ddd-device-id">{{ props.shellyId }}</span>
            </div>
            <div class="ddd-ranges">
                <button
                    v-for="r in ranges"
                    :key="r.value"
                    class="ddd-range"
                    :class="{'ddd-range--active': activeRange === r.value}"
                    @click="changeRange(r.value)"
                >{{ r.label }}</button>
            </div>
            <button class="ddd-fullscreen" aria-label="Toggle fullscreen" @click="fullscreen = !fullscreen">
                <i :class="fullscreen ? 'fas fa-compress' : 'fas fa-expand'" />
            </button>
            <button class="ddd-close" aria-label="Close" @click="$emit('close')">&#x2715;</button>
        </div>

        <!-- Live readings — always visible when device has status -->
        <div v-if="liveValues.length" class="ddd-live">
            <div v-for="lv in liveValues" :key="lv.label" class="ddd-live-item">
                <span class="ddd-live-label">{{ lv.label }}</span>
                <span class="ddd-live-value">{{ lv.value }}</span>
            </div>
        </div>

        <!-- Loading -->
        <div v-if="globalLoading" class="ddd-state">
            <Spinner size="xs" />
            <span>Loading chart data...</span>
        </div>

        <!-- No historical data but live values exist -->
        <div v-else-if="!visibleSections.length && liveValues.length" class="ddd-state">
            Historical data not yet available for this device
        </div>

        <!-- No data at all -->
        <div v-else-if="!visibleSections.length" class="ddd-state">
            No data available
        </div>

        <!-- Charts -->
        <template v-else>
            <div v-for="section in visibleSections" :key="section.key" class="ddd-section">
                <span class="ddd-label">{{ section.label }}</span>
                <div v-if="section.loading" class="ddd-chart-skeleton" :style="{height: sectionHeight(section) + 'px'}" />
                <DashTimeChart
                    v-else
                    :data="section.data"
                    :type="section.chartType"
                    :color="section.color"
                    :height="sectionHeight(section)"
                    :unit="section.unit"
                    :mark-area="section.markArea"
                    :zoom="true"
                    :loading="false"
                />
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import Spinner from '@/components/core/Spinner.vue';
import {getDeviceName} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';
import * as ws from '@/tools/websocket';
import type {TimePoint} from '@/types/dashboard-components';
import DashTimeChart from './DashTimeChart.vue';

/* ------------------------------------------------------------------ */
/*  Props / Emits                                                     */
/* ------------------------------------------------------------------ */

const props = defineProps<{
    shellyId: string;
    metric?: string;
    range: {from: string; to: string};
}>();

defineEmits<{close: []}>();

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface DataPoint {
    bucket: string;
    value: number;
    min?: number | null;
    max?: number | null;
}

interface MetricDef {
    key: string;
    label: string;
    unit: string;
    chartType: 'bar' | 'line' | 'area';
    color: string;
    height: number;
    markArea?: {min: number; max: number};
    order: number;
}

interface ChartSection {
    key: string;
    label: string;
    unit: string;
    chartType: 'bar' | 'line' | 'area';
    color: string;
    height: number;
    markArea?: {min: number; max: number};
    data: TimePoint[];
    loading: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const METRIC_DEFS: Record<string, MetricDef> = {
    consumption: {
        key: 'consumption',
        label: 'CONSUMPTION',
        unit: 'kWh',
        chartType: 'bar',
        color: 'rgba(var(--color-success-rgb),1)',
        height: 100,
        order: 1
    },
    power: {
        key: 'power',
        label: 'POWER',
        unit: 'W',
        chartType: 'line',
        color: 'rgba(var(--color-primary-rgb),1)',
        height: 100,
        order: 2
    },
    voltage: {
        key: 'voltage',
        label: 'VOLTAGE',
        unit: 'V',
        chartType: 'line',
        color: 'rgba(var(--color-info-rgb),1)',
        height: 100,
        markArea: {min: 210, max: 250},
        order: 3
    },
    current: {
        key: 'current',
        label: 'CURRENT',
        unit: 'A',
        chartType: 'line',
        color: 'rgba(var(--color-primary-rgb),1)',
        height: 100,
        order: 4
    },
    temperature: {
        key: 'temperature',
        label: 'TEMPERATURE',
        unit: '\u00B0C',
        chartType: 'line',
        color: 'rgba(var(--color-danger-rgb),1)',
        height: 100,
        order: 5
    },
    humidity: {
        key: 'humidity',
        label: 'HUMIDITY',
        unit: '%',
        chartType: 'line',
        color: 'rgba(var(--color-primary-rgb),1)',
        height: 80,
        order: 6
    },
    returned_energy: {
        key: 'returned_energy',
        label: 'RETURNED ENERGY',
        unit: 'kWh',
        chartType: 'bar',
        color: 'rgba(var(--color-warning-rgb),1)',
        height: 80,
        order: 7
    },
    luminance: {
        key: 'luminance',
        label: 'LUMINANCE',
        unit: 'lux',
        chartType: 'line',
        color: 'rgba(var(--color-warning-rgb),1)',
        height: 80,
        order: 8
    }
};

const ranges = [
    {label: '24h', value: '24h'},
    {label: '7d', value: '7d'},
    {label: '30d', value: '30d'}
];

const CACHE_TTL = 5 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  State                                                             */
/* ------------------------------------------------------------------ */

const deviceStore = useDevicesStore();
const activeRange = ref('7d');
const globalLoading = ref(true);
const sections = ref<ChartSection[]>([]);
const fullscreen = ref(false);

// Cache: "shellyId_range" -> {ts, metrics: {metricKey: DataPoint[]}}
const cache = new Map<
    string,
    {ts: number; metrics: Record<string, DataPoint[]>}
>();

/* ------------------------------------------------------------------ */
/*  Computed                                                          */
/* ------------------------------------------------------------------ */

const device = computed(() => deviceStore.devices[props.shellyId]);
const deviceName = computed(() =>
    getDeviceName(device.value?.info, props.shellyId)
);

const visibleSections = computed(() =>
    sections.value.filter((s) => s.data.length > 0)
);

/** Live readings extracted from the device store — always available even without historical data */
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
    }
    return values;
});

/** Returns chart height scaled for fullscreen mode */
function sectionHeight(section: ChartSection): number {
    if (!fullscreen.value) return section.height;
    return section.height <= 80 ? 150 : 200;
}

/* ------------------------------------------------------------------ */
/*  Metric detection                                                  */
/* ------------------------------------------------------------------ */

function detectMetrics(): string[] {
    if (props.metric) return [props.metric];

    const status = device.value?.status;
    if (!status) return [];

    const found = new Set<string>();
    const keys = Object.keys(status);

    for (const key of keys) {
        if (key.startsWith('switch:')) {
            found.add('consumption');
            found.add('power');
            found.add('voltage');
            found.add('current');
        } else if (key.startsWith('em:')) {
            found.add('consumption');
            found.add('returned_energy');
            found.add('power');
            found.add('voltage');
            found.add('current');
        } else if (key.startsWith('em1:')) {
            found.add('consumption');
            found.add('power');
            found.add('voltage');
            found.add('current');
        } else if (key.startsWith('pm1:')) {
            found.add('consumption');
            found.add('power');
            found.add('voltage');
            found.add('current');
        } else if (key.startsWith('temperature:')) {
            found.add('temperature');
        } else if (key.startsWith('humidity:')) {
            found.add('humidity');
        } else if (key.startsWith('illuminance:')) {
            found.add('luminance');
        }
    }

    return [...found].sort(
        (a, b) => (METRIC_DEFS[a]?.order ?? 99) - (METRIC_DEFS[b]?.order ?? 99)
    );
}

/* ------------------------------------------------------------------ */
/*  Time range helpers                                                */
/* ------------------------------------------------------------------ */

function getTimeRange(range: string): {
    from: string;
    to: string;
    granularity: 'hour' | 'day';
} {
    const to = new Date();
    const from = new Date();

    if (range === '30d') {
        from.setDate(from.getDate() - 30);
        return {
            from: from.toISOString(),
            to: to.toISOString(),
            granularity: 'day'
        };
    }
    if (range === '7d') {
        from.setDate(from.getDate() - 7);
        return {
            from: from.toISOString(),
            to: to.toISOString(),
            granularity: 'hour'
        };
    }
    // 24h
    from.setHours(from.getHours() - 24);
    return {
        from: from.toISOString(),
        to: to.toISOString(),
        granularity: 'hour'
    };
}

/* ------------------------------------------------------------------ */
/*  Data fetching                                                     */
/* ------------------------------------------------------------------ */

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
            devices: [props.shellyId],
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

/* ------------------------------------------------------------------ */
/*  Load data                                                         */
/* ------------------------------------------------------------------ */

async function loadData() {
    const metrics = detectMetrics();
    if (!metrics.length) {
        globalLoading.value = false;
        sections.value = [];
        return;
    }

    const {from, to, granularity} = getTimeRange(activeRange.value);
    const cacheKey = `${props.shellyId}_${activeRange.value}`;

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        buildSections(metrics, cached.metrics);
        globalLoading.value = false;
        return;
    }

    globalLoading.value = true;

    // Fetch combined metric for each — no per-phase historical data exists in the backend
    const results = await Promise.all(
        metrics.map((metric) => fetchMetric(metric, from, to, granularity))
    );

    const metricsData: Record<string, DataPoint[]> = {};
    for (let i = 0; i < metrics.length; i++) {
        metricsData[metrics[i]] = results[i];
    }

    // Cache
    cache.set(cacheKey, {ts: Date.now(), metrics: metricsData});

    buildSections(metrics, metricsData);
    globalLoading.value = false;
}

/* ------------------------------------------------------------------ */
/*  Build chart sections from fetched data                            */
/* ------------------------------------------------------------------ */

function toTimePoints(data: DataPoint[]): TimePoint[] {
    return data.map((d) => ({bucket: d.bucket, value: d.value}));
}

function buildSections(
    metrics: string[],
    metricsData: Record<string, DataPoint[]>
) {
    const result: ChartSection[] = [];

    for (const metric of metrics) {
        const def = METRIC_DEFS[metric];
        if (!def) continue;

        const data = metricsData[metric] ?? [];
        if (data.length === 0) continue;

        result.push({
            key: metric,
            label: def.label,
            unit: def.unit,
            chartType: def.chartType,
            color: def.color,
            height: def.height,
            markArea: def.markArea,
            data: toTimePoints(data),
            loading: false
        });
    }

    sections.value = result;
}

/* ------------------------------------------------------------------ */
/*  Range change                                                      */
/* ------------------------------------------------------------------ */

function changeRange(range: string) {
    activeRange.value = range;
    loadData();
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                         */
/* ------------------------------------------------------------------ */

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && fullscreen.value) {
        fullscreen.value = false;
    }
}

onMounted(() => {
    loadData();
    document.addEventListener('keydown', onKeydown);
});

watch(() => props.shellyId, loadData);

onUnmounted(() => {
    document.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
/* ------------------------------------------------------------------ */
/*  Animations                                                        */
/* ------------------------------------------------------------------ */

@keyframes fadeSlideUp {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes ddd-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

/* ------------------------------------------------------------------ */
/*  Backdrop (fullscreen mode)                                        */
/* ------------------------------------------------------------------ */

.ddd-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9998;
    background: var(--color-overlay-heavy);
    backdrop-filter: blur(var(--scrim-blur));
}

/* ------------------------------------------------------------------ */
/*  Container                                                         */
/* ------------------------------------------------------------------ */

.ddd {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-xl);
    margin: var(--space-1) 0 var(--space-2);
    padding: var(--space-3) 14px;
    animation: fadeSlideUp 0.25s ease both;
}

.ddd--fullscreen {
    position: fixed;
    inset: 16px;
    z-index: 9999;
    overflow-y: auto;
    background: var(--color-surface-bg);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-xl);
    padding: var(--space-5);
    margin: 0;
    box-shadow: var(--shadow-xl);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ------------------------------------------------------------------ */
/*  Header                                                            */
/* ------------------------------------------------------------------ */

.ddd-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
}

.ddd-device-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-px);
}

.ddd-device-name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ddd-device-id {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-mono, monospace);
}

/* ------------------------------------------------------------------ */
/*  Range buttons                                                     */
/* ------------------------------------------------------------------ */

.ddd-ranges {
    display: flex;
    gap: var(--space-0-5);
    background: var(--color-surface-1);
    border-radius: var(--radius-sm);
    padding: var(--space-0-5);
}

.ddd-range {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--color-text-tertiary);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}

.ddd-range:hover {
    color: var(--color-text-secondary);
    background: var(--state-hover-bg);
}

.ddd-range--active {
    background: var(--color-primary);
    color: white;
}

/* ------------------------------------------------------------------ */
/*  Header action buttons                                             */
/* ------------------------------------------------------------------ */

.ddd-fullscreen {
    color: var(--color-text-disabled);
    cursor: pointer;
    background: none;
    border: none;
    padding: var(--space-1) var(--space-1-5);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color var(--duration-fast) var(--ease-default),
                background var(--duration-fast) var(--ease-default);
}

.ddd-fullscreen:hover {
    color: var(--color-text-tertiary);
    background: var(--state-hover-bg);
}

.ddd-fullscreen i {
    font-size: var(--type-body);
}

.ddd-close {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    cursor: pointer;
    background: none;
    border: none;
    padding: var(--space-1) var(--space-1-5);
    border-radius: var(--radius-sm);
    transition: color var(--duration-fast) var(--ease-default),
                background var(--duration-fast) var(--ease-default);
}

.ddd-close:hover {
    color: var(--color-text-tertiary);
    background: var(--state-hover-bg);
}

/* ------------------------------------------------------------------ */
/*  Live readings                                                     */
/* ------------------------------------------------------------------ */

.ddd-live {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-2) 0 var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
    margin-bottom: var(--space-3);
}

.ddd-live-item {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
}

.ddd-live-label {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

.ddd-live-value {
    font-size: var(--type-body);
    font-weight: 500;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
}

/* ------------------------------------------------------------------ */
/*  Loading / empty state                                             */
/* ------------------------------------------------------------------ */

.ddd-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    padding: var(--space-6) 0;
}

/* ------------------------------------------------------------------ */
/*  Chart sections with stagger animation                             */
/* ------------------------------------------------------------------ */

.ddd-section {
    margin-bottom: var(--space-2);
    animation: fadeSlideUp 0.3s ease both;
}

.ddd-section:last-child {
    margin-bottom: 0;
}

.ddd-section:nth-child(1) { animation-delay: 0s; }
.ddd-section:nth-child(2) { animation-delay: 0.05s; }
.ddd-section:nth-child(3) { animation-delay: 0.1s; }
.ddd-section:nth-child(4) { animation-delay: 0.15s; }
.ddd-section:nth-child(5) { animation-delay: 0.2s; }
.ddd-section:nth-child(6) { animation-delay: 0.25s; }
.ddd-section:nth-child(7) { animation-delay: 0.3s; }
.ddd-section:nth-child(8) { animation-delay: 0.35s; }

.ddd-label {
    display: block;
    font-size: var(--type-body);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-disabled);
    margin-bottom: var(--space-1);
}

.ddd-chart-skeleton {
    background: var(--color-surface-3);
    border-radius: var(--radius-md);
    animation: ddd-pulse 1.5s ease infinite;
}
</style>
