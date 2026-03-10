<template>
    <div class="et-meter">
        <div class="et-meter__grid">
            <div v-for="m in metrics" :key="m.label" class="et-meter__card">
                <span class="et-meter__value">{{ m.value }}</span>
                <span class="et-meter__label">{{ m.label }}</span>
            </div>
        </div>
        <div v-if="hasEnergy" class="et-meter__energy">
            <div v-if="totalEnergy !== null" class="et-meter__card">
                <span class="et-meter__value">{{ totalEnergy }} kWh</span>
                <span class="et-meter__label">Total energy</span>
            </div>
            <div v-if="returnedEnergy !== null" class="et-meter__card">
                <span class="et-meter__value">{{ returnedEnergy }} kWh</span>
                <span class="et-meter__label">Returned energy</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = defineProps<{
    status: Record<string, any> | undefined;
}>();

interface Metric {
    label: string;
    value: string;
}

// pm1 uses apower, em1 uses act_power — detect both
const metrics = computed<Metric[]>(() => {
    const s = props.status;
    if (!s) return [];

    const out: Metric[] = [];

    // Power (W)
    const power = s.apower ?? s.act_power;
    if (power !== undefined) out.push({label: 'Power', value: `${power} W`});

    // Apparent power (VA) — em1 only
    if (s.aprt_power !== undefined) out.push({label: 'Apparent', value: `${s.aprt_power} VA`});

    // Voltage (V)
    if (s.voltage !== undefined) out.push({label: 'Voltage', value: `${s.voltage} V`});

    // Current (A)
    if (s.current !== undefined) out.push({label: 'Current', value: `${s.current} A`});

    // Power factor — em1 only
    if (s.pf !== undefined) out.push({label: 'Power factor', value: `${s.pf}`});

    // Frequency (Hz)
    if (s.freq !== undefined) out.push({label: 'Frequency', value: `${s.freq} Hz`});

    return out;
});

const totalEnergy = computed(() => {
    const total = props.status?.aenergy?.total ?? props.status?.total_act_energy;
    if (total === undefined) return null;
    return (total / 1000).toFixed(3);
});

const returnedEnergy = computed(() => {
    const total = props.status?.ret_aenergy?.total ?? props.status?.total_act_ret_energy;
    if (total === undefined) return null;
    return (total / 1000).toFixed(3);
});

const hasEnergy = computed(() => totalEnergy.value !== null || returnedEnergy.value !== null);
</script>

<style scoped>
.et-meter__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 0.375rem;
}
.et-meter__energy {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 0.375rem;
    margin-top: 0.375rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--color-border-default);
}
.et-meter__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.5rem;
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.et-meter__value {
    font-size: var(--text-base);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.et-meter__label {
    font-size: var(--text-xs);
    color: var(--color-text-disabled);
    text-align: center;
}
</style>
