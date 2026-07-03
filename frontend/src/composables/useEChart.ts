import {onMounted, onUnmounted, type Ref, ref, watch} from 'vue';
import echarts from '@/tools/echarts';

type ChartOption = Record<string, any>;

export function useEChart(
    containerRef: Ref<HTMLElement | null>,
    optionRef: Ref<ChartOption>,
    opts?: {renderer?: 'canvas' | 'svg'}
) {
    const chart = ref<ReturnType<typeof echarts.init> | null>(null);
    const isKiosk =
        typeof document !== 'undefined' &&
        document.body.classList.contains('kiosk');
    const renderer = opts?.renderer ?? (isKiosk ? 'svg' : 'canvas');

    let ro: ResizeObserver | null = null;

    function initChart() {
        if (chart.value || !containerRef.value) return;
        chart.value = echarts.init(containerRef.value, 'fleet', {renderer});
        chart.value.setOption({
            ...optionRef.value,
            animation: !isKiosk
        });

        // Replace any prior observer so consecutive initChart calls (e.g.
        // container ref churn from v-if) don't leak observers.
        ro?.disconnect();
        ro = new ResizeObserver(() => {
            if (
                chart.value &&
                !chart.value.isDisposed() &&
                containerRef.value &&
                containerRef.value.offsetWidth > 0
            ) {
                chart.value.resize();
            }
        });
        ro.observe(containerRef.value);
    }

    onMounted(initChart);

    // Handle v-if/v-else: container may appear after onMounted
    watch(containerRef, (el) => {
        if (el && !chart.value) initChart();
    });

    watch(optionRef, (newOpt) => {
        if (!chart.value || chart.value.isDisposed()) return;
        chart.value.clear();
        chart.value.setOption(newOpt);
    });

    onUnmounted(() => {
        ro?.disconnect();
        ro = null;
        if (chart.value && !chart.value.isDisposed()) chart.value.dispose();
        chart.value = null;
    });

    return {chart};
}
