<template>
    <div class="det" role="toolbar" aria-label="Edit dashboard">
        <div class="det__indicator">
            <span class="det__dot" />
            Editing
        </div>

        <button
            type="button"
            class="det__btn det__btn--primary"
            aria-label="Add widget"
            @click="$emit('add-widget')"
        >
            <i class="fas fa-plus" aria-hidden="true" />
            <span class="det__label">Add widget</span>
        </button>

        <button
            type="button"
            class="det__btn"
            :disabled="!canUndo"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            @click="$emit('undo')"
        >
            <i class="fas fa-rotate-left" aria-hidden="true" />
            <span class="det__label">Undo</span>
        </button>
        <button
            type="button"
            class="det__btn"
            :disabled="!canRedo"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            @click="$emit('redo')"
        >
            <i class="fas fa-rotate-right" aria-hidden="true" />
            <span class="det__label">Redo</span>
        </button>

        <button
            type="button"
            class="det__btn"
            aria-label="Rename dashboard"
            title="Rename dashboard"
            @click="$emit('rename')"
        >
            <i class="fas fa-pen" aria-hidden="true" />
            <span class="det__label">Rename</span>
        </button>

        <span class="det__spacer" />

        <button
            type="button"
            class="det__btn det__btn--ghost"
            @click="$emit('cancel')"
        >
            Cancel
        </button>
        <button
            type="button"
            class="det__btn det__btn--save"
            @click="$emit('save')"
        >
            <i class="fas fa-check" aria-hidden="true" />
            <span class="det__label">Save</span>
        </button>
    </div>
</template>

<script setup lang="ts">
withDefaults(
    defineProps<{
        canUndo?: boolean;
        canRedo?: boolean;
    }>(),
    {canUndo: false, canRedo: false}
);

defineEmits<{
    (e: 'add-widget'): void;
    (e: 'undo'): void;
    (e: 'redo'): void;
    (e: 'rename'): void;
    (e: 'save'): void;
    (e: 'cancel'): void;
}>();
</script>

<style scoped>
.det {
    position: sticky;
    top: 0;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: color-mix(
        in srgb,
        var(--color-primary) 6%,
        var(--glass-3-bg) 94%
    );
    backdrop-filter: blur(var(--glass-2-blur));
    -webkit-backdrop-filter: blur(var(--glass-2-blur));
    border-bottom: 1px solid var(--color-primary);
}

.det__indicator {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-primary-text);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    padding: 0 var(--space-2);
}

.det__dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: 50%;
    background: var(--color-primary);
    box-shadow: 0 0 8px rgba(var(--color-primary-rgb), 0.6);
}

.det__spacer {
    flex: 1;
}

.det__btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    height: var(--btn-h-sm);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font: inherit;
    cursor: pointer;
    transition: background var(--duration-fast), border-color
        var(--duration-fast), color var(--duration-fast);
}
.det__btn:hover:not(:disabled) {
    background: var(--color-surface-3);
    border-color: var(--color-border-medium);
    color: var(--color-text-primary);
}
.det__btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
.det__btn--primary {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-on-primary);
}
.det__btn--primary:hover:not(:disabled) {
    filter: brightness(1.08);
}
.det__btn--ghost {
    background: transparent;
    border-color: transparent;
    color: var(--color-text-tertiary);
}
.det__btn--save {
    background: var(--color-status-on);
    border-color: var(--color-status-on);
    color: #08120c;
    font-weight: var(--font-bold);
}
.det__btn--save:hover:not(:disabled) {
    filter: brightness(1.08);
}
.det__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
</style>
