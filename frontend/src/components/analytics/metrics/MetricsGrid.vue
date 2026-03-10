<template>
    <div>
        <!-- Uptime Table -->
        <div v-if="!props.hideUptime && showMetric('uptime') && uptimeData.length > 0" class="mb-4 bg-[var(--color-surface-2)] rounded-lg p-4">
            <h3 class="text-lg font-semibold text-white mb-3">
                <i class="fas fa-clock mr-2 text-[var(--color-success-text)]"></i>
                Device Uptime
            </h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="text-[var(--color-text-tertiary)] border-b border-[var(--color-border-default)]">
                            <th class="text-left py-2 px-3">Device</th>
                            <th class="text-right py-2 px-3">Uptime</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="device in uptimeData" :key="device.deviceId" class="border-b border-[var(--color-border-default)]/50 hover:bg-[var(--color-surface-3)]/30">
                            <td class="py-2 px-3 text-white">{{ device.deviceName }}</td>
                            <td class="py-2 px-3 text-right text-[var(--color-success-text)] font-mono">{{ formatUptime(device.value) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Metric Cards Grid -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        <!-- Voltage -->
        <MetricCard
            v-if="showMetric('voltage')"
            label="Avg Voltage"
            :value="metrics?.voltage?.avg ?? null"
            unit="V"
            icon="fas fa-bolt"
            color="yellow"
            :min="metrics?.voltage?.min"
            :max="metrics?.voltage?.max"
            show-range
        />

        <!-- Current -->
        <MetricCard
            v-if="showMetric('current')"
            label="Avg Current"
            :value="metrics?.current?.avg ?? null"
            unit="A"
            icon="fas fa-wave-square"
            color="blue"
            :min="metrics?.current?.min"
            :max="metrics?.current?.max"
            show-range
        />

        <!-- Power -->
        <MetricCard
            v-if="showMetric('power')"
            label="Total Power"
            :value="metrics?.power?.total ?? null"
            unit="W"
            icon="fas fa-plug"
            color="orange"
        />

        <!-- Consumption -->
        <MetricCard
            v-if="showMetric('consumption')"
            label="Total Consumption"
            :value="metrics?.consumption?.total ?? null"
            unit="kWh"
            icon="fas fa-chart-line"
            color="green"
        />

        <!-- Returned Energy -->
        <MetricCard
            v-if="showMetric('returned_energy')"
            label="Returned Energy"
            :value="metrics?.returned_energy?.total ?? null"
            unit="kWh"
            icon="fas fa-arrow-rotate-left"
            color="teal"
        />

        <!-- Cost (if tariff is set) -->
        <MetricCard
            v-if="showMetric('consumption') && tariff > 0"
            label="Estimated Cost"
            :value="cost"
            :unit="currency"
            icon="fas fa-money-bill-wave"
            color="purple"
            :decimals="2"
        />

        <!-- Temperature -->
        <MetricCard
            v-if="showMetric('temperature')"
            label="Avg Temperature"
            :value="metrics?.temperature?.avg ?? null"
            unit="°C"
            icon="fas fa-thermometer-half"
            color="red"
            :min="metrics?.temperature?.min"
            :max="metrics?.temperature?.max"
            show-range
        />

        <!-- Humidity -->
        <MetricCard
            v-if="showMetric('humidity')"
            label="Avg Humidity"
            :value="metrics?.humidity?.avg ?? null"
            unit="%"
            icon="fas fa-tint"
            color="cyan"
            :min="metrics?.humidity?.min"
            :max="metrics?.humidity?.max"
            show-range
        />

        <!-- Luminance -->
        <MetricCard
            v-if="showMetric('luminance')"
            label="Avg Luminance"
            :value="metrics?.luminance?.avg ?? null"
            unit="lux"
            icon="fas fa-sun"
            color="yellow"
        />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import type {GroupMetrics} from '@/stores/analytics';
import MetricCard from './MetricCard.vue';

const props = withDefaults(
    defineProps<{
        metrics: GroupMetrics['metrics'] | null;
        capabilities: string[];
        enabledMetrics?: string[];
        tariff?: number;
        currency?: string;
        hideUptime?: boolean;
    }>(),
    {
        enabledMetrics: () => [
            'uptime',
            'voltage',
            'current',
            'power',
            'consumption',
            'returned_energy',
            'temperature',
            'humidity',
            'luminance'
        ],
        tariff: 0,
        currency: 'EUR',
        hideUptime: false
    }
);

function showMetric(metric: string): boolean {
    // Show metric if device supports it AND it's enabled in settings
    return (
        props.capabilities.includes(metric) &&
        props.enabledMetrics.includes(metric)
    );
}

const cost = computed(() => {
    if (!props.metrics?.consumption?.total || props.tariff <= 0) return null;
    return props.metrics.consumption.total * props.tariff;
});

// Get uptime data for table display
const uptimeData = computed(() => {
    const values = (props.metrics as any)?.uptime?.values || [];
    return values
        .map((v: any) => ({
            deviceId: v.deviceId,
            deviceName: v.deviceName || `Device ${v.deviceId}`,
            value: v.value
        }))
        .sort((a: any, b: any) => b.value - a.value); // Sort by uptime descending
});

// Format uptime from seconds to human readable
function formatUptime(seconds: number): string {
    if (!seconds) return '--';

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
</script>
