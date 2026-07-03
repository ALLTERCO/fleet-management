<template>
    <CardShell
        type="ui_widget"
        name="Stats Summary"
        icon="fas fa-table-cells"
        :size="size"
        :edit-mode="editMode"
        @delete="$emit('delete')"
        @resize="(s: any) => $emit('resize', s)"
        @move="(d: any) => $emit('move', d)"
        @drag-start="(e: DragEvent) => $emit('drag-start', e)"
        @drag-end="(e: DragEvent) => $emit('drag-end', e)"
        @drag-over="(e: DragEvent) => $emit('drag-over', e)"
        @drag-leave="(e: DragEvent) => $emit('drag-leave', e)"
        @drop="(e: DragEvent) => $emit('drop', e)"
    >
        <div class="ss">
            <div class="ss-header">
                <ChartRangeTabs v-model="range" accent-color="#6366f1" />
            </div>
            <div v-if="anyLoading" class="ss-empty"><Spinner /></div>
            <div v-else-if="!rows.length" class="ss-empty">No data</div>
            <div v-else class="ss-table">
                <div class="ss-row ss-row--head">
                    <span class="ss-cell ss-name" />
                    <span class="ss-cell">Min</span>
                    <span class="ss-cell">Avg</span>
                    <span class="ss-cell">Max</span>
                </div>
                <div v-for="row in rows" :key="row.name" class="ss-row">
                    <span class="ss-cell ss-name" :title="row.name">{{ row.name }}</span>
                    <span class="ss-cell ss-min">{{ fmt(row.min, row.precision) }}<span v-if="row.min != null" class="ss-unit">{{ row.unit }}</span></span>
                    <span class="ss-cell ss-avg">{{ fmt(row.avg, row.precision) }}<span v-if="row.avg != null" class="ss-unit">{{ row.unit }}</span></span>
                    <span class="ss-cell ss-max">{{ fmt(row.max, row.precision) }}<span v-if="row.max != null" class="ss-unit">{{ row.unit }}</span></span>
                </div>
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Spinner from '@/components/core/Spinner.vue';
import type {ChartMetric, ChartRange} from '@/composables/useChartData';
import {useChartData} from '@/composables/useChartData';
import {useDashboardContext} from '@/composables/useDashboardContext';
import CardShell from './CardShell.vue';
import ChartRangeTabs from './ChartRangeTabs.vue';

export interface StatsSummaryWidgetConfig {
    id: 'stats_summary_widget';
    entries: Array<{shellyId: string; metric: ChartMetric; name: string}>;
    range?: ChartRange;
}

const METRIC_PRECISION: Record<ChartMetric, number> = {
    power: 1,
    consumption: 2,
    returned_energy: 2,
    voltage: 1,
    current: 2,
    temperature: 1,
    humidity: 1,
    luminance: 0
};

const METRIC_UNIT: Record<ChartMetric, string> = {
    power: 'W',
    consumption: 'Wh',
    returned_energy: 'Wh',
    voltage: 'V',
    current: 'A',
    temperature: '°C',
    humidity: '%',
    luminance: 'lx'
};

const props = withDefaults(
    defineProps<{
        config: StatsSummaryWidgetConfig;
        size?: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {size: '2x1', editMode: false}
);

defineEmits<{
    delete: [];
    resize: [size: '1x1' | '2x1' | '2x2'];
    move: [direction: number];
    'drag-start': [e: DragEvent];
    'drag-end': [e: DragEvent];
    'drag-over': [e: DragEvent];
    'drag-leave': [e: DragEvent];
    drop: [e: DragEvent];
}>();

const range = ref<ChartRange>(props.config.range ?? '24h');

// One useChartData instance per entry
const chartDataList = (props.config.entries ?? []).map((entry) =>
    useChartData(
        computed(() => entry.shellyId),
        computed(() => entry.metric),
        range
    )
);

const anyLoading = computed(() => chartDataList.some((c) => c.loading.value));

const dashCtx = useDashboardContext();
watch(
    () => dashCtx.value.refreshSignal.value,
    () => {
        for (const cd of chartDataList) cd.refresh();
    }
);

const rows = computed(() =>
    (props.config.entries ?? []).map((entry, i) => {
        const points = chartDataList[i]?.data.value ?? [];
        const values = points
            .map((p) => p.value)
            .filter((v) => v != null) as number[];
        const precision = METRIC_PRECISION[entry.metric] ?? 1;
        const unit = METRIC_UNIT[entry.metric] ?? '';
        if (!values.length) {
            return {
                name: entry.name,
                min: null,
                avg: null,
                max: null,
                precision,
                unit
            };
        }
        // Prefer pre-aggregated per-bucket min/max (true sample extremes) over min/max of averages
        const pointMins = points
            .map((p) => p.min)
            .filter((v) => v != null) as number[];
        const pointMaxs = points
            .map((p) => p.max)
            .filter((v) => v != null) as number[];
        const min = pointMins.length
            ? Math.min(...pointMins)
            : Math.min(...values);
        const max = pointMaxs.length
            ? Math.max(...pointMaxs)
            : Math.max(...values);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        return {name: entry.name, min, avg, max, precision, unit};
    })
);

function fmt(v: number | null, precision: number): string {
    return v != null ? v.toFixed(precision) : '--';
}
</script>

<style scoped>
.ss {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    height: 100%;
    min-height: 0;
}

.ss-header {
    flex-shrink: 0;
}

.ss-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.ss-table {
    flex: 1;
    overflow: auto;
    min-height: 0;
}

.ss-row {
    display: grid;
    grid-template-columns: 1fr repeat(3, 44px);
    gap: var(--space-0-5);
    padding: var(--space-0-5) 0;
    border-bottom: 1px solid var(--color-border-subtle);
}

.ss-row--head .ss-cell {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-tertiary);
    text-transform: none;
    letter-spacing: 0.04em;
}

.ss-cell {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ss-name {
    text-align: left;
    color: var(--color-text-primary);
    font-weight: 500;
}

.ss-min {
    color: var(--color-link);
}

.ss-max {
    color: var(--color-danger-text);
}

.ss-avg {
    color: var(--color-text-primary);
}

.ss-unit {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    margin-left: var(--space-px);
}
</style>
