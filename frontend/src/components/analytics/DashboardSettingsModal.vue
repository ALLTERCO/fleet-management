<template>
    <teleport to="body">
        <div
            v-if="visible"
            class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50"
            role="dialog"
            aria-modal="true"
            @click.self="close"
        >
            <div class="bg-[var(--color-surface-2)] text-[var(--color-text-primary)] rounded-lg shadow-lg w-full max-w-md">
                <header class="flex justify-between items-center p-4 border-b border-[var(--color-border-default)]">
                    <h2 class="text-lg font-semibold">
                        <i class="fas fa-cog mr-2"></i>
                        Dashboard Settings
                    </h2>
                    <button
                        @click="close"
                        class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-2xl leading-none"
                        aria-label="Close"
                    >&times;</button>
                </header>

                <div class="p-4 space-y-4">
                    <!-- Tariff -->
                    <div>
                        <label class="block text-sm text-[var(--color-text-tertiary)] mb-1">Energy Tariff (per kWh)</label>
                        <div class="flex gap-2">
                            <input
                                v-model.number="localSettings.tariff"
                                type="number"
                                step="0.0001"
                                min="0"
                                class="flex-1 bg-[var(--color-surface-3)] text-white px-3 py-2 rounded border border-[var(--color-border-strong)] focus:border-[var(--color-primary)] focus:outline-none"
                                placeholder="0.00"
                            />
                            <select
                                v-model="localSettings.currency"
                                class="bg-[var(--color-surface-3)] text-white px-3 py-2 rounded border border-[var(--color-border-strong)] focus:border-[var(--color-primary)] focus:outline-none"
                            >
                                <option value="EUR">EUR</option>
                                <option value="USD">USD</option>
                                <option value="GBP">GBP</option>
                                <option value="BGN">BGN</option>
                                <option value="CHF">CHF</option>
                            </select>
                        </div>
                    </div>

                    <!-- Default Range -->
                    <div>
                        <label class="block text-sm text-[var(--color-text-tertiary)] mb-1">Default Time Range</label>
                        <select
                            v-model="localSettings.defaultRange"
                            class="w-full bg-[var(--color-surface-3)] text-white px-3 py-2 rounded border border-[var(--color-border-strong)] focus:border-[var(--color-primary)] focus:outline-none"
                        >
                            <option value="last_24h">Last 24 hours</option>
                            <option value="last_7_days">Last 7 days</option>
                            <option value="last_30_days">Last 30 days</option>
                            <option value="this_month">This month</option>
                        </select>
                    </div>

                    <!-- Refresh Interval -->
                    <div>
                        <label class="block text-sm text-[var(--color-text-tertiary)] mb-1">Auto-refresh Interval</label>
                        <select
                            v-model.number="localSettings.refreshInterval"
                            class="w-full bg-[var(--color-surface-3)] text-white px-3 py-2 rounded border border-[var(--color-border-strong)] focus:border-[var(--color-primary)] focus:outline-none"
                        >
                            <option :value="30000">30 seconds</option>
                            <option :value="60000">1 minute</option>
                            <option :value="300000">5 minutes</option>
                            <option :value="600000">10 minutes</option>
                            <option :value="0">Disabled</option>
                        </select>
                    </div>

                    <!-- Enabled Metrics -->
                    <div>
                        <label class="block text-sm text-[var(--color-text-tertiary)] mb-2">Enabled Metrics</label>
                        <div class="grid grid-cols-2 gap-2">
                            <label
                                v-for="metric in availableMetrics"
                                :key="metric.value"
                                class="flex items-center gap-2 text-sm cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    :checked="localSettings.enabledMetrics.includes(metric.value)"
                                    class="rounded bg-[var(--color-surface-3)] border-[var(--color-border-strong)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                                    @change="toggleMetric(metric.value)"
                                />
                                <i :class="metric.icon" class="text-[var(--color-text-tertiary)]"></i>
                                {{ metric.label }}
                            </label>
                        </div>
                    </div>
                </div>

                <footer class="flex justify-end gap-2 p-4 border-t border-[var(--color-border-default)]">
                    <button
                        class="px-4 py-2 bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] rounded hover:bg-[var(--color-surface-2)] transition-colors"
                        @click="close"
                    >
                        Cancel
                    </button>
                    <button
                        class="px-4 py-2 bg-[var(--color-primary)] text-white rounded hover:bg-[var(--color-primary-hover)] transition-colors"
                        :disabled="saving"
                        @click="save"
                    >
                        <i v-if="saving" class="fas fa-spinner fa-spin mr-2"></i>
                        Save Settings
                    </button>
                </footer>
            </div>
        </div>
    </teleport>
</template>

<script setup lang="ts">
import {reactive, ref, watch} from 'vue';
import type {DashboardSettings} from '@/stores/analytics';

const props = defineProps<{
    visible: boolean;
    settings: DashboardSettings | null;
}>();

const emit = defineEmits<{
    close: [];
    save: [settings: Partial<DashboardSettings>];
}>();

const saving = ref(false);

const availableMetrics = [
    {value: 'uptime', label: 'Uptime', icon: 'fas fa-clock'},
    {value: 'voltage', label: 'Voltage', icon: 'fas fa-bolt'},
    {value: 'current', label: 'Current (Amps)', icon: 'fas fa-wave-square'},
    {value: 'power', label: 'Power', icon: 'fas fa-plug'},
    {value: 'consumption', label: 'Consumption', icon: 'fas fa-chart-line'},
    {
        value: 'returned_energy',
        label: 'Returned Energy',
        icon: 'fas fa-arrow-rotate-left'
    },
    {
        value: 'temperature',
        label: 'Temperature',
        icon: 'fas fa-thermometer-half'
    },
    {value: 'humidity', label: 'Humidity', icon: 'fas fa-tint'},
    {value: 'luminance', label: 'Luminance', icon: 'fas fa-sun'}
];

const localSettings = reactive({
    tariff: 0,
    currency: 'EUR',
    defaultRange: 'last_7_days',
    refreshInterval: 60000,
    enabledMetrics: [
        'uptime',
        'voltage',
        'current',
        'power',
        'consumption',
        'returned_energy',
        'temperature',
        'humidity',
        'luminance'
    ] as string[]
});

watch(
    () => props.settings,
    (newSettings) => {
        if (newSettings) {
            localSettings.tariff = newSettings.tariff;
            localSettings.currency = newSettings.currency;
            localSettings.defaultRange = newSettings.defaultRange;
            localSettings.refreshInterval = newSettings.refreshInterval;
            localSettings.enabledMetrics = [...newSettings.enabledMetrics];
        }
    },
    {immediate: true}
);

function toggleMetric(metric: string) {
    const idx = localSettings.enabledMetrics.indexOf(metric);
    if (idx >= 0) {
        localSettings.enabledMetrics.splice(idx, 1);
    } else {
        localSettings.enabledMetrics.push(metric);
    }
}

function close() {
    emit('close');
}

async function save() {
    saving.value = true;
    try {
        emit('save', {
            tariff: localSettings.tariff,
            currency: localSettings.currency,
            defaultRange: localSettings.defaultRange,
            refreshInterval: localSettings.refreshInterval,
            enabledMetrics: localSettings.enabledMetrics
        });
        close();
    } finally {
        saving.value = false;
    }
}
</script>
