<template>
    <SteppedModal
        v-model:stage="stage"
        v-model:visible="visible"
        :max-steps="3"
        :requires-write="true"
        @save="onSave"
    >
        <template #title> Edit group </template>

        <template #stepTitle="{ stage }">
            <span v-if="stage == 1">Main</span>
            <span v-if="stage == 2">Metadata</span>
            <span v-if="stage == 3">Select devices</span>
        </template>

        <template #default="{ stage }">
            <div v-if="stage == 1" class="p-2">
                <FormField label="Room name" :error="nameError">
                    <Input v-model="newName" placeholder="Enter room name" @blur="validateName" />
                </FormField>
            </div>

            <div v-if="stage == 2" class="p-2 flex flex-col gap-3">
                <div class="text-sm edit-group-description">
                    Metadata (key/value). Add as many rows as you want.
                </div>

                <div class="flex flex-col gap-2">
                    <div
                        v-for="(row, idx) in metadataRows"
                        :key="idx"
                        class="flex flex-row gap-2 items-start"
                    >
                        <input
                            v-model="row.key"
                            class="edit-group-input w-[40%] rounded-md px-3 py-2 text-sm outline-none focus:ring-2"
                            placeholder="Key"
                            aria-label="Metadata key"
                        />
                        <input
                            v-model="row.value"
                            class="edit-group-input w-[60%] rounded-md px-3 py-2 text-sm outline-none focus:ring-2"
                            placeholder="Value"
                            aria-label="Metadata value"
                        />
                        <button
                            class="edit-group-remove-btn h-10 w-10 rounded-md flex items-center justify-center"
                            title="Remove"
                            @click="removeMetadataRow(idx)"
                        >
                            <i class="fas fa-trash edit-group-remove-icon"></i>
                        </button>
                    </div>
                </div>

                <div class="flex flex-row gap-2">
                    <button
                        class="edit-group-btn-primary px-3 py-2 rounded-md text-sm"
                        @click="addMetadataRow"
                    >
                        Add field
                    </button>
                    <button
                        class="edit-group-btn-danger px-3 py-2 rounded-md text-sm"
                        @click="clearMetadataRows"
                    >
                        Clear
                    </button>
                </div>

                <p v-if="metadataError" class="text-sm edit-group-error">
                    {{ metadataError }}
                </p>
            </div>

            <div v-if="stage == 3" class="p-2">
                <DeviceSelector v-model="selected"> </DeviceSelector>
            </div>
        </template>
    </SteppedModal>
</template>

<script setup lang="ts">
import {ref, watch} from 'vue';
import DeviceSelector from '@/components/DeviceSelector.vue';
import SteppedModal from '@/components/modals/SteppedModal.vue';
import FormField from '../core/FormField.vue';
import Input from '../core/Input.vue';

const visible = defineModel<boolean>({required: true});

const emit = defineEmits<{
    save: [string, string[], Record<string, any>];
}>();

const props = defineProps<{
    name: string;
    devices: string[];
    metadata?: Record<string, any>;
}>();

const stage = ref(1);

const newName = ref(props.name);
const selected = ref<string[]>(
    Array.isArray(props.devices) ? [...props.devices] : []
);

type MetadataRow = {key: string; value: string};
const nameError = ref('');

function validateName() {
    nameError.value = !newName.value.trim() ? 'Room name is required' : '';
}

const metadataRows = ref<MetadataRow[]>(objectToRows(props.metadata));
const metadataError = ref<string>('');

function objectToRows(obj: Record<string, any> | undefined): MetadataRow[] {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return [{key: '', value: ''}];
    }

    // Clone entries so reactive proxies don't bite us
    const entries = Object.entries(obj).map(
        ([k, v]) => [String(k), v == null ? '' : String(v)] as const
    );

    if (entries.length === 0) return [{key: '', value: ''}];

    return entries.map(([k, v]) => ({key: k, value: v}));
}

watch(
    () => visible.value,
    (isOpen) => {
        if (!isOpen) return;

        stage.value = 1;
        newName.value = props.name;
        selected.value = Array.isArray(props.devices) ? [...props.devices] : [];
        metadataRows.value = objectToRows(props.metadata);
        metadataError.value = '';
        nameError.value = '';
    }
);

function addMetadataRow() {
    metadataRows.value.push({key: '', value: ''});
}

function removeMetadataRow(idx: number) {
    metadataRows.value.splice(idx, 1);
    if (metadataRows.value.length === 0) {
        metadataRows.value.push({key: '', value: ''});
    }
}

function clearMetadataRows() {
    metadataRows.value = [{key: '', value: ''}];
}

function buildMetadataOrThrow(rows: MetadataRow[]): Record<string, any> {
    const out: Record<string, any> = {};
    const seen = new Set<string>();

    for (const r of rows) {
        const key = (r.key ?? '').trim();
        const value = (r.value ?? '').trim();

        if (!key && !value) continue;

        if (!key) {
            throw new Error(
                'Metadata key cannot be empty (remove the row or fill the key).'
            );
        }
        if (seen.has(key)) {
            throw new Error(`Duplicate metadata key: '${key}'.`);
        }
        seen.add(key);

        out[key] = value;
    }

    return out;
}

function onSave() {
    validateName();
    if (nameError.value) {
        stage.value = 1;
        return;
    }
    metadataError.value = '';
    let meta: Record<string, any> = {};

    try {
        meta = buildMetadataOrThrow(metadataRows.value);
    } catch (e: any) {
        metadataError.value = e?.message ?? 'Invalid metadata.';
        stage.value = 2;
        return;
    }

    emit('save', newName.value, selected.value, meta);
}
</script>

<style scoped>
.edit-group-description {
    color: var(--color-text-secondary);
}

.edit-group-input {
    background-color: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-primary);
}

.edit-group-input:focus {
    --tw-ring-color: var(--color-primary);
}

.edit-group-remove-btn {
    background-color: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
}

.edit-group-remove-btn:hover {
    background-color: var(--color-surface-2);
}

.edit-group-remove-icon {
    color: var(--color-danger-text);
}

.edit-group-btn-primary {
    background-color: var(--color-primary);
    color: var(--color-text-inverse);
}

.edit-group-btn-primary:hover {
    background-color: var(--color-primary-hover);
}

.edit-group-btn-danger {
    background-color: var(--color-danger);
    color: var(--color-text-inverse);
}

.edit-group-btn-danger:hover {
    background-color: var(--color-danger-hover);
}

.edit-group-error {
    color: var(--color-danger-text);
}
</style>
