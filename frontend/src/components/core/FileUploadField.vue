<template>
    <div
        class="fuf"
        :class="[`fuf--${variant}`, {'fuf--busy': disabled || loading}]"
    >
        <label class="fuf__upload">
            <input
                :accept="accept"
                :disabled="disabled || loading"
                :capture="capture || undefined"
                type="file"
                class="fuf__input"
                @change="onChange"
            />
            <i class="fas" :class="iconClass" aria-hidden="true" />
            <span class="fuf__label">{{ shownLabel }}</span>
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
        loading?: boolean;
        uploadLabel?: string;
        deleteLabel?: string;
        showDelete?: boolean;
        // 'compact' is an inline button; 'dropzone' is a large drop area.
        variant?: 'compact' | 'dropzone';
        // Shown in place of the hint once a file is chosen (dropzone).
        fileName?: string;
        // Mobile camera capture for image uploads.
        capture?: boolean;
    }>(),
    {
        accept: '',
        disabled: false,
        loading: false,
        uploadLabel: 'Upload',
        deleteLabel: 'Delete file',
        showDelete: true,
        variant: 'compact',
        fileName: '',
        capture: false
    }
);

const iconClass = computed(() => {
    if (props.loading) return 'fa-spinner fa-spin';
    return props.variant === 'dropzone'
        ? 'fa-cloud-arrow-up'
        : 'fa-arrow-up-from-bracket';
});

const emit = defineEmits<{
    upload: [event: Event];
    delete: [];
}>();

// A chosen file's name replaces the hint in the dropzone; the compact button
// always shows its action label.
const shownLabel = computed(() =>
    props.variant === 'dropzone' && props.fileName
        ? props.fileName
        : props.uploadLabel
);

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
.fuf--dropzone {
    display: block;
}
.fuf__upload {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    cursor: pointer;
    user-select: none;
    color: var(--color-text-primary);
    transition:
        background var(--duration-fast),
        border-color var(--duration-fast);
}
.fuf__upload i {
    color: var(--brand-light);
    font-size: var(--type-body);
}

/* Compact: an inline button, for form fields. */
.fuf--compact .fuf__upload {
    padding: var(--space-1-5) var(--space-3);
    min-height: var(--touch-target-min);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
}
.fuf--compact .fuf__upload:hover {
    background: var(--color-surface-3);
    border-color: var(--color-border-focus);
}

/* Dropzone: a large drop area, for primary uploads. */
.fuf--dropzone .fuf__upload {
    flex-direction: column;
    justify-content: center;
    width: 100%;
    padding: var(--space-8);
    background: var(--color-surface-3);
    border: 2px dashed var(--color-border-medium);
    border-radius: var(--btn-radius);
    text-align: center;
}
.fuf--dropzone .fuf__upload:hover {
    background: var(--color-surface-4);
    border-color: var(--color-border-focus);
}
.fuf--dropzone .fuf__upload i {
    font-size: var(--type-heading);
}

.fuf__upload:focus-within {
    outline: none;
    border-color: var(--color-border-focus);
    box-shadow: var(--shadow-brand-ring);
}
.fuf__label {
    min-width: 0;
    overflow-wrap: anywhere;
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
