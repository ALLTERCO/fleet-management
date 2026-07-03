<template>
    <div class="fuf" :class="{'fuf--busy': disabled}">
        <label class="fuf__upload">
            <input
                :accept="accept"
                :disabled="disabled"
                type="file"
                class="fuf__input"
                @change="onChange"
            />
            <i class="fas fa-arrow-up-from-bracket" aria-hidden="true" />
            <span>{{ uploadLabel }}</span>
        </label>
        <button
            v-if="showDelete"
            type="button"
            class="fuf__delete"
            :disabled="disabled"
            :title="deleteLabel"
            :aria-label="deleteLabel"
            @click="$emit('delete')"
        >
            <i class="fas fa-trash" aria-hidden="true" />
        </button>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(
    defineProps<{
        accept?: string;
        disabled?: boolean;
        uploadLabel?: string;
        deleteLabel?: string;
        showDelete?: boolean;
    }>(),
    {
        accept: '',
        disabled: false,
        uploadLabel: 'Upload',
        deleteLabel: 'Delete file',
        showDelete: true
    }
);

const emit = defineEmits<{
    upload: [event: Event];
    delete: [];
}>();

const uploadLabel = computed(() => props.uploadLabel);
const deleteLabel = computed(() => props.deleteLabel);

function onChange(event: Event): void {
    emit('upload', event);
    const target = event.target as HTMLInputElement;
    target.value = '';
}
</script>

<style scoped>
.fuf {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.fuf__upload {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-3);
    min-height: var(--touch-target-min);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    user-select: none;
    transition:
        background var(--duration-fast),
        border-color var(--duration-fast);
}
.fuf__upload:hover {
    background: var(--color-surface-3);
    border-color: var(--color-border-focus);
}
.fuf__upload:focus-within {
    outline: none;
    border-color: var(--color-border-focus);
    box-shadow: var(--shadow-brand-ring);
}
.fuf__upload i {
    color: var(--brand-light);
    font-size: var(--type-body);
}
.fuf__input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    overflow: hidden;
    pointer-events: none;
}
.fuf__delete {
    display: inline-grid;
    place-items: center;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    background: transparent;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition:
        background var(--duration-fast),
        border-color var(--duration-fast),
        color var(--duration-fast);
}
.fuf__delete:hover:not(:disabled) {
    border-color: var(--color-danger);
    color: var(--color-danger-text);
    background: var(--color-danger-subtle);
}
.fuf--busy {
    opacity: 0.55;
    pointer-events: none;
}
</style>
