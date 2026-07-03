<template>
    <nav class="mtr" :aria-label="ariaLabel">
        <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            class="mtr__tab"
            :class="{
                'mtr__tab--active': tab.key === modelValue,
                'mtr__tab--invalid': !!tab.invalid
            }"
            :aria-current="tab.key === modelValue ? 'page' : undefined"
            @click="select(tab.key)"
        >
            <span v-if="tab.icon" class="mtr__icon" aria-hidden="true">
                <i :class="`fas ${tab.icon}`" />
            </span>
            <span class="mtr__body">
                <span class="mtr__label">{{ tab.label }}</span>
                <span v-if="tab.hint" class="mtr__hint">{{ tab.hint }}</span>
            </span>
            <span v-if="tab.invalid" class="mtr__dot" aria-label="Has errors">
                <i class="fas fa-circle" />
            </span>
            <span v-else-if="tab.badge" class="mtr__badge">{{ tab.badge }}</span>
            <span v-else-if="tab.complete" class="mtr__check" aria-hidden="true">
                <i class="fas fa-check" />
            </span>
        </button>
    </nav>
</template>

<script setup lang="ts">
// Left-rail vertical tab navigator for modals. Each tab can flag itself as
// invalid (red dot) or complete (muted check), giving the user a map of the
// form without scrolling through it. Keyed by string so parent owns state.
export interface TabRailItem {
    key: string;
    label: string;
    icon?: string;
    hint?: string;
    /** Set true when a required field in this tab is missing/invalid. */
    invalid?: boolean;
    /** Set true when the tab's content has been satisfied (optional cue). */
    complete?: boolean;
    /** Numeric counter badge (e.g., "3" attachments). */
    badge?: string | number;
}

withDefaults(
    defineProps<{
        tabs: TabRailItem[];
        modelValue: string;
        ariaLabel?: string;
    }>(),
    {ariaLabel: 'Section navigation'}
);

const emit = defineEmits<{
    'update:modelValue': [key: string];
}>();

function select(key: string) {
    emit('update:modelValue', key);
}
</script>

<style scoped>
.mtr {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: var(--form-tab-rail-width);
    padding: var(--space-2);
    background: var(--color-surface-1);
    border-radius: var(--radius-xl);
    align-self: flex-start;
    position: sticky;
    top: var(--space-2);
}

.mtr__tab {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: var(--touch-target-min);
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    text-align: left;
    cursor: pointer;
    transition:
        background var(--motion-hover),
        color var(--motion-hover),
        box-shadow var(--motion-state);
    position: relative;
}

.mtr__tab:hover {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}

.mtr__tab:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: 0;
}

.mtr__tab--active {
    background: color-mix(
        in srgb,
        var(--color-primary) 12%,
        var(--color-surface-2)
    );
    color: var(--color-text-primary);
    box-shadow: inset 3px 0 0 var(--color-primary);
}

.mtr__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    flex-shrink: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.mtr__tab--active .mtr__icon {
    color: var(--color-primary-text);
}

.mtr__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
}

.mtr__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: inherit;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.mtr__hint {
    font-size: var(--type-body);
    font-weight: var(--font-normal);
    color: var(--color-text-tertiary);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.mtr__dot {
    display: inline-flex;
    width: var(--space-2);
    height: var(--space-2);
    align-items: center;
    justify-content: center;
    color: var(--color-danger-text);
    font-size: var(--icon-size-2xs);
}

.mtr__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-5);
    padding: 0 var(--space-1-5);
    height: var(--space-5);
    background: var(--color-surface-3);
    color: var(--color-text-tertiary);
    border-radius: var(--radius-full);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.mtr__tab--active .mtr__badge {
    background: rgba(var(--color-primary-rgb), 0.2);
    color: var(--color-primary-text);
}

.mtr__check {
    color: var(--color-success-text);
    font-size: var(--type-body);
}

.mtr__tab--invalid {
    color: var(--color-text-primary);
}

@media (max-width: 900px) {
    .mtr {
        flex-direction: row;
        overflow-x: auto;
        width: 100%;
        gap: var(--space-1);
        position: static;
        scrollbar-width: none;
    }

    .mtr::-webkit-scrollbar {
        display: none;
    }

    .mtr__tab {
        flex: 0 0 auto;
        min-width: max-content;
    }

    .mtr__tab--active {
        box-shadow: inset 0 -3px 0 var(--color-primary);
    }

    .mtr__hint {
        display: none;
    }
}
</style>
