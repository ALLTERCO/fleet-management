<template>
    <div class="dash-status-donut">
        <template v-if="loading">
            <div class="dsd-skeleton" aria-hidden="true" />
            <div class="dsd-center">
                <span class="dsd-skel-value" />
                <span class="dsd-skel-label" />
            </div>
        </template>
        <template v-else>
            <div ref="chartEl" class="dsd-chart" />
            <div class="dsd-center">
                <span class="dsd-center-value">{{ total }}</span>
                <span class="dsd-center-label">devices</span>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {chartColors, hexToRgba} from '@/helpers/chartUtils';
import echarts from '@/tools/echarts';

const props = withDefaults(
    defineProps<{
        online: number;
        offline: number;
        sleeping?: number;
        loading?: boolean;
    }>(),
    {loading: false}
);

const chartEl = ref<HTMLElement | null>(null);
let chart: ReturnType<typeof echarts.init> | null = null;
let ro: ResizeObserver | null = null;

const total = computed(
    () => props.online + props.offline + (props.sleeping ?? 0)
);

const option = computed(() => {
    const data = [
        {value: props.online, name: 'Online', itemStyle: {color: chartColors.statusOn}},
        {value: props.offline, name: 'Offline', itemStyle: {color: chartColors.statusOff}}
    ];
    if (props.sleeping && props.sleeping > 0) {
        data.push({
            value: props.sleeping,
            name: 'Sleeping',
            itemStyle: {color: chartColors.statusWarn}
        });
    }

    return {
        tooltip: {
            trigger: 'item',
            textStyle: {fontSize: 13, fontWeight: 500},
            formatter: (p: any) =>
                `${p.name}: ${p.value} (${p.percent}%)`
        },
        legend: {show: false},
        series: [
            {
                type: 'pie',
                radius: ['62%', '85%'],
                center: ['50%', '50%'],
                avoidLabelOverlap: false,
                label: {show: false},
                emphasis: {
                    scale: true,
                    scaleSize: 4
                },
                data,
                itemStyle: {
                    borderColor: 'transparent',
                    borderWidth: 3
                },
                animationType: 'expansion',
                animationDuration: 1000,
                animationEasing: 'cubicOut'
            }
        ]
    };
});

function initChart() {
    if (!chartEl.value || chart) return;
    chart = echarts.init(chartEl.value, 'fleet', {renderer: 'canvas'});
    chart.setOption(option.value);
    ro = new ResizeObserver(() => {
        if (chart && chartEl.value && chartEl.value.offsetWidth > 0)
            chart.resize();
    });
    ro.observe(chartEl.value);
}

onMounted(initChart);
watch(chartEl, (el) => {
    if (el && !chart) initChart();
});
watch(option, (o) => {
    chart?.setOption(o, {notMerge: true});
});
onUnmounted(() => {
    ro?.disconnect();
    chart?.dispose();
    chart = null;
});
</script>

<style scoped>
.dash-status-donut {
    position: relative;
    min-width: 0;
    overflow: hidden;
}
.dsd-chart {
    width: 100%;
    height: 140px;
}
.dsd-center {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    pointer-events: none;
}
.dsd-center-value {
    display: block;
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
    line-height: 1;
}
.dsd-center-label {
    display: block;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    margin-top: var(--space-0-5);
}
.dsd-skeleton {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: conic-gradient(
        var(--color-surface-3) 0deg 270deg,
        var(--color-surface-2) 270deg 360deg
    );
    -webkit-mask: radial-gradient(circle, transparent 38%, black 39%);
    mask: radial-gradient(circle, transparent 38%, black 39%);
    animation: dsd-rotate 2.4s linear infinite;
}
.dsd-skel-value {
    display: block;
    width: var(--space-6);
    height: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    margin: 0 auto;
}
.dsd-skel-label {
    display: block;
    width: var(--space-5);
    height: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    margin: var(--space-0-5) auto 0;
}
@keyframes dsd-rotate {
    to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
    .dsd-skeleton { animation: none; }
}
</style>
