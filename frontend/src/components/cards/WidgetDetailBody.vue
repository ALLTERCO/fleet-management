<template>
    <!-- Hero band: widget identity, mirroring the entity detail's shell -->
    <div class="do-hero">
        <div class="do-hero-top">
            <div class="do-photo">
                <i :class="meta.icon" aria-hidden="true" />
            </div>
            <div class="do-hero-id">
                <span :id="titleId" class="do-name">{{ title }}</span>
                <span v-if="meta.description" class="wdb-desc">{{ meta.description }}</span>
            </div>
            <button type="button" class="do-close" @click="$emit('close')" aria-label="Close">
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
        </div>
    </div>

    <div class="do-content">
        <!-- The point of the detail view: the same widget, at hero (2x2) size.
             Rendered through DashboardEntryView so the overlay can never drift
             from what the dashboard shows. Clicks inside stay inert. -->
        <div class="wdb-stage">
            <DashboardEntryView :entry="heroEntry" :clickable="false" />
        </div>

        <!-- Readonly config summary, from the entry's stored widget config -->
        <section v-if="configRows.length" class="wdb-config">
            <h3 class="wdb-config-title">Configuration</h3>
            <dl class="wdb-config-list">
                <template v-for="row in configRows" :key="row.key">
                    <dt class="wdb-config-key">{{ row.label }}</dt>
                    <dd class="wdb-config-value">{{ row.value }}</dd>
                </template>
            </dl>
        </section>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import DashboardEntryView from '@/components/dashboard/DashboardEntryView.vue';
import {UI_WIDGET_META} from '@/helpers/widgetSamples';
import type {DashboardEntry, UiWidgetId} from '@/types/dashboard-entry';

const props = defineProps<{
    entry: DashboardEntry;
    /** Display title — resolved by useDashboardDetailResolver (config label
     *  when set, catalog name otherwise). */
    title: string;
    /** aria-labelledby target supplied by DetailOverlayShell. */
    titleId?: string;
}>();

defineEmits<{
    close: [];
}>();

const widgetId = computed<UiWidgetId | null>(() => {
    const id = props.entry.data?.id;
    return typeof id === 'string' && id in UI_WIDGET_META
        ? (id as UiWidgetId)
        : null;
});

const meta = computed(() =>
    widgetId.value
        ? UI_WIDGET_META[widgetId.value]
        : {icon: 'fas fa-shapes', name: 'Widget', description: ''}
);

// Force hero size; the renderer clamps kinds that cap below 2x2.
const heroEntry = computed<DashboardEntry>(() => ({
    ...props.entry,
    size: '2x2'
}));

const configRows = computed(() => {
    const data = props.entry.data ?? {};
    return Object.entries(data)
        .filter(([key, value]) => key !== 'id' && value != null)
        .map(([key, value]) => ({
            key,
            label: humanizeKey(key),
            value: formatValue(value)
        }));
});

function humanizeKey(key: string): string {
    const spaced = key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(value: unknown): string {
    if (Array.isArray(value)) {
        return value.map((v) => formatValue(v)).join(', ');
    }
    if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value);
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
}
</script>

<style scoped>
.wdb-desc {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

/* Same track sizing as .bento-grid so the hero card renders at the exact
   dashboard 2x2 footprint; minmax lets it shrink on narrow panels. */
.wdb-stage {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, var(--grid-cell, 200px)));
    grid-auto-rows: var(--grid-cell, 200px);
    gap: var(--card-grid-gap, 12px);
    justify-content: center;
}

.wdb-config {
    margin-top: var(--space-5);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    padding: var(--space-4);
}
.wdb-config-title {
    margin: 0 0 var(--space-3);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    color: var(--color-text-tertiary);
}
.wdb-config-list {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-2) var(--space-4);
    margin: 0;
}
.wdb-config-key {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.wdb-config-value {
    margin: 0;
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
}
</style>
