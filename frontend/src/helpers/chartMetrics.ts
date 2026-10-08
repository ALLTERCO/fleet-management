import type {ChartMetric} from '@/composables/useChartData';

export interface MetricMeta {
    label: string;
    unit: string;
    icon: string;
    color: string;
    precision: number;
}

// One home for per-metric display: label, unit, icon, plot colour, precision.
const METRIC_META: Record<ChartMetric, MetricMeta> = {
    power: {
        label: 'Power',
        unit: 'W',
        icon: 'fas fa-bolt',
        color: '#f59e0b',
        precision: 1
    },
    consumption: {
        label: 'Energy',
        unit: 'Wh',
        icon: 'fas fa-bolt',
        color: '#f59e0b',
        precision: 2
    },
    returned_energy: {
        label: 'Return',
        unit: 'Wh',
        icon: 'fas fa-bolt',
        color: '#10b981',
        precision: 2
    },
    voltage: {
        label: 'Voltage',
        unit: 'V',
        icon: 'fas fa-bolt',
        color: '#6366f1',
        precision: 1
    },
    current: {
        label: 'Current',
        unit: 'A',
        icon: 'fas fa-bolt',
        color: '#ec4899',
        precision: 2
    },
    apparent_power: {
        label: 'Apparent power',
        unit: 'VA',
        icon: 'fas fa-bolt',
        color: '#fb923c',
        precision: 0
    },
    power_factor: {
        label: 'Power factor',
        unit: '',
        icon: 'fas fa-gauge-high',
        color: '#a78bfa',
        precision: 2
    },
    frequency: {
        label: 'Frequency',
        unit: 'Hz',
        icon: 'fas fa-wave-square',
        color: '#22d3ee',
        precision: 2
    },
    total_power: {
        label: 'Total power',
        unit: 'W',
        icon: 'fas fa-bolt',
        color: '#f59e0b',
        precision: 1
    },
    total_apparent_power: {
        label: 'Total apparent',
        unit: 'VA',
        icon: 'fas fa-bolt',
        color: '#fb923c',
        precision: 0
    },
    total_current: {
        label: 'Total current',
        unit: 'A',
        icon: 'fas fa-bolt',
        color: '#ec4899',
        precision: 2
    },
    neutral_current: {
        label: 'Neutral current',
        unit: 'A',
        icon: 'fas fa-bolt',
        color: '#f472b6',
        precision: 2
    },
    temperature: {
        label: 'Temperature',
        unit: '°C',
        icon: 'fas fa-thermometer-half',
        color: '#ef4444',
        precision: 1
    },
    humidity: {
        label: 'Humidity',
        unit: '%',
        icon: 'fas fa-tint',
        color: '#3b82f6',
        precision: 1
    },
    luminance: {
        label: 'Luminance',
        unit: 'lux',
        icon: 'fas fa-sun',
        color: '#eab308',
        precision: 0
    }
};

export function metricMeta(metric: ChartMetric): MetricMeta {
    return METRIC_META[metric] ?? METRIC_META.power;
}
