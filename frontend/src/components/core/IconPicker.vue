<template>
    <div>
        <button type="button" class="ip-trigger" @click="pickerOpen = true">
            <span v-if="modelValue" class="ip-trigger-preview">
                <i :class="computedIconClass" />
                <code>{{ modelValue }}</code>
            </span>
            <span v-else class="ip-trigger-empty">
                <i class="fas fa-icons" /> Pick an icon
            </span>
            <i class="fas fa-chevron-down ip-trigger-chev" />
        </button>

        <IconPickerModal
            :visible="pickerOpen"
            :selected-glyph="selectedClass"
            :glyph-filter="solidOnly"
            allow-clear
            @close="pickerOpen = false"
            @pick="onPickGlyph"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import IconPickerModal from '@/components/core/IconPickerModal.vue';

const modelValue = defineModel<string>({default: ''});

const pickerOpen = ref(false);

// Tolerate slug ('star') and full class ('fas fa-star') storage shapes.
function toFullClass(value: string): string {
    if (!value) return '';
    return value.includes(' ') ? value : `fas fa-${value}`;
}

const computedIconClass = computed(() => toFullClass(modelValue.value));
const selectedClass = computed(() => toFullClass(modelValue.value));

function solidOnly(cls: string): boolean {
    return cls.startsWith('fas fa-');
}

function onPickGlyph(cls: string): void {
    if (!cls) {
        modelValue.value = '';
    } else if (modelValue.value.includes(' ')) {
        modelValue.value = cls;
    } else {
        modelValue.value = cls.replace(/^fas fa-/, '');
    }
    pickerOpen.value = false;
}
</script>

<style scoped>
.ip-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    cursor: pointer;
}
.ip-trigger:hover {
    border-color: var(--color-border-strong);
}
.ip-trigger-preview {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.ip-trigger-preview code {
    font-family: var(--font-mono, monospace);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.ip-trigger-empty {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
}
.ip-trigger-chev {
    margin-left: auto;
    color: var(--color-text-tertiary);
}
</style>
