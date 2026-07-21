<template>
    <span
        v-if="show"
        class="gkb"
        :class="[
            `gkb--cat-${category}`,
            {'gkb--pill': pill && !plain, 'gkb--plain': plain}
        ]"
        :title="title"
    >
        <i
            v-if="iconClass && !plain"
            :class="['gkb__icon', iconClass]"
            aria-hidden="true"
        />
        <span class="gkb__label">{{ label }}</span>
    </span>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useGroupKinds} from '@/composables/useGroupKinds';

const props = withDefaults(
    defineProps<{
        kindId: string | null | undefined;
        /** Suppress entirely for the catch-all kind (default true). */
        hideManual?: boolean;
        /** Render as a full pill (icon + label) vs. icon-only chip. */
        pill?: boolean;
        /** Label-only text, no chrome — typography inherits from the host. */
        plain?: boolean;
    }>(),
    {hideManual: true, pill: true, plain: false}
);

const {byId, ensureLoaded} = useGroupKinds();
void ensureLoaded();

const kindDef = computed(() => {
    const id = props.kindId;
    if (!id) return null;
    return byId.value.get(id) ?? null;
});

const show = computed(() => {
    if (!props.kindId) return false;
    if (props.hideManual && props.kindId === 'manual') return false;
    return true;
});

const category = computed(() => kindDef.value?.category ?? 'general');
const iconClass = computed(() => kindDef.value?.icon ?? 'fa-solid fa-shapes');
const label = computed(() => kindDef.value?.displayName ?? props.kindId ?? '');
const title = computed(() => {
    const def = kindDef.value;
    if (!def) return label.value;
    return `${def.displayName} · ${prettyCategory(def.category)}`;
});

function prettyCategory(c: string): string {
    return c
        .split('_')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
        .join(' ');
}
</script>

<style scoped>
.gkb {
    display: inline-flex; align-items: center; gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--gkb-color, var(--color-primary)) 14%, transparent);
    color: var(--gkb-color, var(--color-primary));
    border: 1px solid color-mix(in srgb, var(--gkb-color, var(--color-primary)) 28%, transparent);
    font-size: var(--type-caption); font-weight: 600;
    line-height: 1.1;
    white-space: nowrap;
}
.gkb--pill { gap: var(--space-2); padding: var(--space-1) var(--space-2-5); }
.gkb--plain {
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font-size: inherit;
    font-weight: inherit;
}
.gkb--plain .gkb__label {
    overflow: hidden;
    text-overflow: ellipsis;
}
.gkb__icon { font-size: 0.95em; }
.gkb__label { letter-spacing: var(--tracking-tight); }

/* Per-category accent hues. Unthemed categories inherit --color-primary
   via the --gkb-color default on .gkb. */
.gkb--cat-electrical { --gkb-color: var(--color-category-amber); }
.gkb--cat-solar { --gkb-color: var(--color-category-amber); }
.gkb--cat-renewables { --gkb-color: var(--color-category-green); }
.gkb--cat-energy_storage { --gkb-color: var(--color-category-blue); }
.gkb--cat-ev { --gkb-color: var(--color-category-blue); }
.gkb--cat-building { --gkb-color: var(--color-text-secondary); }
.gkb--cat-industrial { --gkb-color: var(--color-category-orange); }
.gkb--cat-datacenter { --gkb-color: var(--color-category-blue); }
.gkb--cat-residential { --gkb-color: var(--color-category-green); }
.gkb--cat-healthcare { --gkb-color: var(--color-category-red); }
.gkb--cat-education { --gkb-color: var(--color-category-blue); }
.gkb--cat-water_utility { --gkb-color: var(--color-category-blue); }
.gkb--cat-telecom { --gkb-color: var(--color-category-orange); }
.gkb--cat-agriculture { --gkb-color: var(--color-category-green); }
.gkb--cat-mining { --gkb-color: var(--color-text-secondary); }
.gkb--cat-defense { --gkb-color: var(--color-category-red); }
.gkb--cat-public_safety { --gkb-color: var(--color-category-red); }
</style>
