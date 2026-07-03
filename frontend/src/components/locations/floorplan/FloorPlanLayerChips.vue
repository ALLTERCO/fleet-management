<template>
    <div v-if="chips.length > 0" class="lc" role="group" aria-label="Visible layers">
        <button
            v-for="c in chips"
            :key="c.key"
            type="button"
            class="lc__chip"
            :class="{'lc__chip--on': c.active}"
            :title="`Toggle ${c.label.toLowerCase()}`"
            :aria-pressed="c.active"
            @click="$emit('toggle', c.key)"
        >
            <i :class="['fas', c.icon]" aria-hidden="true" />
            {{ c.label }}
        </button>
    </div>
</template>

<script setup lang="ts">
export interface LayerChip {
    readonly key: string;
    readonly label: string;
    readonly icon: string;
    readonly active: boolean;
}

defineProps<{chips: readonly LayerChip[]}>();
defineEmits<{toggle: [key: string]}>();
</script>

<style scoped>
.lc {
    display: inline-flex;
    gap: var(--space-0-5);
    padding: var(--space-1);
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    box-shadow:
        inset 0 1px 0 var(--glass-highlight),
        0 8px 24px rgba(0, 0, 0, 0.35);
}

.lc__chip {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    transition:
        background var(--duration-fast),
        color var(--duration-fast);
    line-height: 1;
}

.lc__chip i {
    font-size: var(--icon-size-2xs);
    color: var(--color-text-tertiary);
}

.lc__chip:hover {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
}

.lc__chip--on {
    background: rgba(var(--color-primary-rgb), 0.18);
    color: var(--color-primary-text);
    box-shadow: inset 0 0 0 1px rgba(var(--color-primary-rgb), 0.4);
}

.lc__chip--on i {
    color: var(--color-primary);
}
</style>
