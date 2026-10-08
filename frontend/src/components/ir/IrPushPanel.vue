<template>
    <div class="irpp">
        <div v-if="!fixedShellyId" class="irpp__row">
            <Dropdown
                aria-label="Target IR device"
                :options="deviceLabels"
                placeholder="Choose an IR-capable device"
                @selected="onDeviceSelected"
            />
        </div>
        <div v-if="irCapableDevices.length === 0 && !fixedShellyId" class="irpp__empty">
            No IR-capable devices online in this fleet.
        </div>

        <div class="irpp__row">
            <Dropdown
                aria-label="Target mode"
                :options="TARGET_MODES"
                :default="targetMode"
                @selected="(mode: string) => (targetMode = mode)"
            />
            <Input
                v-if="targetMode === MODE_EXISTING"
                v-model="irDeviceIdText"
                type="number"
                placeholder="irdevice id (e.g. 200)"
                aria-label="Existing irdevice id"
            />
            <Input
                v-else
                v-model="createName"
                placeholder="New IR device name"
                aria-label="New IR device name"
            />
        </div>

        <div class="irpp__actions">
            <Button
                type="blue"
                size="sm"
                :disabled="!canPush"
                :loading="pushing"
                @click="push"
                >Push {{ entryIds.length }}
                {{ entryIds.length === 1 ? 'code' : 'codes' }}</Button
            >
        </div>
        <div class="irpp__note">
            Preview firmware: the on-device code format is not final. Codes
            are sent as stored; verify on the device after pushing.
        </div>

        <ul v-if="result" class="irpp__results">
            <li v-if="result.createdDevice" class="irpp__result">
                Created IR device #{{ result.irDeviceId }}
            </li>
            <li
                v-for="r in result.results"
                :key="r.entryId"
                class="irpp__result"
                :class="r.ok ? 'irpp__result--ok' : 'irpp__result--fail'"
            >
                <i
                    class="fas"
                    :class="r.ok ? 'fa-check' : 'fa-triangle-exclamation'"
                    aria-hidden="true"
                />
                {{ entryName(r.entryId) }}
                <template v-if="!r.ok">: {{ r.error }}</template>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import Input from '@/components/core/Input.vue';
import {useDevicesStore} from '@/stores/devices';
import {type IrPushResult, useIrLibraryStore} from '@/stores/irLibrary';

const props = defineProps<{
    entryIds: number[];
    /** Locks the push target to one device (device-board context). */
    fixedShellyId?: string;
}>();

const MODE_EXISTING = 'Existing IR device';
const MODE_CREATE = 'Create new IR device';
const TARGET_MODES = [MODE_EXISTING, MODE_CREATE];

const deviceStore = useDevicesStore();
const irStore = useIrLibraryStore();

const selectedShellyId = ref('');
const targetMode = ref(MODE_CREATE);
const irDeviceIdText = ref('');
const createName = ref('');
const pushing = ref(false);
const result = ref<IrPushResult | null>(null);

const irCapableDevices = computed(() =>
    Object.values(deviceStore.devices).filter(
        (d) => !!(d as {capabilities?: {ir?: boolean}}).capabilities?.ir
    )
);

const deviceLabels = computed(() =>
    irCapableDevices.value.map(
        (d) => `${d.info?.name ?? d.shellyID} (${d.shellyID})`
    )
);

function onDeviceSelected(_label: string, index: number): void {
    selectedShellyId.value = irCapableDevices.value[index]?.shellyID ?? '';
}

const targetShellyId = computed(
    () => props.fixedShellyId ?? selectedShellyId.value
);

const canPush = computed(() => {
    if (props.entryIds.length === 0 || !targetShellyId.value) return false;
    if (targetMode.value === MODE_EXISTING) {
        return /^\d+$/.test(irDeviceIdText.value.trim());
    }
    return createName.value.trim().length > 0;
});

function entryName(entryId: number): string {
    return irStore.entries[entryId]?.name ?? `entry ${entryId}`;
}

async function push(): Promise<void> {
    pushing.value = true;
    result.value = null;
    try {
        result.value = await irStore.pushToDevice({
            shellyID: targetShellyId.value,
            entryIds: [...props.entryIds],
            ...(targetMode.value === MODE_EXISTING
                ? {irDeviceId: Number(irDeviceIdText.value.trim())}
                : {createDeviceName: createName.value.trim()})
        });
    } finally {
        pushing.value = false;
    }
}
</script>

<style scoped>
.irpp {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.irpp__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.irpp__empty {
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}
.irpp__actions {
    display: flex;
    gap: var(--space-2);
}
.irpp__note {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.irpp__results {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
}
.irpp__result {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-3);
    border-radius: var(--radius-sm);
    font-size: var(--type-caption);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
}
.irpp__result--ok i {
    color: var(--color-success-text);
}
.irpp__result--fail i {
    color: var(--color-danger-text);
}
</style>
