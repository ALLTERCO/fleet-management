<template>
    <div class="w-full" :style="{height: height + 'px'}">
        <canvas ref="chartCanvas" />
    </div>
</template>

<script setup lang="ts">
import {
    CategoryScale,
    Chart,
    Filler,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    Tooltip
} from 'chart.js';
import {onMounted, onUnmounted, ref, watch} from 'vue';

Chart.register(
    LineController,
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Filler
);

export interface Threshold {
    value: number;
    color: string;
    label: string;
}

const props = withDefaults(
    defineProps<{
        data: number[];
        label: string;
        color: string;
        unit?: string;
        height?: number;
        thresholds?: Threshold[];
        showArea?: boolean;
    }>(),
    {
        unit: '',
        height: 180,
        thresholds: () => [],
        showArea: true
    }
);

const chartCanvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

function createAnnotationLines() {
    // Threshold lines as datasets
    return props.thresholds.map((t) => ({
        label: t.label,
        data: new Array(props.data.length).fill(t.value),
        borderColor: t.color,
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        fill: false
    }));
}

function renderChart() {
    if (!chartCanvas.value) return;
    const ctx = chartCanvas.value.getContext('2d');
    if (!ctx) return;

    if (chart) {
        chart.destroy();
        chart = null;
    }

    const labels = props.data.map((_, i) => {
        const secsAgo = (props.data.length - 1 - i) * 5;
        if (secsAgo === 0) return 'now';
        if (secsAgo < 60) return `-${secsAgo}s`;
        return `-${Math.floor(secsAgo / 60)}m`;
    });

    // Only show a subset of labels to avoid clutter
    const maxLabels = 12;
    const step = Math.max(1, Math.floor(labels.length / maxLabels));
    const displayLabels = labels.map((l, i) =>
        i % step === 0 || i === labels.length - 1 ? l : ''
    );

    const values = [...props.data];
    const min = Math.min(...values, 0);
    const maxVal = Math.max(
        ...values,
        ...props.thresholds.map((t) => t.value),
        1
    );

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: displayLabels,
            datasets: [
                {
                    label: props.label,
                    data: values,
                    borderColor: props.color,
                    backgroundColor: props.showArea
                        ? props.color + '20'
                        : 'transparent',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    fill: props.showArea,
                    tension: 0.3
                },
                ...createAnnotationLines()
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {duration: 0},
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    grid: {color: '#262626'},
                    ticks: {
                        color: '#737373',
                        font: {size: 9, family: 'monospace'}
                    }
                },
                y: {
                    min,
                    suggestedMax: maxVal * 1.1,
                    grid: {color: '#262626'},
                    ticks: {
                        color: '#737373',
                        font: {size: 9, family: 'monospace'},
                        callback: (v: any) => `${v}${props.unit}`
                    }
                }
            },
            plugins: {
                tooltip: {
                    backgroundColor: '#1a1a1a',
                    titleColor: '#a3a3a3',
                    bodyColor: '#e5e5e5',
                    borderColor: '#404040',
                    borderWidth: 1,
                    bodyFont: {family: 'monospace', size: 11},
                    callbacks: {
                        label: (ctx: any) =>
                            `${ctx.dataset.label}: ${ctx.parsed.y}${props.unit}`
                    }
                },
                legend: {display: false}
            }
        }
    });
}

function updateChart() {
    if (!chart) {
        renderChart();
        return;
    }

    const labels = props.data.map((_, i) => {
        const secsAgo = (props.data.length - 1 - i) * 5;
        if (secsAgo === 0) return 'now';
        if (secsAgo < 60) return `-${secsAgo}s`;
        return `-${Math.floor(secsAgo / 60)}m`;
    });

    const maxLabels = 12;
    const step = Math.max(1, Math.floor(labels.length / maxLabels));
    const displayLabels = labels.map((l, i) =>
        i % step === 0 || i === labels.length - 1 ? l : ''
    );

    chart.data.labels = displayLabels;
    chart.data.datasets[0].data = [...props.data];

    // Update threshold line data
    const thresholdDatasets = createAnnotationLines();
    for (let i = 0; i < thresholdDatasets.length; i++) {
        if (chart.data.datasets[i + 1]) {
            chart.data.datasets[i + 1].data = thresholdDatasets[i].data;
        }
    }

    chart.update('none');
}

watch(() => props.data.length, updateChart);
watch(() => props.data[props.data.length - 1], updateChart);

onMounted(renderChart);
onUnmounted(() => {
    if (chart) {
        chart.destroy();
        chart = null;
    }
});
</script>
