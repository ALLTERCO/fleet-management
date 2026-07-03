import {
    BarChart,
    GaugeChart,
    GraphChart,
    HeatmapChart,
    LineChart,
    PieChart,
    SankeyChart,
    SunburstChart,
    TreemapChart
} from 'echarts/charts';
import {
    DataZoomComponent,
    GridComponent,
    LegendComponent,
    MarkAreaComponent,
    MarkLineComponent,
    PolarComponent,
    TooltipComponent,
    VisualMapComponent
} from 'echarts/components';
// Brush + Toolbox are registered locally by DashTimeChart only. Registering
// them globally makes the brush controller run on every chart's render and
// crash on grids whose coordinateSystem hasn't been built yet
// (`Cannot read properties of undefined (reading 'master')`).
import * as echarts from 'echarts/core';
import {CanvasRenderer, SVGRenderer} from 'echarts/renderers';

echarts.use([
    LineChart,
    BarChart,
    GaugeChart,
    HeatmapChart,
    PieChart,
    SunburstChart,
    TreemapChart,
    SankeyChart,
    GraphChart,
    GridComponent,
    PolarComponent,
    TooltipComponent,
    LegendComponent,
    DataZoomComponent,
    MarkLineComponent,
    MarkAreaComponent,
    VisualMapComponent,
    CanvasRenderer,
    SVGRenderer
]);

function resolveToken(name: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback;
    return (
        getComputedStyle(document.documentElement)
            .getPropertyValue(name)
            ?.trim() || fallback
    );
}

export function registerFleetTheme() {
    const textTertiary = resolveToken('--color-text-tertiary', '#7199b4');
    const textPrimary = resolveToken('--color-text-primary', '#eaf4ff');
    const primary = resolveToken('--color-primary', '#4495d1');

    echarts.registerTheme('fleet', {
        backgroundColor: 'transparent',
        textStyle: {
            color: textTertiary,
            fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif"
        },
        title: {
            textStyle: {color: textPrimary},
            subtextStyle: {color: textTertiary}
        },
        line: {
            itemStyle: {borderWidth: 1.5},
            lineStyle: {width: 2},
            symbolSize: 0,
            symbol: 'none',
            smooth: 0.4
        },
        bar: {itemStyle: {barBorderRadius: [3, 3, 0, 0]}},
        pie: {itemStyle: {borderColor: 'transparent', borderWidth: 2}},
        gauge: {
            axisLine: {
                lineStyle: {
                    color: [[1, 'rgba(255,255,255,0.04)']],
                    width: 12
                }
            },
            axisTick: {show: false},
            splitLine: {show: false},
            axisLabel: {show: false},
            pointer: {show: false},
            title: {color: textTertiary, fontSize: 10},
            detail: {
                color: textPrimary,
                fontSize: 20,
                fontWeight: 400,
                fontFamily:
                    "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif"
            }
        },
        categoryAxis: {
            axisLine: {show: false},
            axisTick: {show: false},
            axisLabel: {color: 'rgba(255,255,255,0.4)', fontSize: 10},
            splitLine: {show: false}
        },
        valueAxis: {
            axisLine: {show: false},
            axisTick: {show: false},
            axisLabel: {color: 'rgba(255,255,255,0.4)', fontSize: 10},
            splitLine: {
                lineStyle: {
                    color: 'rgba(255,255,255,0.05)',
                    type: 'solid' as const
                }
            }
        },
        tooltip: {
            backgroundColor: 'rgba(10, 16, 28, 0.95)',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            textStyle: {color: textPrimary, fontSize: 12},
            trigger: 'axis',
            extraCssText:
                'backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 8px 32px rgba(0,0,0,0.5); border-radius: 8px;',
            axisPointer: {
                type: 'line',
                lineStyle: {
                    color: 'rgba(255,255,255,0.08)',
                    type: 'solid',
                    width: 1
                }
            }
        },
        legend: {
            textStyle: {color: textTertiary, fontSize: 10},
            itemWidth: 8,
            itemHeight: 8
        },
        // No dataZoom default — themes shouldn't add interactive components.
        // Charts that want zoom set it themselves (e.g. DashTimeChart). The
        // inside-dataZoom processor crashes on charts with no series data.
        color: [
            primary,
            '#00bcd4',
            '#6c5ce7',
            '#ff9800',
            '#00c853',
            '#f44336',
            '#e91e63',
            '#9c27b0'
        ],
        animationDuration: 800,
        animationEasing: 'cubicOut',
        animationDurationUpdate: 300,
        animationEasingUpdate: 'cubicOut'
    });
}

// Auto-register fleet theme on first import — ensures theme is available
// regardless of which page renders ECharts first (dashboards, device page, etc.)
// Must be synchronous — deferred registration races with onMounted chart.init().
// CSS variables are available by the time JS modules execute (stylesheets load first).
if (typeof document !== 'undefined') {
    registerFleetTheme();
}

// Re-export echarts namespace — components import this to access:
// - echarts.init(el, theme, opts)
// - echarts.graphic.LinearGradient (available from echarts/core, no separate import needed)
export default echarts;
export {CanvasRenderer, SVGRenderer};
