<template>
    <div class="map-legend" role="list" :aria-label="ariaLabel">
        <span
            v-for="item in items"
            :key="item.id"
            class="map-legend__item"
            role="listitem"
        >
            <span
                class="map-legend__dot"
                :class="`map-legend__dot--${item.tone}`"
                aria-hidden="true"
            />
            {{ item.label }}
        </span>
    </div>
</template>

<script setup lang="ts">
export type LegendTone = 'on' | 'warn' | 'off' | 'unknown' | 'primary';

export interface LegendItem {
    id: string;
    tone: LegendTone;
    label: string;
}

withDefaults(
    defineProps<{
        items: readonly LegendItem[];
        ariaLabel?: string;
    }>(),
    {ariaLabel: 'Legend'}
);
</script>

<style scoped>
.map-legend {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    background: var(--glass-2-bg);
    backdrop-filter: var(--glass-2-filter);
    -webkit-backdrop-filter: var(--glass-2-filter);
    border: 1px solid var(--glass-border);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    box-shadow: var(--shadow-lg);
    pointer-events: none;
}
.map-legend__item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    white-space: nowrap;
}
.map-legend__dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: 50%;
    flex-shrink: 0;
}
.map-legend__dot--on {
    background: var(--color-status-on);
    box-shadow: 0 0 6px var(--color-status-on);
}
.map-legend__dot--warn {
    background: var(--color-status-warn);
    box-shadow: 0 0 6px var(--color-status-warn);
}
.map-legend__dot--off {
    background: var(--color-status-off);
    box-shadow: 0 0 6px var(--color-status-off);
}
.map-legend__dot--unknown,
.map-legend__dot--primary {
    background: var(--color-primary);
    box-shadow: 0 0 6px var(--color-primary);
}
</style>
