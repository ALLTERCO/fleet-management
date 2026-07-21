<template>
    <div
        class="cp"
        :class="[`cp--${entry.size}`, {'cp--selected': selected, 'cp--interactive': interactive}]"
        :role="interactive ? 'button' : undefined"
        :tabindex="interactive ? 0 : undefined"
        :aria-pressed="interactive ? selected : undefined"
        :aria-label="interactive ? ariaLabel : undefined"
        @click="interactive && emit('select')"
        @keydown.enter.prevent="interactive && emit('select')"
        @keydown.space.prevent="interactive && emit('select')"
    >
        <!-- Card render. When interactive, the whole inner card is `inert` so
             keyboard tab and synthetic clicks never reach the card's internal
             buttons (sliders, run, toggle). Tile selection then routes solely
             through the .cp root's click/keydown handlers. -->
        <div class="cp-card" :inert="interactive || undefined">
            <component
                v-if="card"
                :is="card.component"
                v-bind="card.props"
            />
            <MissingCard
                v-else-if="missing"
                :title="missing.title"
                :hint="missing.hint"
                :size="missing.size"
            />
        </div>

        <!-- Click-capture overlay disables internal interactivity for mouse
             too (inert covers keyboard + synthetic, pointer-events covers
             pointer hit-testing for browsers that haven't fully implemented
             inert's pointer-event suppression). -->
        <div v-if="interactive" class="cp-capture" />
    </div>
</template>

<script setup lang="ts">
import {computed, inject} from 'vue';
import MissingCard from '@/components/dashboard/MissingCard.vue';
import {
    ACTIONS_LIST_KEY,
    ENTITY_CACHE_KEY
} from '@/composables/dashboardInjectionKeys';
import {resolveDashboardEntry} from '@/composables/useDashboardEntryRenderer';
import {UI_WIDGET_META} from '@/helpers/widgetSamples';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import type {
    DashboardEntry,
    UiWidgetId
} from '@/types/dashboard-entry';

const props = withDefaults(
    defineProps<{
        /** The entry to render. Same shape used on the live dashboard. */
        entry: DashboardEntry;
        /** Catalog tile: enables click-capture, hover lift, selected ring. */
        interactive?: boolean;
        /** Show the selected ring (only meaningful when interactive). */
        selected?: boolean;
    }>(),
    {
        interactive: false,
        selected: false
    }
);

const emit = defineEmits<{
    select: [];
}>();

/** Optional injection — when the live dashboard provides a richer entity
 *  cache (with bthome-type info etc), use it. Otherwise the raw entity
 *  store fallback is good enough for picker previews. */
const injectedCache = inject(ENTITY_CACHE_KEY, null);
const injectedActions = inject(ACTIONS_LIST_KEY, null);

const devicesStore = useDevicesStore();
const entityStore = useEntityStore();
const groupsStore = useGroupsStore();

const resolved = computed(() =>
    resolveDashboardEntry(props.entry, {
        entityCache: injectedCache?.value ?? new Map(),
        rawEntity: (id) => entityStore.entities[id],
        group: (id) => groupsStore.groups[id],
        action: (id) =>
            injectedActions?.value.find((a) => a.id === id),
        deviceExternalId: (id) => devicesStore.idToShellyMap.get(id)
    })
);

const card = computed(() =>
    resolved.value.kind === 'component' ? resolved.value : null
);
const missing = computed(() =>
    resolved.value.kind === 'missing' ? resolved.value : null
);

/** Accessible label spoken by screen readers when the tile is focused.
 *  Used only when `interactive` — the inner card is `inert`, so its visible
 *  text isn't part of the accessible-name calculation. We re-create it here. */
const ariaLabel = computed(() => {
    const e = props.entry;
    switch (e.type) {
        case 'device': {
            const id = e.data?.id ?? e.data?.shellyID ?? '';
            return id ? `Add device ${id}` : 'Add device';
        }
        case 'group': {
            const g = groupsStore.groups[e.data?.id];
            return g?.name ? `Add group ${g.name}` : 'Add group';
        }
        case 'location':
            return e.data?.id != null
                ? `Add location ${e.data.id}`
                : 'Add location';
        case 'tag':
            return e.data?.id != null ? `Add tag ${e.data.id}` : 'Add tag';
        case 'action': {
            const a = injectedActions?.value.find(
                (x) => x.id === e.data?.id
            );
            return a?.name ? `Add action ${a.name}` : 'Add action';
        }
        case 'entity': {
            const id = e.data?.id ?? '';
            return id ? `Add entity ${id}` : 'Add entity';
        }
        case 'ui_widget': {
            const widgetId = e.data?.id as UiWidgetId | undefined;
            const meta = widgetId ? UI_WIDGET_META[widgetId] : undefined;
            return meta ? `Add ${meta.name} widget` : 'Add widget';
        }
        default:
            return 'Add widget';
    }
});
</script>

<style scoped>
/* Catalog/dashboard preview tile. Sizes follow the dashboard's bento grid
   so a preview tile matches what will be added to the dashboard exactly. */
.cp {
    position: relative;
    border-radius: var(--radius-card);
    outline: none;
    transition:
        transform var(--motion-hover),
        box-shadow var(--motion-state);
}
.cp--1x1 {
    width: var(--grid-cell);
    height: var(--grid-cell);
}
.cp--2x1 {
    width: calc(var(--grid-cell) * 2 + var(--card-grid-gap));
    height: var(--grid-cell);
}
.cp--2x2 {
    width: calc(var(--grid-cell) * 2 + var(--card-grid-gap));
    height: calc(var(--grid-cell) * 2 + var(--card-grid-gap));
}

.cp-card {
    position: absolute;
    inset: 0;
    pointer-events: none; /* internal card interactivity off in preview */
}

/* Click-capture surfaces over the inert card. Transparent — actual
   click handling lives on the .cp root for keyboard/focus parity. */
.cp-capture {
    position: absolute;
    inset: 0;
    cursor: pointer;
}

.cp--interactive {
    cursor: pointer;
}
.cp--interactive:hover {
    transform: translateY(-2px);
}
.cp--interactive:focus-visible {
    /* Inset gap + outer ring matches the rest of the app's focus style. */
    box-shadow:
        0 0 0 var(--focus-ring-offset) var(--color-surface-1),
        0 0 0 calc(var(--focus-ring-offset) + var(--focus-ring-width))
            var(--focus-ring-color);
}
.cp--selected {
    box-shadow:
        0 0 0 2px var(--color-primary),
        0 0 0 4px rgba(var(--color-primary-rgb), 0.25);
}

</style>
