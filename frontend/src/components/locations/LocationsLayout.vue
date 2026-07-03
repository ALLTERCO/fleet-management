<template>
    <div class="ll">
        <aside class="ll__tree" aria-label="Locations tree">
            <slot
                name="tree"
                :selected-id="selectedId"
                :on-select="onSelect"
            />
        </aside>
        <section class="ll__detail" aria-label="Location detail">
            <LocationDetailPanel
                v-if="selectedId != null"
                :key="selectedId"
                :location-id="selectedId"
                :active-tab="activeTab"
                @tab-change="onTabChange"
                @navigate="onSelect"
                @request-delete="$emit('request-delete', selectedId)"
            />
            <div v-else class="ll__empty">
                <i class="fas fa-arrow-left ll__empty-icon" aria-hidden="true" />
                <p class="ll__empty-title">Select a location</p>
                <p class="ll__empty-sub">Pick a node from the tree to see details.</p>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import LocationDetailPanel from '@/components/locations/LocationDetailPanel.vue';
import {resolveActiveTab} from '@/helpers/location-kinds';
import {
    type DetailTabKey,
    parseSelectedId
} from '@/helpers/locationsUrlState';
import {useLocationsStore} from '@/stores/locations';
import {trackInteraction} from '@/tools/observability';

defineEmits<{
    'request-delete': [id: number];
}>();

const route = useRoute();
const router = useRouter();
const locationsStore = useLocationsStore();

const selectedId = computed<number | null>(() =>
    parseSelectedId(route.query.selected)
);

// Default tab follows the selected location's kind so a building click
// lands on the 3D plan and a country click lands on the overview.
const selectedKind = computed(() => {
    const id = selectedId.value;
    if (id == null) return null;
    return locationsStore.locations[id]?.kind ?? null;
});
const activeTab = computed<DetailTabKey>(() =>
    resolveActiveTab(route.query.tab, selectedKind.value)
);

function onSelect(id: number): void {
    trackInteraction('locations', 'tree_select', String(id));
    router.replace({query: {...route.query, selected: String(id)}});
}

function onTabChange(tab: DetailTabKey): void {
    trackInteraction('locations', 'tab_view', tab);
    router.replace({query: {...route.query, tab}});
}
</script>

<style scoped>
/* The page-level li-tree-wrap owns the glass surface so we stay
   transparent here — nesting glass cancels the blur effect. The vertical
   divider matches the glass-border tone for visual continuity. */
.ll {
    display: grid;
    grid-template-columns: 35% 65%;
    flex: 1;
    width: 100%;
    min-height: 0;
    background: transparent;
}

.ll__tree {
    background: transparent;
    border-right: 1px solid var(--glass-border);
    overflow-y: auto;
    min-height: 0;
}

.ll__detail {
    background: transparent;
    overflow: hidden;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.ll__empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tertiary);
    text-align: center;
    padding: var(--space-8);
    gap: var(--space-2);
}

.ll__empty-icon {
    font-size: var(--icon-size-xl);
    color: var(--color-text-quaternary);
    margin-bottom: var(--space-3);
}

.ll__empty-title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    margin: 0;
}

.ll__empty-sub {
    font-size: var(--type-caption);
    margin: 0;
}

@media (max-width: 1024px) {
    .ll {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(0, 40vh) 1fr;
    }
    .ll__tree {
        border-right: none;
        border-bottom: 1px solid var(--color-border-default);
    }
}
</style>
