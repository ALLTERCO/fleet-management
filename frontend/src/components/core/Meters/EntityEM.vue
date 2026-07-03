<template>
    <div>
        <div class="entity-em__phases">
            <div v-for="phase in phasesInfo" :key="phase.name" class="entity-em__phase-group">
                <div :class="['entity-em__card', `entity-em__card--phase-${phase.name.toLowerCase()}`]">
                    <span class="entity-em__card-value">{{ phase.name }}<span v-if="phase.calibrated" class="entity-em__calibrated-mark">*</span></span>
                    <span class="entity-em__card-label">Phase</span>
                </div>
                <div v-for="m in phase.metrics" :key="m.label" class="entity-em__card">
                    <span class="entity-em__card-value">{{ m.value }}<span v-if="m.unit" class="entity-em__card-unit"> {{ m.unit }}</span></span>
                    <span class="entity-em__card-label">{{ m.label }}</span>
                </div>
            </div>
        </div>

        <div v-if="neutralCurrent !== null" class="entity-em__card entity-em__card--neutral">
            <span class="entity-em__card-value">{{ neutralCurrent }}</span>
            <span class="entity-em__card-label">Neutral current</span>
        </div>

        <h6 class="entity-em__section-title">Total</h6>
        <div class="entity-em__totals">
            <div v-for="m in totalsInfo" :key="m.label" class="entity-em__card">
                <span class="entity-em__card-value">{{ m.value }}<span v-if="m.unit" class="entity-em__card-unit"> {{ m.unit }}</span></span>
                <span class="entity-em__card-label">{{ m.label }}</span>
            </div>
        </div>

        <div
            v-if="phaseBalance"
            class="entity-em__balance"
            :class="phaseBalance.isBalanced ? 'entity-em__balance--ok' : 'entity-em__balance--warn'"
        >
            <i :class="phaseBalance.isBalanced ? 'fas fa-check-circle' : 'fas fa-triangle-exclamation'" />
            Phase imbalance: {{ phaseBalance.imbalance }}%
        </div>

        <template v-if="hasEnergy">
            <h6 class="entity-em__section-title">Energy</h6>
            <div class="entity-em__totals">
                <div v-if="totalActiveEnergy !== null" class="entity-em__card">
                    <span class="entity-em__card-value">{{ totalActiveEnergy }}<span class="entity-em__card-unit"> kWh</span></span>
                    <span class="entity-em__card-label">Total consumed</span>
                </div>
                <div v-if="totalReturnedEnergy !== null" class="entity-em__card">
                    <span class="entity-em__card-value">{{ totalReturnedEnergy }}<span class="entity-em__card-unit"> kWh</span></span>
                    <span class="entity-em__card-label">Total returned</span>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, toRefs} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import type {em_entity} from '@/types';

const props = defineProps<{
    entity: em_entity;
}>();

const {entity} = toRefs(props);

const deviceStore = useDevicesStore();

const device = computed(() => deviceStore.devices[entity.value.source]);
const entityStatus = computed(
    () =>
        device.value?.status?.[
            `${entity.value.type}:${entity.value.properties.id}`
        ]
);

interface PhaseMetric {
    label: string;
    value: any;
    unit?: string;
}

interface PhaseInfo {
    name: string;
    calibrated: boolean;
    metrics: PhaseMetric[];
}

// Detect available phases dynamically from device status instead of hardcoding ['a','b','c'].
// Looks for keys like "a_act_power", "b_act_power", etc. in the entity status.
const activePhases = computed<string[]>(() => {
    const status = entityStatus.value;
    if (!status) return [];

    const found = new Set<string>();
    for (const key of Object.keys(status)) {
        const match = key.match(/^([a-z])_act_power$/);
        if (match) found.add(match[1]);
    }

    return [...found].sort();
});

const phasesInfo = computed<PhaseInfo[]>(() => {
    const status = entityStatus.value;
    if (!status) return [];

    return activePhases.value.map((phase) => {
        const calibrated = status.user_calibrated_phase;
        const isCalibrated =
            Array.isArray(calibrated) && calibrated.includes(phase);

        const metrics: PhaseMetric[] = [
            {label: 'Power factor', value: status[`${phase}_pf`]},
            {label: 'Voltage', value: status[`${phase}_voltage`], unit: 'V'},
            {label: 'Current', value: status[`${phase}_current`], unit: 'A'},
            {label: 'Frequency', value: status[`${phase}_freq`], unit: 'Hz'},
            {label: 'Active power', value: status[`${phase}_act_power`], unit: 'W'},
            {label: 'Apparent power', value: status[`${phase}_aprt_power`], unit: 'VA'}
        ];

        // Newer firmware exposes per-minute energy in the em component status
        const actMin = status[`${phase}_act_energy`]?.by_minute?.[0];
        const retMin = status[`${phase}_ret_act_energy`]?.by_minute?.[0];
        if (actMin != null) metrics.push({label: 'Act energy/min', value: actMin, unit: 'mWh'});
        if (retMin != null) metrics.push({label: 'Ret energy/min', value: retMin, unit: 'mWh'});

        return {name: phase.toUpperCase(), calibrated: isCalibrated, metrics};
    });
});

const totalsInfo = computed<PhaseMetric[]>(() => [
    {label: 'Active power', value: entityStatus.value?.total_act_power, unit: 'W'},
    {label: 'Apparent power', value: entityStatus.value?.total_aprt_power, unit: 'VA'},
    {label: 'Current', value: entityStatus.value?.total_current, unit: 'A'}
]);

const neutralCurrent = computed(() => {
    const calibrated = entityStatus.value?.user_calibrated_phase;
    if (Array.isArray(calibrated) && calibrated.includes('n')) {
        return `${entityStatus.value?.n_current ?? 'N/A'} A`;
    }
    return null;
});

// Energy data from emdata:N sibling status key
const energyStatus = computed(() => {
    const id = entity.value.properties.id;
    return device.value?.status?.[`emdata:${id}`];
});

const totalActiveEnergy = computed(() => {
    const total = energyStatus.value?.total_act;
    if (total == null) return null;
    return (total / 1000).toFixed(2);
});

const totalReturnedEnergy = computed(() => {
    const total = energyStatus.value?.total_act_ret;
    if (total == null) return null;
    return (total / 1000).toFixed(2);
});

const hasEnergy = computed(
    () => totalActiveEnergy.value !== null || totalReturnedEnergy.value !== null
);

// Phase balance: calculates imbalance percentage across phases
const phaseBalance = computed(() => {
    const status = entityStatus.value;
    if (!status || activePhases.value.length < 2) return null;
    const powers = activePhases.value.map((p) =>
        Math.abs(status[`${p}_act_power`] ?? 0)
    );
    const max = Math.max(...powers);
    const min = Math.min(...powers);
    if (max === 0) return null;
    const imbalance = ((max - min) / max) * 100;
    return {imbalance: imbalance.toFixed(0), isBalanced: imbalance < 20};
});
</script>

<style scoped>
.entity-em__phases {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: var(--space-2);
}

.entity-em__phase-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.entity-em__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-0-5);
    background-color: var(--color-surface-2);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    text-align: center;
}

.entity-em__card--phase-a {
    background-color: color-mix(in srgb, var(--color-primary) 14%, var(--color-surface-2));
}
.entity-em__card--phase-a .entity-em__card-value {
    color: var(--color-primary-text);
}
.entity-em__card--phase-b {
    background-color: color-mix(in srgb, var(--color-warning) 14%, var(--color-surface-2));
}
.entity-em__card--phase-b .entity-em__card-value {
    color: var(--color-warning-text);
}
.entity-em__card--phase-c {
    background-color: color-mix(in srgb, var(--color-success) 14%, var(--color-surface-2));
}
.entity-em__card--phase-c .entity-em__card-value {
    color: var(--color-success-text);
}

.entity-em__card--neutral {
    margin-top: var(--space-2);
    width: fit-content;
}

.entity-em__card-value {
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}

.entity-em__card-unit {
    font-weight: var(--font-normal);
    color: var(--color-text-tertiary);
}

.entity-em__card-label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.entity-em__calibrated-mark {
    color: var(--color-primary-text);
}

.entity-em__section-title {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    margin-top: var(--space-3);
    margin-bottom: var(--space-1);
}

.entity-em__totals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-border-default);
    margin-bottom: var(--space-1);
}

.entity-em__balance {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-sm);
    margin-top: var(--space-2);
    width: fit-content;
}

.entity-em__balance--ok {
    color: var(--color-success-text);
    background-color: color-mix(in srgb, var(--color-success) 10%, transparent);
}

.entity-em__balance--warn {
    color: var(--color-warning-text);
    background-color: color-mix(in srgb, var(--color-warning) 10%, transparent);
}
</style>
