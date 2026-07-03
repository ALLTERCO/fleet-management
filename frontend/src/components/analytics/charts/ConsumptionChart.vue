<template>
    <ChartCard
        :loading="loading"
        :empty="!data.length"
        empty-text="No consumption data available"
    >
        <div ref="chartEl" class="consumption-chart"></div>

        <template v-if="showTotal" #stats>
            <span>Total: <strong>{{ totalConsumption.toFixed(3) }} kWh</strong></span>
            <span v-if="tariff > 0">
                Cost: <strong class="text-[var(--color-success-text)]">{{ totalCost.toFixed(2) }} {{ currency }}</strong>
            </span>
        </template>
    </ChartCard>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import ChartCard from '@/components/charts/ChartCard.vue';
import {useEChart} from '@/composables/useEChart';

interface ConsumptionDataPoint {
    bucket: string;
    deviceId?: number;
    deviceName?: string;
    value: number;
    cost?: number;
}

const props = withDefaults(
    defineProps<{
        data: ConsumptionDataPoint[];
        tariff?: number;
        currency?: string;
        loading?: boolean;
        showTotal?: boolean;
        view?: 'kwh' | 'cost';
    }>(),
    {
        tariff: 0,
        currency: 'EUR',
        loading: false,
        showTotal: true,
        view: 'kwh'
    }
);

const chartEl = ref<HTMLElement | null>(null);

const totalConsumption = computed(() =>
    props.data.reduce((sum, d) => sum + (d.value || 0), 0)
);
const totalCost = computed(() => totalConsumption.value * props.tariff);

function formatBucket(bucket: string): string {
    try {
        return new Date(bucket).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return bucket;
    }
}

function groupByBucket(): Map<string, number> {
    const grouped = new Map<string, number>();
    for (const d of props.data) {
        const label = formatBucket(d.bucket);
        grouped.set(label, (grouped.get(label) ?? 0) + d.value);
    }
    return grouped;
}

const isKwh = computed(() => props.view !== 'cost');

const barColor = computed(() =>
    isKwh.value ? 'rgba(var(--color-success-rgb), 0.85)' : 'rgba(168, 85, 247, 0.85)'
);

const option = computed(() => {
    const grouped = groupByBucket();
    const labels = Array.from(grouped.keys());
    const rawValues = Array.from(grouped.values());
    const displayValues = isKwh.value
        ? rawValues
        : rawValues.map((v) => v * props.tariff);

    const seriesLabel = isKwh.value
        ? 'Consumption (kWh)'
        : `Cost (${props.currency})`;

    const unitSuffix = isKwh.value ? ' kWh' : ` ${props.currency}`;
    const precision = isKwh.value ? 3 : 2;

    return {
        tooltip: {
            trigger: 'axis',
            formatter(params: any[]) {
                const p = params[0];
                if (!p) return '';
                const val = (p.value as number) ?? 0;
                return `${p.axisValue}<br/>${p.marker}${val.toFixed(precision)}${unitSuffix}`;
            }
        },
        legend: {show: false},
        grid: {left: 40, right: 12, top: 8, bottom: 24},
        xAxis: {
            type: 'category',
            data: labels,
            axisLabel: {fontSize: 10}
        },
        yAxis: {
            type: 'value',
            min: 0,
            axisLabel: {fontSize: 10}
        },
        series: [
            {
                name: seriesLabel,
                type: 'bar',
                data: displayValues,
                itemStyle: {color: barColor.value}
            }
        ]
    };
});

useEChart(chartEl, option);
</script>

<style scoped>
.consumption-chart {
    width: 100%;
    height: 100%;
    min-height: 160px;
}
</style>
