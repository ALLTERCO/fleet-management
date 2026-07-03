<template>
    <!-- Resolved component path: render the real card with full event wiring.
         `selected` is not passed here — only the legacy EntityWidget branch
         below opts into it, matching the previous dashboard behavior. -->
    <component
        v-if="card && !isLegacyClickableEntity"
        :is="card.component"
        v-bind="card.props"
        @delete="emit('delete')"
        @move="(d: number) => emit('move', d)"
        @cycle-size="emit('cycle-size')"
        @resize="(s: string) => emit('resize', s)"
        @open-detail="emit('open-detail')"
        @open-preview="emit('open-preview')"
        @configure="emit('configure')"
        @run="emit('run')"
    />
    <!-- Legacy entity-not-mapped fallback: EntityWidget emits only `delete`;
         opening the detail relies on a DOM click event. -->
    <component
        v-else-if="card && isLegacyClickableEntity"
        :is="card.component"
        v-bind="card.props"
        :selected="selected"
        class="hover:cursor-pointer"
        @delete="emit('delete')"
        @click="!editMode && emit('open-detail')"
    />
    <!-- Resolver returned a placeholder (entity/group/action not loaded,
         widget config invalid, or unknown type). -->
    <MissingCard
        v-else-if="missing"
        :title="missing.title"
        :hint="missing.hint"
        :size="missing.size"
        :edit-mode="editMode"
        @delete="emit('delete')"
        @move="(d: number) => emit('move', d)"
        @cycle-size="emit('cycle-size')"
        @resize="(s: string) => emit('resize', s)"
    />
</template>

<script setup lang="ts">
import {computed, inject} from 'vue';
import MissingCard from '@/components/dashboard/MissingCard.vue';
import EntityWidget from '@/components/widgets/EntityWidget.vue';
import {
    ACTIONS_LIST_KEY,
    ENTITY_CACHE_KEY
} from '@/composables/dashboardInjectionKeys';
import {resolveDashboardEntry} from '@/composables/useDashboardEntryRenderer';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import type {DashboardEntry} from '@/types/dashboard-entry';

const props = withDefaults(
    defineProps<{
        entry: DashboardEntry;
        editMode?: boolean;
        selected?: boolean;
    }>(),
    {editMode: false, selected: false}
);

const emit = defineEmits<{
    delete: [];
    move: [direction: number];
    'cycle-size': [];
    resize: [size: string];
    'open-detail': [];
    'open-preview': [];
    configure: [];
    run: [];
}>();

const injectedCache = inject(ENTITY_CACHE_KEY, null);
const injectedActions = inject(ACTIONS_LIST_KEY, null);

const entityStore = useEntityStore();
const groupsStore = useGroupsStore();

const resolved = computed(() =>
    resolveDashboardEntry(
        props.entry,
        {
            entityCache: injectedCache?.value ?? new Map(),
            rawEntity: (id) => entityStore.entities[id],
            group: (id) => groupsStore.groups[id],
            action: (id) =>
                injectedActions?.value.find((a) => a.id === id)
        },
        {editMode: props.editMode}
    )
);

const card = computed(() =>
    resolved.value.kind === 'component' ? resolved.value : null
);
const missing = computed(() =>
    resolved.value.kind === 'missing' ? resolved.value : null
);

/** EntityWidget (used as the entity-not-mapped fallback) emits `delete`
 *  only; opening the detail uses a DOM click, not a component event. */
const isLegacyClickableEntity = computed(
    () => card.value?.component === EntityWidget
);
</script>
