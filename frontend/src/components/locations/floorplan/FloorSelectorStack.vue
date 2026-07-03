<template>
    <div
        v-if="floors.length > 0"
        class="fss"
        role="group"
        :aria-label="ariaLabel"
    >
        <button
            v-for="f in displayFloors"
            :key="f.id"
            type="button"
            class="fss__btn"
            :class="{'fss__btn--active': f.id === activeId}"
            :title="f.tooltip"
            :aria-pressed="f.id === activeId"
            @click="$emit('select', f.id)"
            @mouseenter="$emit('hover', f.id)"
            @mouseleave="$emit('hover', null)"
        >
            <span class="fss__short">{{ f.short }}</span>
            <span class="fss__name">{{ f.name }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

export interface FloorOption {
    readonly id: number;
    readonly name: string;
    readonly /** Short label, e.g. "2" or "B1". */ short: string;
    readonly deviceCount?: number;
    readonly alertCount?: number;
}

const props = defineProps<{
    floors: readonly FloorOption[];
    activeId: number | null;
    ariaLabel?: string;
}>();

defineEmits<{
    select: [id: number];
    hover: [id: number | null];
}>();

// Reverse so the top floor renders at the top of the stack — mirrors how
// building signage reads (Google Indoor / Map UI Patterns canon).
const displayFloors = computed(() =>
    [...props.floors].reverse().map((f) => ({
        ...f,
        tooltip: buildTooltip(f)
    }))
);

function buildTooltip(f: FloorOption): string {
    const parts = [f.name];
    if (f.deviceCount != null) parts.push(`${f.deviceCount} devices`);
    if (f.alertCount != null && f.alertCount > 0) {
        parts.push(`${f.alertCount} alert${f.alertCount === 1 ? '' : 's'}`);
    }
    return parts.join(' · ');
}
</script>

<style scoped>
.fss {
    display: flex;
    flex-direction: column;
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
    max-height: 60vh;
    overflow-y: auto;
}

.fss__btn {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--color-text-secondary);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 64px;
    transition:
        background var(--duration-fast),
        color var(--duration-fast);
}

.fss__btn:hover {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
}

.fss__btn:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: -2px;
}

.fss__btn--active {
    background: rgba(var(--color-primary-rgb), 0.18);
    color: var(--color-primary-text);
    box-shadow: inset 0 0 0 1px rgba(var(--color-primary-rgb), 0.4);
}

.fss__short {
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    width: 22px;
    text-align: center;
    font-variant-numeric: tabular-nums;
}

.fss__name {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 140px;
}
</style>
