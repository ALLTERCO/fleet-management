<template>
    <WizardStep
        name="identify"
        lede="Rename now if you like. Location and group are set later, on the device page."
    >
        <PickRowSkeleton v-if="loading" label="Loading paired sensors" />

        <WizardState v-else-if="listError" tone="error">
            {{ listError }}
            <template #action>
                <Button type="blue-hollow" size="sm" @click="loadCandidates">
                    Retry
                </Button>
            </template>
        </WizardState>

        <WizardState
            v-else-if="!paired.length"
            tone="empty"
            icon="fab fa-bluetooth-b"
        >
            No sensors paired through this gateway yet.
        </WizardState>

        <ul v-else class="stack-list">
            <li v-for="dev in paired" :key="dev.id" :data-id="dev.id">
                <PickRow
                    :interactive="false"
                    :selected="dev.alreadyPromoted"
                    control
                >
                    <template #lead>
                        <i class="fab fa-bluetooth-b" aria-hidden="true" />
                    </template>

                    <Input
                        :model-value="editingNames[dev.id] ?? dev.displayName"
                        label="Sensor name"
                        label-hidden
                        placeholder="Sensor name"
                        @update:model-value="
                            (v: string | number) => onNameInput(dev.id, String(v))
                        "
                    />

                    <template #meta>
                        <span class="mono-id">{{ dev.addr }}</span>
                    </template>

                    <template #trail>
                        <Button
                            v-if="isDirty(dev)"
                            type="blue-hollow"
                            size="sm"
                            :loading="savingId === dev.id"
                            @click="saveName(dev)"
                        >
                            Save name
                        </Button>
                        <span v-if="dev.alreadyPromoted" class="meta-pill meta-pill--success">
                            <i class="fas fa-check" aria-hidden="true" />
                            Added
                        </span>
                        <!-- Only before it becomes a fleet device: unpairing a
                             promoted one would orphan the device. -->
                        <Button
                            v-if="!dev.alreadyPromoted"
                            type="red"
                            size="sm"
                            :loading="unpairingId === dev.id"
                            title="Remove this sensor from the gateway"
                            @click="unpair(dev)"
                        >
                            Unpair
                        </Button>
                        <Button
                            v-if="!dev.alreadyPromoted"
                            type="green"
                            size="sm"
                            :disabled="!canPromote"
                            :title="
                                canPromote
                                    ? 'Add as a fleet device'
                                    : 'Device create permission is required'
                            "
                            :loading="promotingKey === dev.componentKey"
                            @click="promote(dev)"
                        >
                            Add
                        </Button>
                    </template>
                </PickRow>

                <WizardState v-if="errors[dev.id]" tone="error" class="bis__row-error">
                    {{ errors[dev.id] }}
                </WizardState>
            </li>
        </ul>
    </WizardStep>
</template>

<script setup lang="ts">
import {
    type BluetoothCandidate,
    bluetoothDevices
} from '@host/bluetoothDevices';
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import PickRow from '@/components/core/wizard/PickRow.vue';
import PickRowSkeleton from '@/components/core/wizard/PickRowSkeleton.vue';
import WizardState from '@/components/core/wizard/WizardState.vue';
import WizardStep from '@/components/core/wizard/WizardStep.vue';
import {useDeviceSettingsSettled} from '@/composables/useDeviceSettingsSettled';
import {actionableError} from '@/helpers/rpcError';
import {useAuthStore} from '@/stores/auth';

interface PairedRow {
    id: number;
    componentKey: string;
    addr: string;
    name: string | null;
    displayName: string;
    alreadyPromoted: boolean;
    bluetoothExternalId: string | null;
}

const props = defineProps<{gatewayId: string | null; reloadKey?: number}>();
const emit = defineEmits<{created: [externalId: string, name: string]}>();

// One request's worth, not a ceiling on what a gateway may hold.
const CANDIDATE_PAGE_SIZE = 200;

const candidates = ref<BluetoothCandidate[]>([]);
const editingNames = ref<Record<number, string>>({});
const savingId = ref<number | null>(null);
const promotingKey = ref<string | null>(null);
const unpairingId = ref<number | null>(null);
const errors = ref<Record<number, string>>({});
const loading = ref(false);
const listError = ref<string | null>(null);
const authStore = useAuthStore();
const {whenSettled} = useDeviceSettingsSettled();
const canPromote = computed(
    () =>
        authStore.hasComponentPermission('devices', 'create') &&
        !!props.gatewayId &&
        authStore.canPerformComponent('devices', 'read', props.gatewayId)
);

const paired = computed<PairedRow[]>(() => {
    return candidates.value.map(candidateToRow).sort((a, b) => a.id - b.id);
});

function onNameInput(id: number, value: string): void {
    editingNames.value = {...editingNames.value, [id]: value};
}

function isDirty(row: PairedRow): boolean {
    const draft = editingNames.value[row.id];
    return (
        draft !== undefined &&
        draft.trim() !== '' &&
        draft !== row.displayName
    );
}

async function saveName(row: PairedRow): Promise<void> {
    if (!props.gatewayId) return;
    const next = editingNames.value[row.id]?.trim();
    if (!next || next === row.displayName) return;
    savingId.value = row.id;
    errors.value = {...errors.value, [row.id]: ''};
    try {
        await bluetoothDevices.renameGatewayChild({
            shellyID: props.gatewayId,
            id: row.id,
            name: next
        });
        const {[row.id]: _drop, ...rest} = editingNames.value;
        editingNames.value = rest;
        // The candidate list reads the persisted snapshot, so reloading before
        // the gateway reports back re-reads the old name and the rename looks
        // like it failed.
        await whenSettled(props.gatewayId);
        await loadCandidates();
    } catch (err) {
        errors.value = {
            ...errors.value,
            [row.id]: actionableError(
                err,
                'Could not rename this sensor. Check the gateway is online, then try again.'
            )
        };
    } finally {
        savingId.value = null;
    }
}

async function promote(row: PairedRow): Promise<void> {
    if (!props.gatewayId || row.alreadyPromoted || !canPromote.value) return;

    // Commit a pending rename first. Without this the draft is thrown away by
    // the reload that follows, and the device is added under its old name.
    if (isDirty(row)) {
        await saveName(row);
        if (errors.value[row.id]) return;
        const renamed = paired.value.find(
            (c) => c.componentKey === row.componentKey
        );
        if (renamed) row = renamed;
    }

    promotingKey.value = row.componentKey;
    clearRowError(row.id);
    try {
        const device = await bluetoothDevices.promoteFromGateway({
            gatewayExternalId: props.gatewayId,
            componentKey: row.componentKey,
            makePrimary: true
        });
        candidates.value = candidates.value.map((candidate) =>
            candidate.componentKey === row.componentKey
                ? {
                      ...candidate,
                      alreadyPromoted: true,
                      bluetoothExternalId: device.externalId
                  }
                : candidate
        );
        emit('created', device.externalId, row.displayName);
    } catch (err) {
        errors.value = {
            ...errors.value,
            [row.id]: actionableError(
                err,
                'Could not add this sensor. Check the gateway is online, then try again.'
            )
        };
    } finally {
        promotingKey.value = null;
    }
}

/** Takes the pairing back out of the gateway's config. The wizard wrote it
 *  there, so the wizard offers the way back. */
async function unpair(row: PairedRow): Promise<void> {
    if (!props.gatewayId || row.alreadyPromoted) return;
    unpairingId.value = row.id;
    clearRowError(row.id);
    try {
        await bluetoothDevices.removeGatewayChild({
            shellyID: props.gatewayId,
            id: row.id
        });
        candidates.value = candidates.value.filter(
            (candidate) => candidate.componentKey !== row.componentKey
        );
    } catch (err) {
        errors.value = {
            ...errors.value,
            [row.id]: actionableError(
                err,
                'Could not unpair this sensor. Check the gateway is online, then try again.'
            )
        };
    } finally {
        unpairingId.value = null;
    }
}

/** How many children a gateway can hold is the device's business, so never
 *  assume one page covers it. Follow has_more; the backend's own total bounds
 *  the loop, and a page that returns nothing ends it. */
async function fetchEveryCandidate(
    gatewayExternalId: string
): Promise<BluetoothCandidate[]> {
    const all: BluetoothCandidate[] = [];
    let offset = 0;
    for (;;) {
        const page = await bluetoothDevices.listCandidates({
            gatewayExternalId,
            limit: CANDIDATE_PAGE_SIZE,
            offset
        });
        const items = page.items ?? [];
        all.push(...items);
        offset += items.length;
        if (!page.has_more || items.length === 0) return all;
    }
}

async function loadCandidates(): Promise<void> {
    if (!props.gatewayId) {
        candidates.value = [];
        return;
    }
    loading.value = true;
    listError.value = null;
    try {
        candidates.value = await fetchEveryCandidate(props.gatewayId);
    } catch (err) {
        listError.value = actionableError(
            err,
            'Could not load the sensors paired to this gateway. Retry when it is back online.'
        );
        candidates.value = [];
    } finally {
        loading.value = false;
    }
}

function clearRowError(id: number): void {
    if (!errors.value[id]) return;
    const {[id]: _drop, ...rest} = errors.value;
    errors.value = rest;
}

function candidateToRow(candidate: BluetoothCandidate): PairedRow {
    const id = componentId(candidate.componentKey);
    const name = candidate.name ?? null;
    return {
        id,
        componentKey: candidate.componentKey,
        addr: candidate.bleAddress,
        name,
        displayName:
            name ?? candidate.productName ?? candidate.modelId ?? candidate.bleAddress,
        alreadyPromoted: candidate.alreadyPromoted,
        bluetoothExternalId: candidate.bluetoothExternalId
    };
}

function componentId(componentKey: string): number {
    const id = Number.parseInt(componentKey.split(':')[1] ?? '', 10);
    return Number.isFinite(id) ? id : 0;
}

// reloadKey advances every time the pair step pairs something. Without it the
// KeepAlive-cached list still shows what was paired before this run.
watch(
    () => [props.gatewayId, props.reloadKey],
    loadCandidates,
    {immediate: true}
);
</script>

<style scoped>


.bis__row-error {
    margin-top: var(--gap-xs);
    font-size: var(--type-caption);
}

/* Already added is a state, not an action — it never looks pressable. */
</style>
