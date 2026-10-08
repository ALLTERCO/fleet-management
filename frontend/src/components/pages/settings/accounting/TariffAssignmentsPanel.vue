<template>
    <section class="ua-panel" aria-labelledby="tariff-assignments-title">
        <header class="ua-panel__header">
            <div class="ua-panel__heading">
                <h2 id="tariff-assignments-title">Tariff assignments</h2>
                <p>
                    Import charges and export credits resolve independently.
                    Review the direction and scope before replacing an assignment.
                </p>
            </div>
            <Button
                v-if="canWrite"
                type="green"
                size="sm"
                @click="toggleEditor"
            >
                Assign tariff
            </Button>
        </header>

        <div class="ua-filterbar">
            <fieldset class="ua-segment">
                <legend class="sr-only">Energy direction</legend>
                <button
                    v-for="option in DIRECTIONS"
                    :key="option.value"
                    type="button"
                    :class="{'is-active': direction === option.value}"
                    :aria-pressed="direction === option.value"
                    @click="direction = option.value"
                >
                    {{ option.label }}
                </button>
            </fieldset>
            <label class="ua-compact-field">
                <span>Commodity</span>
                <select v-model="commodity" class="ua-select">
                    <option v-for="value in commodities" :key="value" :value="value">
                        {{ titleCase(value) }}
                    </option>
                </select>
            </label>
        </div>

        <div v-if="loadError" class="ua-state ua-state--error" role="alert">
            <div>
                <strong>Couldn’t load tariffs and assignments.</strong>
                <span>{{ loadError }}</span>
            </div>
            <Button type="blue-hollow" size="sm" @click="load">Retry</Button>
        </div>

        <TariffAssignmentEditor
            v-model:direction="direction"
            v-model:commodity="commodity"
            :open="showEditor && canWrite"
            :tariffs="tariffs"
            :commodities="commodities"
            :locations="locations"
            :devices="devices"
            @close="showEditor = false"
            @saved="onAssignmentSaved"
        />

        <TariffAssignmentRemoval
            :row="removalRow"
            :tariffs="tariffs"
            :can-write="canWrite"
            @cancel="removalRow = null"
            @removed="onAssignmentRemoved"
        />

        <TariffAssignmentList
            :rows="filteredAssignments"
            :tariffs="tariffs"
            :filter="{direction, commodity}"
            :loading="loading"
            :failed="loadError !== ''"
            :can-write="canWrite"
            @remove="removalRow = $event"
        />

        <TariffCoverageCheck
            :devices="devices"
            :locations="locations"
            :assignments="assignments"
            :tariffs="tariffs"
            :commodity="commodity"
        />
    </section>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import type {HostResult} from '@/shell/template-host/generated/contract';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useLocationsStore} from '@/stores/locations';
import {sendRPC} from '@/tools/websocket';
import TariffAssignmentEditor from './TariffAssignmentEditor.vue';
import TariffAssignmentList from './TariffAssignmentList.vue';
import TariffAssignmentRemoval from './TariffAssignmentRemoval.vue';
import TariffCoverageCheck from './TariffCoverageCheck.vue';
import {
    type Assignment,
    type Commodity,
    DIRECTIONS,
    type Direction,
    deviceName,
    type Tariff,
    titleCase
} from './tariffAssignmentView';

// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const auth = useAuthStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const deviceStore = useDevicesStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const locationStore = useLocationsStore();
const canWrite = computed(() => auth.canPerformComponent('reports', 'update'));

const tariffs = ref<Tariff[]>([]);
const assignments = ref<Assignment[]>([]);
const loading = ref(true);
const loadError = ref('');
const showEditor = ref(false);
const removalRow = ref<Assignment | null>(null);
const direction = ref<Direction>('import');
const commodity = ref<Commodity>('electricity');

async function load(): Promise<void> {
    loading.value = true;
    loadError.value = '';
    try {
        const [tariffResult, assignmentResult] = await Promise.all([
            sendRPC('FLEET_MANAGER', 'tariff.list', {}) as Promise<
                HostResult<'tariff.list'>
            >,
            sendRPC('FLEET_MANAGER', 'tariff.listassignments', {}) as Promise<
                HostResult<'tariff.listassignments'>
            >
        ]);
        tariffs.value = tariffResult.items ?? [];
        assignments.value = assignmentResult.items ?? [];
    } catch (error) {
        loadError.value = rpcErrorMessage(error, 'Request failed');
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    void Promise.all([
        load(),
        deviceStore.fetchDevices(),
        locationStore.fetchLocations()
    ]);
});

const locations = computed(() =>
    Object.values(locationStore.locations).sort((a, b) =>
        a.name.localeCompare(b.name)
    )
);
const devices = computed(() =>
    Object.values(deviceStore.devices).sort((a, b) =>
        deviceName(a).localeCompare(deviceName(b))
    )
);

const commodities = computed<Commodity[]>(() => {
    const values = [...new Set(tariffs.value.map((tariff) => tariff.commodity))];
    return values.length > 0 ? values : ['electricity'];
});
const filteredAssignments = computed(() =>
    assignments.value.filter(
        (assignment) =>
            assignment.direction === direction.value &&
            assignment.commodity === commodity.value
    )
);

watch(commodities, (values) => {
    if (!values.includes(commodity.value)) commodity.value = values[0];
});

function toggleEditor(): void {
    showEditor.value = !showEditor.value;
}

function onAssignmentSaved(): void {
    showEditor.value = false;
    void load();
}

function onAssignmentRemoved(): void {
    removalRow.value = null;
    void load();
}
</script>
