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
        const el = containerRef.value;
        if (chart.value || !el) return;
        chart.value = echarts.init(el, 'fleet', {renderer});
        chart.value.setOption({...optionRef.value, animation: !isKiosk});
    }

    // Init is driven by the ResizeObserver, never synchronously on mount: the
    // RO fires only after layout, so the container always has its real size.
    // Initialising at 0×0 — or on a stale size when a v-if tab remounts into
    // the same slot — makes ECharts build a grid with no extent and then warn
    // "cartesian2d cannot be found" as the series lays out.
    function observe() {
        const el = containerRef.value;
        if (!el) return;
        ro?.disconnect();
        ro = new ResizeObserver(() => {
            const node = containerRef.value;
            if (!node || node.offsetWidth === 0 || node.offsetHeight === 0)
                return;
            if (!chart.value) initChart();
            else if (!chart.value.isDisposed()) chart.value.resize();
        });
        ro.observe(el);
    }

    onMounted(observe);

    // Handle v-if/v-else: container may appear/change after onMounted.
    watch(containerRef, (el) => {
        if (el) observe();
    });

    watch(optionRef, (newOpt) => {
        // Not yet init'd (container still 0-size); the RO init picks up the
        // latest option, so nothing is lost here.
        if (!chart.value || chart.value.isDisposed()) return;
        // Atomic full replace: no intermediate empty render (the old
        // clear()+setOption briefly left a series with no coordinate system).
        chart.value.setOption(newOpt, {notMerge: true});
    });

    onUnmounted(() => {
        ro?.disconnect();
        ro = null;
        if (chart.value && !chart.value.isDisposed()) chart.value.dispose();
        chart.value = null;
    });

    return {chart};
}
