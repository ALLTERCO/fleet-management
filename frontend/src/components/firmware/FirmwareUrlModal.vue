<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>Update from URL</template>

        <div class="flex flex-col" style="gap: var(--space-5)">
            <FormField label="Firmware URL">
                <Input v-model="url" placeholder="https://example.com/firmware.zip" />
            </FormField>
        </div>

        <template #footer>
            <div class="flex justify-end gap-2">
                <Button type="blue-hollow" size="sm" @click="emit('close')">Cancel</Button>
                <Button type="green" size="sm" :disabled="disabled || !url.trim()" @click="handleSubmit">
                    <i class="fas fa-link mr-1" /> Update from URL
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import Modal from '@/components/modals/Modal.vue';

const props = defineProps<{
    visible: boolean;
    disabled: boolean;
}>();

const emit = defineEmits<{
    close: [];
    submit: [url: string];
}>();

const url = ref('');

function handleSubmit() {
    const trimmed = url.value.trim();
    if (!trimmed) return;
    emit('submit', trimmed);
}

watch(
    () => props.visible,
    (isVisible) => {
        if (!isVisible) url.value = '';
    }
);
</script>

<style scoped>
:deep(.modal-body) {
    min-height: 30vh;
}
:deep(.form-field__label) {
    margin-bottom: var(--space-2);
}
</style>
