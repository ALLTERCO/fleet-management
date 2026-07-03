<template>
    <Modal v-if="visible" :visible="true" @close="$emit('close')">
        <template #title>
            <h3>{{ title }}</h3>
        </template>
        <template #default>
            <IconPickerPanel
                :selected-glyph="selectedGlyph"
                :glyph-filter="glyphFilter"
                @pick-glyph="$emit('pick', $event)"
            />
        </template>
        <template v-if="$slots.footer || allowClear" #footer>
            <div class="ipm-footer">
                <button
                    v-if="allowClear && selectedGlyph"
                    type="button"
                    class="ipm-clear"
                    @click="$emit('pick', '')"
                >
                    Clear
                </button>
                <Button type="blue-hollow" @click="$emit('close')">Close</Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';
import IconPickerPanel from '@/components/core/IconPickerPanel.vue';
import Modal from '@/components/modals/Modal.vue';

withDefaults(
    defineProps<{
        visible: boolean;
        selectedGlyph?: string | null;
        glyphFilter?: (cls: string) => boolean;
        title?: string;
        allowClear?: boolean;
    }>(),
    {title: 'Pick an icon', allowClear: false}
);

defineEmits<{
    close: [];
    pick: [glyph: string];
}>();
</script>

<style scoped>
.ipm-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}
.ipm-clear {
    background: transparent;
    border: 1px solid var(--color-border-default);
    color: var(--color-text-tertiary);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--type-caption);
}
.ipm-clear:hover {
    border-color: var(--color-danger);
    color: var(--color-danger-text);
}
</style>
