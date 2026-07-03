<template>
    <div class="ldv">
        <header class="ldv__hdr">
            <h3 class="ldv__title">Devices in this {{ scopeLabel }}</h3>
            <span class="ldv__count">{{ deviceIds.length }}</span>
            <span class="ldv__spacer" />
            <Button
                v-if="canWrite"
                type="green"
                size="sm"
                title="Assign devices"
                aria-label="Assign devices"
                @click="openPicker"
            >
                <i class="fas fa-plus" aria-hidden="true" />
            </Button>
        </header>

        <ul v-if="deviceIds.length > 0" class="ldv__list">
            <li
                v-for="device in visibleDevices"
                :key="device.id"
                class="ldv__row"
                :class="{'ldv__row--offline': !device.online}"
            >
                <span class="ldv__row-name">{{ device.name }}</span>
                <span class="ldv__row-id">{{ device.id }}</span>
                <span class="ldv__row-state">
                    {{ device.online ? 'Online' : 'Offline' }}
                </span>
                <button
                    v-if="canWrite && device.removable"
                    type="button"
                    class="ldv__row-remove"
                    :title="`Unassign ${device.name}`"
                    @click="removeDevice(device.id)"
                >
                    <i class="fas fa-xmark" aria-hidden="true" />
                </button>
                <span v-else class="ldv__row-remove ldv__row-remove--placeholder" />
            </li>
        </ul>

        <p v-else class="ldv__empty">
            No devices assigned to this location or any of its descendants.
        </p>

        <Modal :visible="pickerVisible" wide @close="pickerVisible = false">
            <template #title>Assign devices to this {{ scopeLabel }}</template>
            <DeviceSelector v-model="pickedIds" />
            <template #footer>
                <div class="ldv__picker-foot">
                    <Button type="blue-hollow" @click="pickerVisible = false">
                        Cancel
                    </Button>
                    <span class="ldv__spacer" />
                    <Button
                        type="green"
                        :loading="assigning"
                        :disabled="pickedIds.length === 0"
                        :requires-write="true"
                        @click="assignPicked"
                    >
                        Assign {{ pickedIds.length || '' }}
                    </Button>
                </div>
            </template>
        </Modal>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import DeviceSelector from '@/components/core/DeviceSelector.vue';
import Modal from '@/components/modals/Modal.vue';
import {usePermissions} from '@/composables/usePermissions';
import {collectAssignedDevices} from '@/helpers/locationRollups';
import {useDevicesStore} from '@/stores/devices';
import {useLocationsStore} from '@/stores/locations';

const props = defineProps<{
    locationId: number;
    subtreeIds: readonly number[];
    scopeLabel: string;
}>();

const locations = useLocationsStore();
const devices = useDevicesStore();
const {canWrite} = usePermissions();

const deviceIds = computed<readonly string[]>(() =>
    collectAssignedDevices(props.subtreeIds, locations.assignmentsByLocation)
);

// Devices assigned directly to THIS location (not a descendant) — only these
// can be unassigned here.
const directlyAssignedIds = computed<Set<string>>(() => {
    const items = locations.assignmentsByLocation[props.locationId] ?? [];
    return new Set(
        items
            .filter((a) => a.subjectType === 'device')
            .map((a) => a.subjectId)
    );
});

interface DeviceRow {
    readonly id: string;
    readonly name: string;
    readonly online: boolean;
    readonly removable: boolean;
}

const visibleDevices = computed<DeviceRow[]>(() =>
    deviceIds.value.map((id) => buildDeviceRow(id))
);

function buildDeviceRow(id: string): DeviceRow {
    const device = devices.devices[id];
    return {
        id,
        name: device?.info?.name ?? id,
        online: device?.online === true,
        removable: directlyAssignedIds.value.has(id)
    };
}

// ── Assign picker ──
const pickerVisible = ref(false);
const pickedIds = ref<string[]>([]);
const assigning = ref(false);

function openPicker(): void {
    pickedIds.value = [];
    pickerVisible.value = true;
}

async function assignPicked(): Promise<void> {
    if (pickedIds.value.length === 0) return;
    assigning.value = true;
    try {
        await locations.assignDevices(pickedIds.value, props.locationId);
        pickerVisible.value = false;
        pickedIds.value = [];
    } finally {
        assigning.value = false;
    }
}

function removeDevice(id: string): void {
    void locations.removeAssignment('device', id);
}
</script>

<style scoped>
.ldv {
    padding: var(--space-5);
}

.ldv__hdr {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-border-default);
}

.ldv__title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    margin: 0;
}

.ldv__count {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
}

.ldv__spacer {
    flex: 1;
}

.ldv__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.ldv__row {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm-plus);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    align-items: center;
}

.ldv__row--offline .ldv__row-state {
    color: var(--color-status-off);
}

.ldv__row-name {
    font-size: var(--type-body);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ldv__row-id {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.ldv__row-state {
    font-size: var(--type-caption);
    color: var(--color-status-on);
    font-variant-numeric: tabular-nums;
}

.ldv__row-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: background var(--motion-state), color var(--motion-state);
}
.ldv__row-remove:hover {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
}
.ldv__row-remove--placeholder {
    cursor: default;
}

.ldv__empty {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-align: center;
    padding: var(--space-12) 0;
    margin: 0;
}

.ldv__picker-foot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
}
</style>
