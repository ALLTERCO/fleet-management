<template>
    <div class="bis">
        <div class="bis__intro">
            <h4 class="bis__heading">Confirm what's paired</h4>
            <p class="bis__subheading">
                Rename a sensor before you finish. Location and group can be
                set per device from its detail page.
            </p>
        </div>

        <div v-if="loading" class="bis__state">
            <Spinner size="md" /> <span>Loading paired sensors…</span>
        </div>

        <div v-else-if="listError" class="bis__state bis__state--error">
            <i class="fas fa-triangle-exclamation" aria-hidden="true" />
            <span>{{ listError }}</span>
            <Button type="blue-hollow" size="sm" @click="loadCandidates">Retry</Button>
        </div>

        <div
            v-else-if="!paired.length"
            class="bis__state bis__state--empty"
        >
            <i class="fas fa-circle-info" aria-hidden="true" />
            <span>No sensors paired through this gateway yet.</span>
        </div>

        <ul v-else class="bis__list">
            <li
                v-for="dev in paired"
                :key="dev.id"
                class="bis__row"
                :data-id="dev.id"
            >
                <div class="bis__row-head">
                    <i class="fab fa-bluetooth-b bis__bt" aria-hidden="true" />
                    <div class="bis__row-meta">
                        <Input
                            :model-value="editingNames[dev.id] ?? dev.displayName"
                            placeholder="Sensor name"
                            @update:model-value="(v: string | number) => onNameInput(dev.id, String(v))"
                        />
                        <span class="bis__row-addr">{{ dev.addr }}</span>
                    </div>
                    <Button
                        v-if="isDirty(dev)"
                        type="blue"
                        size="sm"
                        :loading="savingId === dev.id"
                        @click="saveName(dev)"
                    >
                        Save
                    </Button>
                    <Button
                        v-if="dev.alreadyPromoted"
                        type="green"
                        size="sm"
                        disabled
                    >
                        Added
                    </Button>
                    <Button
                        v-else
                        type="green"
                        size="sm"
                        :loading="promotingKey === dev.componentKey"
                        @click="promote(dev)"
                    >
                        Add
                    </Button>
                </div>
                <div v-if="errors[dev.id]" class="bis__row-error">
                    {{ errors[dev.id] }}
                </div>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import {
    type BluetoothCandidate,
    bluetoothDevices
} from '@host/bluetoothDevices';
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import Spinner from '@/components/core/Spinner.vue';

interface PairedRow {
    id: number;
    componentKey: string;
    addr: string;
    name: string | null;
    displayName: string;
    alreadyPromoted: boolean;
    bluetoothExternalId: string | null;
}

const props = defineProps<{gatewayId: string | null}>();
const emit = defineEmits<{created: [externalId: string]}>();

const candidates = ref<BluetoothCandidate[]>([]);
const editingNames = ref<Record<number, string>>({});
const savingId = ref<number | null>(null);
const promotingKey = ref<string | null>(null);
const errors = ref<Record<number, string>>({});
const loading = ref(false);
const listError = ref<string | null>(null);

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
        await loadCandidates();
    } catch (err) {
        errors.value = {
            ...errors.value,
            [row.id]: err instanceof Error ? err.message : String(err)
        };
    } finally {
        savingId.value = null;
    }
}

async function promote(row: PairedRow): Promise<void> {
    if (!props.gatewayId || row.alreadyPromoted) return;
    promotingKey.value = row.componentKey;
    clearRowError(row.id);
    try {
        const device = await bluetoothDevices.promoteFromGateway({
            gatewayExternalId: props.gatewayId,
            componentKey: row.componentKey,
            makePrimary: true
        });
        emit('created', device.externalId);
    } catch (err) {
        errors.value = {
            ...errors.value,
            [row.id]: err instanceof Error ? err.message : String(err)
        };
    } finally {
        promotingKey.value = null;
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
        const res = await bluetoothDevices.listCandidates({
            gatewayExternalId: props.gatewayId,
            limit: 200
        });
        candidates.value = res.items ?? [];
    } catch (err) {
        listError.value = err instanceof Error ? err.message : String(err);
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

watch(() => props.gatewayId, loadCandidates, {immediate: true});
</script>

<style scoped>
.bis {
    display: grid;
    gap: var(--gap-lg);
}
.bis__intro {
    display: grid;
    gap: 6px;
}
.bis__eyebrow {
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    color: var(--brand-light);
    font-weight: var(--font-semibold);
}
.bis__heading {
    margin: 0;
    font-size: var(--type-display);
    line-height: var(--leading-tight);
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
}
.bis__subheading {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    max-width: 56ch;
}
.bis__state {
    display: grid;
    place-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-xl);
    text-align: center;
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
    border: 1px dashed var(--color-border-subtle);
    border-radius: var(--radius-md);
    min-height: 180px;
}
.bis__state--error i {
    color: var(--color-warning-text);
    font-size: var(--type-subheading);
}
.bis__state--empty i {
    color: var(--brand-light);
    font-size: var(--type-subheading);
}
.bis__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--gap-sm);
}
.bis__row {
    padding: var(--gap-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}
.bis__row-head {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
}
.bis__bt {
    color: var(--brand-light);
    font-size: var(--type-body);
}
.bis__row-meta {
    flex: 1;
    display: grid;
    gap: 4px;
}
.bis__row-addr {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.bis__row-error {
    margin-top: var(--gap-xs);
    color: var(--color-danger-text);
    font-size: var(--type-caption);
}
</style>
