<template>
    <Modal :visible="visible" @close="emit('close')">
        <template #title>Edit Firmware Metadata</template>

        <div class="fw-edit">
            <div class="fw-edit__row">
                <FormField label="Name">
                    <Input v-model="form.name" placeholder="Display name" />
                </FormField>
                <FormField label="Tags" optional>
                    <Input v-model="form.tags" placeholder="comma separated" />
                </FormField>
            </div>
            <div class="fw-edit__row">
                <FormField label="Model" optional>
                    <Input v-model="form.model" placeholder="e.g. SHSW-25" />
                </FormField>
                <FormField label="Version" optional>
                    <Input v-model="form.version" placeholder="e.g. 1.4.3" />
                </FormField>
            </div>
            <div class="fw-edit__row">
                <FormField label="App" optional>
                    <Input v-model="form.app" placeholder="e.g. Plus1" />
                </FormField>
                <FormField label="Channel" optional>
                    <select v-model="form.channel" class="fw-edit__select" aria-label="Channel">
                        <option value="">—</option>
                        <option value="stable">Stable</option>
                        <option value="beta">Beta</option>
                        <option value="custom">Custom</option>
                    </select>
                </FormField>
            </div>
            <div class="fw-edit__info">
                <span>{{ item?.originalFileName }}</span>
                <span>{{ item ? formatBytes(item.fileSize) : '' }}</span>
                <span>{{ item?.checksum?.slice(0, 12) }}...</span>
            </div>
        </div>

        <template #footer>
            <div class="flex justify-end gap-2">
                <Button type="blue-hollow" size="sm" @click="emit('close')">Cancel</Button>
                <Button type="green" size="sm" @click="handleSave">
                    Save
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {reactive, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import Modal from '@/components/modals/Modal.vue';
import {formatBytes} from '@/helpers/format';
import type {FirmwareLibraryItem} from './FirmwareLibraryModal.vue';

const props = defineProps<{
    visible: boolean;
    item: FirmwareLibraryItem | null;
}>();

const emit = defineEmits<{
    close: [];
    save: [item: FirmwareLibraryItem, updates: Record<string, string>];
}>();

const form = reactive({
    name: '',
    model: '',
    app: '',
    version: '',
    channel: '',
    tags: ''
});

watch(
    () => props.visible,
    (vis) => {
        if (vis && props.item) {
            form.name = props.item.name || '';
            form.model = props.item.model || '';
            form.app = props.item.app || '';
            form.version = props.item.ver || '';
            form.channel = props.item.channel || '';
            form.tags = props.item.tags?.join(', ') || '';
        }
    }
);


function handleSave() {
    if (!props.item) return;
    const updates: Record<string, string> = {};
    if (form.name !== (props.item.name || '')) updates.name = form.name;
    if (form.model !== (props.item.model || '')) updates.model = form.model;
    if (form.app !== (props.item.app || '')) updates.app = form.app;
    if (form.version !== (props.item.ver || '')) updates.ver = form.version;
    if (form.channel !== (props.item.channel || ''))
        updates.channel = form.channel;
    if (form.tags !== (props.item.tags?.join(', ') || ''))
        updates.tags = form.tags;
    emit('save', props.item, updates);
}
</script>

<style scoped>
:deep(.form-field__label) {
    margin-bottom: var(--space-2);
}

.fw-edit {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.fw-edit__row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
}
.fw-edit__select {
    width: 100%;
    min-height: var(--touch-target-min);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--btn-radius);
    background: var(--color-surface-3);
    color: var(--color-text-primary);
    padding: 0 var(--space-3);
    font-size: var(--type-body);
    font-family: inherit;
}
.fw-edit__select:focus {
    outline: none;
    border-color: var(--color-border-focus);
}
.fw-edit__info {
    display: flex;
    gap: var(--space-3);
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    font-family: var(--font-mono);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border-medium);
}
</style>
