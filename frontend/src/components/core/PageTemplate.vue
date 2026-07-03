<template>
    <div class="pt-root" :class="{ 'pt-root--fill': fill }">
        <ErrorBoundary>
            <div class="pt-page">
                <!-- ═══ TOP BAR — page title (left) + user/settings menu (right) ═══ -->
                <header class="pt-topbar">
                    <div class="dp-header__left">
                        <slot name="title">
                            <h1 class="dp-header__title">{{ headerTitle }}</h1>
                        </slot>
                    </div>

                    <PageTopMenu class="pt-topbar__menu" />
                </header>

                <!-- ═══ OPTIONAL FILTER BAR / CHIPS (slots) ═══ -->
                <slot name="filter-bar" />
                <slot name="filter-chips" />

                <!-- ═══ FROSTED CONTENT PANEL — the toolbar (tabs | search |
                     actions) is the first row INSIDE this same glass ═══ -->
                <Transition name="pt-fade">
                    <GlassShell
                        v-if="loading"
                        key="skeleton"
                        padded
                        :fill="fill"
                        class="pt-content"
                    >
                        <PageToolbar
                            v-if="hasToolbar"
                            v-bind="toolbarProps"
                            v-model:search="searchModel"
                            @tab-click="onTabClick"
                            @back="onBack"
                            @filter-click="$emit('filter-click')"
                            @toggle-selecting="toggleSelecting"
                        >
                            <template v-if="$slots.toggles" #toggles><slot name="toggles" /></template>
                            <template v-if="$slots.center" #center><slot name="center" /></template>
                            <template v-if="$slots.actions" #actions><slot name="actions" /></template>
                        </PageToolbar>
                        <slot name="skeleton">
                            <div :class="skeletonGrid">
                                <Skeleton
                                    v-for="n in skeletonCount"
                                    :key="n"
                                    :variant="skeletonVariant"
                                />
                            </div>
                        </slot>
                    </GlassShell>

                    <!-- Bare mode skips the auto-wrap shell for pages that own
                         their content surfaces — split-pane workspaces,
                         dashboards, full-bleed canvases. -->
                    <div
                        v-else-if="bare"
                        key="bare"
                        class="pt-content pt-content--bare"
                    >
                        <PageToolbar
                            v-if="hasToolbar"
                            v-bind="toolbarProps"
                            v-model:search="searchModel"
                            @tab-click="onTabClick"
                            @back="onBack"
                            @filter-click="$emit('filter-click')"
                            @toggle-selecting="toggleSelecting"
                        >
                            <template v-if="$slots.toggles" #toggles><slot name="toggles" /></template>
                            <template v-if="$slots.center" #center><slot name="center" /></template>
                            <template v-if="$slots.actions" #actions><slot name="actions" /></template>
                        </PageToolbar>
                        <slot />
                    </div>

                    <GlassShell
                        v-else
                        key="content"
                        padded
                        :fill="fill"
                        class="pt-content"
                        :data-scroll-owner="fill ? 'page' : undefined"
                    >
                        <PageToolbar
                            v-if="hasToolbar"
                            v-bind="toolbarProps"
                            v-model:search="searchModel"
                            @tab-click="onTabClick"
                            @back="onBack"
                            @filter-click="$emit('filter-click')"
                            @toggle-selecting="toggleSelecting"
                        >
                            <template v-if="$slots.toggles" #toggles><slot name="toggles" /></template>
                            <template v-if="$slots.center" #center><slot name="center" /></template>
                            <template v-if="$slots.actions" #actions><slot name="actions" /></template>
                        </PageToolbar>
                        <EmptyBlock v-if="empty || listEmpty">
                            <p class="dp-empty-title">
                                <slot name="empty-title">{{ emptyTitle }}</slot>
                            </p>
                            <p
                                v-if="$slots['empty-sub'] || emptySub"
                                class="dp-empty-sub"
                            >
                                <slot name="empty-sub">{{ emptySub }}</slot>
                            </p>
                            <slot name="empty-cta" />
                        </EmptyBlock>
                        <ListSourceRenderer
                            v-else-if="isListMode && listSource"
                            :source="listSource"
                            :mode="paginationMode"
                            :key-of="itemKeyResolver"
                            :grid-class="gridClass"
                            :size-options="pageSizeOptions"
                            :group-by="groupBy"
                        >
                            <template #item="{item}">
                                <slot
                                    name="item"
                                    :item="item"
                                    :selecting="selecting"
                                    :selected="isSelected(item)"
                                    :toggle-select="() => toggleSelect(item)"
                                />
                            </template>
                            <template
                                v-if="$slots['group-header']"
                                #group-header="{group, count}"
                            >
                                <slot
                                    name="group-header"
                                    :group="group"
                                    :count="count"
                                />
                            </template>
                        </ListSourceRenderer>
                        <slot v-else />
                    </GlassShell>
                </Transition>
            </div>
        </ErrorBoundary>

        <!-- ═══ MODALS (slot) ═══ -->
        <!-- Own boundary: a modal render error shows a fallback instead of
             taking down the page. Every page's modals inherit this. -->
        <ErrorBoundary>
            <slot name="modals" />
        </ErrorBoundary>

        <Transition name="pt-fade">
            <SelectionBar
                v-if="selectable && selecting"
                :count="selectedCount"
                :all-selected="allSelected"
                @select-all="selectAll"
                @clear="clearSelection"
                @done="toggleSelecting"
            >
                <slot
                    name="bulk-actions"
                    :selected="[...selectedKeys]"
                    :selected-items="selectedItems"
                    :count="selectedCount"
                    :clear="clearSelection"
                />
            </SelectionBar>
        </Transition>
    </div>
</template>

<script setup lang="ts" generic="T">
import '@/styles/device-page.css';
import {computed, type Ref, ref, useSlots, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import GlassShell from '@/components/core/GlassShell.vue';
import PageTopMenu from '@/components/core/PageTopMenu.vue';
import ListSourceRenderer from '@/components/core/pageTemplate/ListSourceRenderer.vue';
import PageToolbar from '@/components/core/pageTemplate/PageToolbar.vue';
import SelectionBar from '@/components/core/SelectionBar.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import type {
    FetchPage,
    UseListSource
} from '@/composables/useListSource';
import {useListSource} from '@/composables/useListSource';
import {useReactiveListSource} from '@/composables/useReactiveListSource';
import type {PageScope} from '@/composables/useUniversalSearch';
import {FLEET_MANAGER_HTTP} from '@/constants';
import {sectionForPath} from '@/helpers/sections';
import type {RouteTab, StatItem} from '@/types/page-template';

const props = withDefaults(
    defineProps<{
        /** Page title shown in the default title slot. */
        title: string;
        /** Short count string shown beside the title (backwards-compat with PageLayout). */
        count?: string | number;
        /** Structured stats rendered as a chip row under the title. */
        stats?: StatItem[];
        /** Route tabs rendered as an animated slider below the header. */
        tabs?: RouteTab[];
        /** When set, a back arrow is shown before the title and navigates here
         *  (e.g. a drill-down detail page returning to its hub). */
        back?: string;
        /** Override which tab is highlighted. Use for detail pages that live
         *  outside the tab set but conceptually belong to a tab (e.g. the
         *  Investigate drill-downs highlight the Investigate tab instead of
         *  defaulting to the first tab). */
        activePath?: string;
        /** Mount <UniversalSearch> in the header center slot. */
        searchable?: boolean;
        /** Placeholder for the centered search. */
        searchPlaceholder?: string;
        /** Scope passed to UniversalSearch (preferred name). */
        searchScope?: PageScope<T>;
        /** Scope passed to UniversalSearch (backwards-compat alias from PageLayout). */
        scope?: PageScope<T>;
        /** Show the filter funnel inside the search pill. */
        filterable?: boolean;
        /** Indicates an active filter is applied (tints the funnel). */
        hasActiveFilter?: boolean;
        /** Badge count shown on the filter funnel. */
        filterCount?: number;
        /** Render skeleton state inside the content panel. */
        loading?: boolean;
        /** Number of skeleton placeholders when loading. */
        skeletonCount?: number;
        /** Skeleton shape variant. */
        skeletonVariant?: 'card' | 'row' | 'text' | 'rect';
        /** CSS class for the skeleton grid wrapper. */
        skeletonGrid?: string;
        /** Render empty-state in the content panel. */
        empty?: boolean;
        /** Empty-state heading text. */
        emptyTitle?: string;
        /** Empty-state sub-heading text. */
        emptySub?: string;
        /** Skip the auto-wrap so the page owns its content surfaces. */
        bare?: boolean;
        /** Make the auto-wrap shell fill the viewport — content scrolls
         * inside, header stays sticky. Use for long-content lists. */
        fill?: boolean;
        /** Async page fetcher. Switches the template into list mode. */
        fetchPage?: FetchPage<T>;
        /** Reactive in-memory items. Alternative to fetchPage. */
        items?: readonly T[];
        pageSize?: number;
        paginationMode?: 'pages' | 'infinite';
        /** Query-key prefix for URL sync (null disables). */
        urlKey?: string | null;
        itemKey?: (item: T) => string | number;
        gridClass?: string;
        pageSizeOptions?: number[];
        /** Opt in to multi-select: shows a Select toggle + bulk-action bar. */
        selectable?: boolean;
        /** Optional section label per item — renders grouped sections while
         *  keeping the single key-based selection. */
        groupBy?: (item: T) => string;
    }>(),
    {
        count: undefined,
        stats: () => [],
        tabs: () => [],
        loading: false,
        searchable: false,
        searchPlaceholder: 'Search…',
        searchScope: undefined,
        scope: undefined,
        filterable: false,
        hasActiveFilter: false,
        filterCount: undefined,
        skeletonCount: 6,
        skeletonVariant: 'card',
        skeletonGrid: 'dc-grid',
        empty: false,
        emptyTitle: '',
        emptySub: '',
        bare: false,
        fill: false,
        fetchPage: undefined,
        items: undefined,
        pageSize: 50,
        paginationMode: 'pages',
        urlKey: null,
        itemKey: undefined,
        gridClass: 'dc-grid',
        pageSizeOptions: () => [25, 50, 100, 200],
        selectable: false
    }
);

const emit = defineEmits<{
    'update:search': [value: string];
    'filter-click': [];
    'tab-click': [path: string];
}>();

const searchModel = defineModel<string>('search', {default: ''});

type ListInput<T> =
    | {kind: 'fetch'; fetchPage: FetchPage<T>}
    | {kind: 'items'; items: Ref<readonly T[]>}
    | {kind: 'none'};

const listInput: ListInput<T> = props.fetchPage
    ? {kind: 'fetch', fetchPage: props.fetchPage}
    : props.items !== undefined
      ? {
            kind: 'items',
            items: computed<readonly T[]>(() => props.items ?? [])
        }
      : {kind: 'none'};

// fetchPage or items → template owns list state and controls.
const listSource =
    listInput.kind === 'fetch'
        ? (useListSource<T>(listInput.fetchPage, {
              pageSize: props.pageSize,
              mode: props.paginationMode,
              search: searchModel,
              urlKey: props.urlKey
          }) as UseListSource<T>)
        : listInput.kind === 'items'
          ? (useReactiveListSource<T>(listInput.items, {
                pageSize: props.pageSize,
                mode: props.paginationMode
            }) as UseListSource<T>)
          : null;

const isListMode = computed(() => listSource !== null);
const listEmpty = computed(
    () =>
        listSource !== null &&
        !listSource.loading.value &&
        listSource.pageItems.value.length === 0 &&
        listSource.page.value === 1
);
const itemKeyResolver = computed(() => {
    if (props.itemKey) return props.itemKey;
    return (item: T) => {
        const id = (item as {id?: unknown}).id;
        return typeof id === 'string' || typeof id === 'number'
            ? id
            : String(item);
    };
});

const selecting = ref(false);
const selectedKeys = ref<Set<string | number>>(new Set());

const visibleItems = computed<readonly T[]>(() =>
    listSource ? listSource.pageItems.value : (props.items ?? [])
);

function keyOf(item: T): string | number {
    return itemKeyResolver.value(item);
}
function isSelected(item: T): boolean {
    return selectedKeys.value.has(keyOf(item));
}
function toggleSelect(item: T): void {
    const next = new Set(selectedKeys.value);
    const k = keyOf(item);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    selectedKeys.value = next;
}
const selectedItems = computed<T[]>(() =>
    visibleItems.value.filter((it) => selectedKeys.value.has(keyOf(it)))
);
const selectedCount = computed(() => selectedKeys.value.size);
const allSelected = computed(
    () =>
        visibleItems.value.length > 0 &&
        visibleItems.value.every((it) => selectedKeys.value.has(keyOf(it)))
);
function selectAll(): void {
    const next = new Set<string | number>();
    for (const it of visibleItems.value) next.add(keyOf(it));
    selectedKeys.value = next;
}
function clearSelection(): void {
    selectedKeys.value = new Set();
}
function toggleSelecting(): void {
    selecting.value = !selecting.value;
    if (!selecting.value) clearSelection();
}

defineExpose({listSource, isListMode});

// Parent can swap fetchPage to re-run with new filter state.
watch(
    () => props.fetchPage,
    () => {
        if (listSource) void listSource.refresh();
    }
);

const route = useRoute();

// The header shows the section name (stable while tabbing between its nested
// pages); the per-page `title` is the fallback for routes outside a section.
const headerTitle = computed(
    () => sectionForPath(route.path)?.title ?? props.title
);
const router = useRouter();

// Accept either `search-scope` (preferred) or `scope` (backwards-compat with PageLayout).
const effectiveScope = computed(() => props.searchScope ?? props.scope);

const slots = useSlots();

// Only render the glass toolbar when it carries module controls — never an empty bar.
const hasToolbar = computed(
    () =>
        props.searchable ||
        props.selectable ||
        props.tabs.length > 0 ||
        Boolean(slots.center) ||
        Boolean(slots.toggles) ||
        Boolean(slots.actions)
);

// Props bundled for <PageToolbar>, which renders inside whichever content
// surface is active (skeleton / bare / content) — same glass, no duplicate markup.
const toolbarProps = computed(() => ({
    tabs: props.tabs,
    back: props.back,
    activeTabIndex: activeTabIndex.value,
    searchable: props.searchable,
    searchPlaceholder: props.searchPlaceholder,
    scope: effectiveScope.value,
    filterable: props.filterable,
    hasActiveFilter: props.hasActiveFilter,
    filterCount: props.filterCount,
    selectable: props.selectable,
    selecting: selecting.value
}));

const activeTabIndex = computed(() => {
    // `activePath` lets a page outside the tab set claim a tab (e.g. the
    // Investigate drill-downs). Otherwise match the current route.
    const matchPath = props.activePath ?? route.path;
    // Prefer exact match; fall back to longest-prefix so nested routes
    // (e.g. /operations/device-auth/pushes) highlight their parent tab.
    const exact = props.tabs.findIndex((t) => t.path === matchPath);
    if (exact >= 0) return exact;
    let bestIdx = -1;
    let bestLen = 0;
    props.tabs.forEach((t, idx) => {
        if (matchPath.startsWith(`${t.path}/`) && t.path.length > bestLen) {
            bestIdx = idx;
            bestLen = t.path.length;
        }
    });
    return bestIdx >= 0 ? bestIdx : 0;
});

function onBack() {
    if (!props.back) return;
    // Prefer real history so multi-parent drill-downs return to where the user
    // actually came from; fall back to the declared parent on a fresh/deep load.
    const hasHistory = Boolean(
        (router.options.history.state as {back?: unknown} | null)?.back
    );
    if (hasHistory) router.back();
    else void router.push(props.back);
}

function onTabClick(tab: RouteTab) {
    emit('tab-click', tab.path);
    if (tab.external) {
        window.open(externalTabUrl(tab.path), '_blank', 'noopener,noreferrer');
        return;
    }
    if (tab.path !== route.path) void router.push(tab.path);
}

function externalTabUrl(path: string): string {
    if (path.startsWith('/api/')) {
        return new URL(path, `${FLEET_MANAGER_HTTP}/`).toString();
    }
    return path;
}
</script>

<style scoped>
.pt-root {
    min-height: 100%;
    display: flex;
    flex-direction: column;
}
.pt-root--fill {
    height: 100%;
    min-height: 0;
}

.pt-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    min-height: 0;
    padding-left: var(--gap-xs);
    padding-right: var(--gap-xs);
}

/* ── Top bar — title block (left) + user/settings menu (right) ── */
.pt-topbar {
    display: flex;
    align-items: flex-start;
    gap: var(--gap-md);
    padding: var(--gap-sm) var(--gap-md) 0;
}
.pt-topbar .dp-header__left {
    flex: 1 1 auto;
}
.pt-topbar__menu {
    flex: 0 0 auto;
    align-self: center;
}

/* Margin only — GlassShell owns its own flex (fill | content-sized). */
.pt-content {
    margin: 0 var(--gap-md) 0;
}
/* Bare mode — caller renders its own surfaces and owns the scroll viewport. */
.pt-content--bare {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    margin: var(--gap-sm) var(--gap-md) 0;
}

/* Loading fade */
.pt-fade-enter-active,
.pt-fade-leave-active {
    transition: opacity var(--duration-normal) ease;
}
.pt-fade-enter-from,
.pt-fade-leave-to {
    opacity: 0;
}

@media (max-width: 768px) {
    .pt-content { margin: var(--gap-sm) var(--gap-md) 0; }
}

</style>
