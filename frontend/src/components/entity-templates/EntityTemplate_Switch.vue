<template>
    <div class="et-switch">
        <div class="et-switch__header">
            <span class="et-switch__state" :class="isOn ? 'et-switch__state--on' : 'et-switch__state--off'">
                {{ isOn ? 'ON' : 'OFF' }}
            </span>
            <button
                v-if="canExecute"
                class="et-switch__toggle"
                :class="isOn && 'et-switch__toggle--on'"
                @click="emit('toggle')"
            >
                <i class="fas fa-power-off" />
            </button>
        </div>
        <!-- Power metering (only if device reports it) -->
        <div v-if="metrics.length" class="et-switch__metrics">
            <div v-for="m in metrics" :key="m.label" class="et-switch__card">
                <span class="et-switch__value">{{ m.value }}</span>
                <span class="et-switch__label">{{ m.label }}</span>
            </div>
        </div>
        <div v-if="totalEnergy !== null" class="et-switch__energy">
            <span class="et-switch__label">Total energy</span>
            <span class="et-switch__value">{{ totalEnergy }} kWh</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = defineProps<{
    status: Record<string, any> | undefined;
    canExecute: boolean;
}>();

const emit = defineEmits<{
    toggle: [];
}>();

interface Metric {
    label: string;
    value: string;
}

const isOn = computed(() => !!props.status?.output);

const metrics = computed<Metric[]>(() => {
    const s = props.status;
    if (!s) return [];

    const out: Metric[] = [];
    if (s.apower !== undefined) out.push({label: 'Power', value: `${s.apower} W`});
    if (s.voltage !== undefined) out.push({label: 'Voltage', value: `${s.voltage} V`});
    if (s.current !== undefined) out.push({label: 'Current', value: `${s.current} A`});
    if (s.freq !== undefined) out.push({label: 'Frequency', value: `${s.freq} Hz`});
    if (s.temperature?.tC !== undefined) out.push({label: 'Temp', value: `${s.temperature.tC} °C`});
    return out;
});

const totalEnergy = computed(() => {
    const total = props.status?.aenergy?.total;
    if (total === undefined) return null;
    return (total / 1000).toFixed(3);
});
</script>

<style scoped>
.et-switch__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.5rem;
}
.et-switch__state {
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    letter-spacing: var(--tracking-wide);
}
.et-switch__state--on {
    color: var(--color-success-text);
}
.et-switch__state--off {
    color: var(--color-text-disabled);
}
.et-switch__toggle {
    width: 40px;
    height: 40px;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-base);
    cursor: pointer;
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3);
    color: var(--color-text-tertiary);
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.et-switch__toggle:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}
.et-switch__toggle--on {
    background-color: var(--color-success);
    border-color: var(--color-success);
    color: white;
}
.et-switch__metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 0.375rem;
}
.et-switch__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.5rem;
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.et-switch__energy {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.375rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--color-border-default);
}
.et-switch__value {
    font-size: var(--text-base);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.et-switch__label {
    font-size: var(--text-xs);
    color: var(--color-text-disabled);
    text-align: center;
}
</style>
