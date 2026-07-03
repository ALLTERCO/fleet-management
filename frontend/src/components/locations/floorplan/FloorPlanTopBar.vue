<template>
    <header class="fpt">
        <div class="fpt__lead">
            <button
                v-if="backLabel"
                type="button"
                class="fpt__back"
                :title="`Back to ${backLabel}`"
                @click="$emit('back')"
            >
                <i class="fas fa-arrow-left" aria-hidden="true" />
                <span>{{ backLabel }}</span>
            </button>
            <h2 v-if="title" class="fpt__title">{{ title }}</h2>
            <span v-if="subtitle" class="fpt__subtitle">{{ subtitle }}</span>
        </div>

        <div class="fpt__actions">
            <slot name="extra" />

            <button
                v-if="canFullscreen"
                type="button"
                class="fpt__btn"
                :title="fullscreenLabel"
                :aria-pressed="isFullscreen"
                @click="$emit('toggle-fullscreen')"
            >
                <i :class="['fas', isFullscreen ? 'fa-compress' : 'fa-expand']" aria-hidden="true" />
            </button>

            <button
                v-if="canEdit && !editMode"
                type="button"
                class="fpt__btn fpt__btn--primary"
                @click="$emit('enter-edit')"
            >
                Edit
            </button>

            <template v-else-if="editMode">
                <button
                    type="button"
                    class="fpt__btn"
                    :disabled="saving"
                    @click="$emit('cancel-edit')"
                >
                    <i class="fas fa-xmark" aria-hidden="true" />
                    Cancel
                </button>
                <button
                    type="button"
                    class="fpt__btn fpt__btn--save"
                    :disabled="saving || !isDirty"
                    @click="$emit('save-edit')"
                >
                    <i class="fas fa-floppy-disk" aria-hidden="true" />
                    {{ saving ? 'Saving…' : 'Save' }}
                </button>
            </template>
        </div>
    </header>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = defineProps<{
    title?: string;
    subtitle?: string;
    backLabel?: string;
    canEdit?: boolean;
    editMode?: boolean;
    isDirty?: boolean;
    saving?: boolean;
    canFullscreen?: boolean;
    isFullscreen?: boolean;
}>();

defineEmits<{
    back: [];
    'enter-edit': [];
    'cancel-edit': [];
    'save-edit': [];
    'toggle-fullscreen': [];
}>();

const fullscreenLabel = computed(() =>
    props.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'
);
</script>

<style scoped>
/* 56px top bar, 16px horizontal padding, three clean regions.
   Lead (Back + Title) left, Actions cluster right, no center region. */
.fpt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: 0 var(--space-4);
    background: var(--glass-2-bg);
    backdrop-filter: var(--glass-2-filter);
    -webkit-backdrop-filter: var(--glass-2-filter);
    border-bottom: 1px solid var(--glass-border);
    height: 56px;
    flex-shrink: 0;
}

.fpt__lead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    flex: 1;
}

.fpt__back {
    appearance: none;
    background: transparent;
    border: 1px solid var(--glass-border);
    color: var(--color-text-secondary);
    border-radius: var(--radius-md);
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    transition:
        background var(--duration-fast),
        color var(--duration-fast);
    height: 32px;
}

.fpt__back:hover {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
}

.fpt__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.fpt__subtitle {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.fpt__actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
}

.fpt__btn {
    appearance: none;
    background: transparent;
    border: 1px solid var(--glass-border);
    color: var(--color-text-secondary);
    border-radius: var(--radius-md);
    padding: 0 var(--space-3);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    transition:
        background var(--duration-fast),
        color var(--duration-fast);
    height: 32px;
    min-width: 32px;
    justify-content: center;
    position: relative;
}

.fpt__btn::after {
    content: "";
    position: absolute;
    inset: -6px;
}

.fpt__btn:hover:not(:disabled) {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
}

.fpt__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.fpt__btn--primary {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-primary);
}

.fpt__btn--primary:hover:not(:disabled) {
    background: var(--color-primary-strong, var(--color-primary));
    color: var(--color-text-primary);
}

.fpt__btn--save {
    background: var(--color-status-on);
    border-color: var(--color-status-on);
    color: var(--color-text-inverse);
}

.fpt__btn--save:hover:not(:disabled) {
    color: var(--color-text-inverse);
    filter: brightness(1.05);
}
</style>
