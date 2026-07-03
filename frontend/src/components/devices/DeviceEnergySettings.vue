<template>
    <div class="des">
        <p v-if="loading" class="des-muted">Loading energy points…</p>
        <p v-else-if="error" class="des-error">{{ error }}</p>
        <p v-else-if="points.length === 0" class="des-muted">
            No unassigned energy points found.
        </p>

        <template v-else>
            <div class="des-field">
                <span class="des-label">Detected points</span>
                <label
                        v-for="point in points"
                    :key="energyPointKey(point)"
                    class="des-point"
                >
                    <input
                        type="checkbox"
                        :checked="selected.has(energyPointKey(point))"
                        @change="toggle(point)"
                    />
                    <span>{{ energyPointLabel(point) }}</span>
                    <span class="des-tag">{{ energyTagLabel(point.tag) }}</span>
                </label>
            </div>

            <div class="des-grid">
                <label class="des-field">
                    <span class="des-label">Utility</span>
                    <select v-model="utilityType" class="des-input">
                        <option value="electric">Electric</option>
                        <option value="gas">Gas</option>
                        <option value="water">Water</option>
                        <option value="heat">Heat</option>
                    </select>
                </label>

                <label class="des-field">
                    <span class="des-label">Measures</span>
                    <select v-model="role" class="des-input">
                        <option value="">Choose…</option>
                        <option
                            v-for="option in roleOptions"
                            :key="option.role"
                            :value="option.role"
                        >
                            {{ option.label }}
                        </option>
                    </select>
                </label>

                <label class="des-field">
                    <span class="des-label">Name</span>
                    <input
                        v-model="name"
                        class="des-input"
                        placeholder="Main meter"
                    />
                </label>

                <label class="des-field">
                    <span class="des-label">Kind</span>
                    <select v-model="kindId" class="des-input">
                        <option value="">No kind</option>
                        <option
                            v-for="kind in kindOptions"
                            :key="kind.id"
                            :value="kind.id"
                        >
                            {{ kind.name }}
                        </option>
                    </select>
                </label>

                <label class="des-field">
                    <span class="des-label">Group</span>
                    <select v-model="groupId" class="des-input">
                        <option value="">No group</option>
                        <option
                            v-for="group in groupOptions"
                            :key="group.id"
                            :value="String(group.id)"
                        >
                            {{ group.name }}
                        </option>
                    </select>
                </label>

                <label class="des-field">
                    <span class="des-label">Location</span>
                    <select v-model="locationId" class="des-input">
                        <option value="">No location</option>
                        <option
                            v-for="location in locationOptions"
                            :key="location.id"
                            :value="String(location.id)"
                        >
                            {{ location.name }}
                        </option>
                    </select>
                </label>

                <label v-if="parentOptions.length > 0" class="des-field">
                    <span class="des-label">Upstream meter</span>
                    <select v-model="parentMeterId" class="des-input">
                        <option value="">No parent</option>
                        <option
                            v-for="meter in parentOptions"
                            :key="meter.id"
                            :value="String(meter.id)"
                        >
                            {{ meter.name }}
                        </option>
                    </select>
                </label>
            </div>

            <Button
                type="blue"
                size="sm"
                :loading="saving"
                :disabled="!canSave"
                @click="save"
            >
                Save energy assignment
            </Button>
        </template>
    </div>
</template>

<script setup lang="ts">
import type {
    EnergyLogicalMeter,
    EnergyMeasurementPoint,
    EnergyMeterRole,
    EnergyUtilityType
} from '@api/energy';
import type {Location as ApiLocation} from '@api/location';
import {storeToRefs} from 'pinia';
import {computed, ref, watch} from 'vue';
import {type KindEntry, listKinds } from '@/api/kindRpc';
import Button from '@/components/core/Button.vue';
import {
    deriveEnergyPhaseMode,
    energyPointKey,
    energyPointLabel,
    energyRolesForUtility,
    energyTagLabel,
    optionalNumber,
    optionalString,
    toLogicalMeterPoint
} from '@/helpers/energyAssignment';
import {type StoreGroup, useGroupsStore } from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {
    listLogicalMeters,
    listMeasurementPoints,
    saveLogicalMeter
} from '@/tools/logicalMeters';

const props = defineProps<{
    shellyID: string;
    deviceName: string;
}>();

const groupsStore = useGroupsStore();
const locationsStore = useLocationsStore();
const {groups} = storeToRefs(groupsStore);
const {locations} = storeToRefs(locationsStore);

const points = ref<EnergyMeasurementPoint[]>([]);
const meters = ref<EnergyLogicalMeter[]>([]);
const kinds = ref<KindEntry[]>([]);
const selected = ref<Set<string>>(new Set());
const utilityType = ref<EnergyUtilityType>('electric');
const role = ref<EnergyMeterRole | ''>('');
const name = ref('');
const kindId = ref('');
const groupId = ref('');
const locationId = ref('');
const parentMeterId = ref('');
const loading = ref(false);
const saving = ref(false);
const error = ref('');

const canSave = computed(
    () => role.value !== '' && name.value.trim() !== '' && selected.value.size > 0
);
const roleOptions = computed(() => energyRolesForUtility(utilityType.value));
const kindOptions = computed(() =>
    [...kinds.value].sort((a, b) => a.name.localeCompare(b.name))
);
const groupOptions = computed<StoreGroup[]>(() =>
    Object.values(groups.value).sort((a, b) => a.name.localeCompare(b.name))
);
const locationOptions = computed<ApiLocation[]>(() =>
    Object.values(locations.value).sort((a, b) => a.name.localeCompare(b.name))
);
const parentOptions = computed(() =>
    meters.value
        .filter((meter) => meter.aggregationMode !== 'formula')
        .sort((a, b) => a.name.localeCompare(b.name))
);

function toggle(point: EnergyMeasurementPoint): void {
    const key = energyPointKey(point);
    const next = new Set(selected.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected.value = next;
}

async function load(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
        const [found, existingMeters, kindRows] = await Promise.all([
            listMeasurementPoints({
                shellyID: props.shellyID,
                includeAssigned: false
            }),
            listLogicalMeters(),
            listKinds('both'),
            groupsStore.fetchGroups(),
            locationsStore.fetchLocations()
        ]);
        points.value = found;
        meters.value = existingMeters;
        kinds.value = kindRows;
        selected.value = new Set(found.map(energyPointKey));
        if (name.value.trim() === '') name.value = props.deviceName;
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

async function save(): Promise<void> {
    if (!canSave.value || role.value === '') return;
    saving.value = true;
    error.value = '';
    try {
        const chosen = points.value.filter((point) =>
            selected.value.has(energyPointKey(point))
        );
        await saveLogicalMeter({
            name: name.value.trim(),
            utilityType: utilityType.value,
            role: role.value,
            kindId: optionalString(kindId.value),
            phaseMode: deriveEnergyPhaseMode(chosen),
            aggregationMode: 'sum_points',
            points: chosen.map(toLogicalMeterPoint),
            groupId: optionalNumber(groupId.value),
            locationId: optionalNumber(locationId.value),
            parentMeterId: optionalNumber(parentMeterId.value)
        });
        resetForm();
        await load();
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        saving.value = false;
    }
}

function resetForm(): void {
    utilityType.value = 'electric';
    role.value = '';
    name.value = props.deviceName;
    kindId.value = '';
    groupId.value = '';
    locationId.value = '';
    parentMeterId.value = '';
}

watch(
    () => props.shellyID,
    () => {
        resetForm();
        void load();
    },
    {immediate: true}
);

watch(utilityType, () => {
    const valid = roleOptions.value.some((option) => option.role === role.value);
    if (!valid) role.value = '';
});
</script>

<style scoped>
.des {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.des-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: var(--space-3);
}

.des-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.des-label {
    color: var(--color-text-secondary);
    font-size: 0.8rem;
    font-weight: 600;
}

.des-input {
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--glass-border, transparent);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-1);
    color: var(--color-text-primary);
}

.des-point {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-1);
    color: var(--color-text-primary);
}

.des-tag,
.des-muted {
    color: var(--color-text-secondary);
}

.des-error {
    color: var(--color-danger);
}
</style>
