<template>
    <div>
        <!-- Phase cards — responsive grid, dynamic phase count -->
        <div class="entity-em__phases">
            <div v-for="(entries, index) of phasesInfo" :key="index" class="entity-em__phase-group">
                <div
                    v-for="[name, value, unit] of entries"
                    :key="name"
                    class="flex flex-col items-center entity-em__card p-2 rounded-lg"
                >
                    <span class="text-base font-bold">{{ value }} {{ unit ?? '' }}</span>
                    <span class="text-xs entity-em__label text-center">{{ name }}</span>
                </div>
            </div>
        </div>

        <div v-if="neutralCurrent !== null" class="flex flex-col items-center entity-em__card p-2 rounded-lg mt-2">
            <span class="text-base font-bold">{{ neutralCurrent }}</span>
            <span class="text-xs entity-em__label text-center">Neutral current</span>
        </div>

        <div class="flex items-start">
            <h6 class="mt-2 font-bold">Total</h6>
        </div>
        <div class="entity-em__totals">
            <div
                v-for="[name, value, unit] of totalsInfo"
                :key="name"
                class="flex flex-col items-center entity-em__card p-2 rounded-lg"
            >
                <span class="text-base font-bold">{{ value }} {{ unit ?? '' }}</span>
                <span class="text-xs entity-em__label text-center">{{ name }}</span>
            </div>
        </div>
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
            entity.value.type + ':' + entity.value.properties.id
        ]
);

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

    // Sort alphabetically (a, b, c, ...)
    return [...found].sort();
});

const phasesInfo = computed(() => {
    const status = entityStatus.value;
    if (!status) return [];

    return activePhases.value.map((phase) => {
        const calibrated = status.user_calibrated_phase;
        const isUserCalibrated = Array.isArray(calibrated) && calibrated.includes(phase);
        const name = `${phase.toUpperCase()}${isUserCalibrated ? '*' : ''}`;

        return [
            ['Phase', name],
            ['Active power', status[`${phase}_act_power`], 'W'],
            ['Apparent power', status[`${phase}_aprt_power`], 'W'],
            ['Current', status[`${phase}_current`], 'A'],
            ['Voltage', status[`${phase}_voltage`], 'V'],
            ['PF', status[`${phase}_pf`]]
        ];
    });
});

const totalsInfo = computed(() => {
    return [
        ['Active power', entityStatus.value?.total_act_power, 'W'],
        ['Apparent power', entityStatus.value?.total_aprt_power, 'W'],
        ['Current', entityStatus.value?.total_current, 'A']
    ];
});

const neutralCurrent = computed(() => {
    const calibrated = entityStatus.value?.user_calibrated_phase;
    if (Array.isArray(calibrated) && calibrated.includes('n')) {
        return `${entityStatus.value?.n_current ?? 'N/A'} A`;
    }
    return null;
});
</script>

<style scoped>
.entity-em__phases {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.5rem;
}

.entity-em__phase-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.entity-em__totals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.5rem;
    margin-top: 0.25rem;
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-border-default);
    margin-bottom: var(--space-1);
}

.entity-em__card {
    background-color: var(--color-surface-2);
}

.entity-em__label {
    color: var(--color-text-disabled);
}
</style>
