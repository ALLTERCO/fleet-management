import type {DashKpiMetric} from '@/types/dashboard-components';

export type KpiSeverity = 'normal' | 'warning' | 'danger';

export function formatKpiValue(metric: DashKpiMetric): string {
    if (metric.value == null) return '—';
    if (typeof metric.value === 'string') return metric.value;
    const dp = metric.decimals ?? 1;
    return metric.value.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: dp
    });
}

export function kpiDeltaDirection(
    delta: string | null | undefined
): 'up' | 'down' | 'flat' {
    if (!delta) return 'flat';
    if (delta.startsWith('+') || delta.startsWith('↑')) return 'up';
    if (delta.startsWith('-') || delta.startsWith('↓')) return 'down';
    return 'flat';
}

// danger wins ties; an inverted (warning > danger) config is treated as the
// caller's bug and falls back to the danger threshold alone.
export function kpiSeverity(metric: DashKpiMetric): KpiSeverity {
    if (typeof metric.value !== 'number' || !metric.threshold) return 'normal';
    const {warning, danger} = normalizedThresholds(metric.threshold);
    if (danger !== undefined && metric.value >= danger) return 'danger';
    if (warning !== undefined && metric.value >= warning) return 'warning';
    return 'normal';
}

function normalizedThresholds(threshold: {warning?: number; danger?: number}): {
    warning?: number;
    danger?: number;
} {
    const {warning, danger} = threshold;
    if (warning !== undefined && danger !== undefined && warning > danger) {
        return {warning: undefined, danger};
    }
    return {warning, danger};
}

export function sparkStrokeFor(severity: KpiSeverity): string {
    if (severity === 'danger') return 'var(--sparkline-stroke-danger)';
    if (severity === 'warning') return 'var(--sparkline-stroke-warning)';
    return 'var(--sparkline-stroke)';
}
