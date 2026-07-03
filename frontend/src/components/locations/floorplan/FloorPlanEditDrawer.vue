<template>
    <aside class="fpe" role="region" aria-label="Floor plan editing tools">
        <header class="fpe__hdr">
            <i class="fas fa-pen fpe__hdr-icon" aria-hidden="true" />
            <h3 class="fpe__hdr-title">Edit tools</h3>
            <button
                type="button"
                class="fpe__close"
                aria-label="Close edit panel"
                @click="$emit('close')"
            >
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
        </header>

        <ul class="fpe__list">
            <li
                v-for="s in sections"
                :key="s.key"
                class="fpe__section"
                :class="{'fpe__section--open': openSection === s.key}"
            >
                <button
                    type="button"
                    class="fpe__section-hdr"
                    :aria-expanded="openSection === s.key"
                    @click="onToggle(s.key)"
                >
                    <i :class="['fas', s.icon, 'fpe__section-icon']" aria-hidden="true" />
                    <span class="fpe__section-label">{{ s.label }}</span>
                    <span v-if="s.badge != null" class="fpe__section-badge">{{ s.badge }}</span>
                    <i
                        class="fas fa-chevron-down fpe__section-chev"
                        aria-hidden="true"
                    />
                </button>
                <div v-if="openSection === s.key" class="fpe__section-body">
                    <slot :name="s.key" />
                </div>
            </li>
        </ul>
    </aside>
</template>

<script setup lang="ts">
export interface EditDrawerSection {
    readonly key: string;
    readonly label: string;
    readonly icon: string;
    readonly badge?: number | null;
}

const props = defineProps<{
    sections: readonly EditDrawerSection[];
    openSection: string;
}>();

const emit = defineEmits<{
    'update:openSection': [key: string];
    close: [];
}>();

function onToggle(key: string): void {
    // Tapping the open header collapses it; tapping a closed one opens it.
    // Only one section at a time keeps the drawer scannable.
    emit('update:openSection', key === props.openSection ? '' : key);
}
</script>

<style scoped>
.fpe {
    width: 320px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-surface-2);
    border-left: 1px solid var(--color-border-default);
    overflow: hidden;
}

.fpe__hdr {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-default);
    background: var(--color-surface-3);
}

.fpe__hdr-icon {
    color: var(--color-primary);
    font-size: var(--icon-size-sm);
}

.fpe__hdr-title {
    margin: 0;
    flex: 1;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.fpe__close {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--color-text-tertiary);
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    cursor: pointer;
    position: relative;
}

.fpe__close::after {
    content: "";
    position: absolute;
    inset: -8px;
}

.fpe__close:hover {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
}

.fpe__list {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

.fpe__section {
    border-bottom: 1px solid var(--color-border-default);
}

.fpe__section-hdr {
    appearance: none;
    background: transparent;
    border: none;
    width: 100%;
    text-align: left;
    padding: var(--space-3) var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-primary);
    cursor: pointer;
    transition: background var(--duration-fast);
}

.fpe__section-hdr:hover {
    background: var(--state-hover-bg);
}

.fpe__section-icon {
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-2xs);
    width: 14px;
    text-align: center;
}

.fpe__section-label {
    flex: 1;
    font-size: var(--type-body);
    font-weight: var(--font-medium);
}

.fpe__section-badge {
    background: var(--color-surface-4);
    color: var(--color-text-secondary);
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
    min-width: 22px;
    text-align: center;
}

.fpe__section-chev {
    color: var(--color-text-quaternary);
    font-size: var(--icon-size-2xs);
    transition: transform var(--duration-fast);
}

.fpe__section--open .fpe__section-chev {
    transform: rotate(180deg);
}

.fpe__section-body {
    padding: var(--space-2) var(--space-4) var(--space-4);
    background: var(--color-surface-1);
}
</style>
