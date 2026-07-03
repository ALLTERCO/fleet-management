<template>
    <div class="pt-toolbar">
        <!-- Left: back arrow (optional) + route tabs + toggles -->
        <div class="pt-toolbar__left">
            <button
                v-if="back"
                type="button"
                class="pt-back-btn"
                aria-label="Back"
                title="Back"
                @click="$emit('back')"
            >
                <i class="fas fa-arrow-left" />
            </button>
            <nav
                v-if="tabs.length > 0"
                class="route-tabs"
                :style="{'--slider-count': String(tabs.length)}"
            >
                <div
                    class="route-tabs__track"
                    :style="{transform: `translateX(${activeTabIndex * 100}%)`}"
                />
                <button
                    v-for="(tab, idx) in tabs"
                    :key="tab.path"
                    type="button"
                    class="route-tabs__btn"
                    :class="{'route-tabs__btn--active': idx === activeTabIndex}"
                    @click="$emit('tab-click', tab)"
                >
                    <i
                        v-if="tab.icon"
                        :class="tab.icon"
                    />
                    {{ tab.label }}
                    <span
                        v-if="tab.badge"
                        class="pt-tab__badge"
                    >{{ tab.badge }}</span>
                </button>
            </nav>
            <div
                v-if="$slots.toggles"
                class="pt-toggles"
            >
                <slot name="toggles" />
            </div>
        </div>

        <!-- Center: UniversalSearch. Filter funnel emits filter-click; page opens FilterModal. -->
        <div
            v-if="searchable || $slots.center"
            class="pt-toolbar__center"
        >
            <slot name="center">
                <UniversalSearch
                    v-if="searchable"
                    v-model="search"
                    :scope="scope"
                    :placeholder="searchPlaceholder"
                    :filterable="filterable"
                    :has-active-filter="hasActiveFilter"
                    :filter-count="filterCount"
                    @filter-click="$emit('filter-click')"
                />
            </slot>
        </div>

        <!-- Right: page actions (add, sync, …) first, then the Select toggle. -->
        <div class="pt-toolbar__right">
            <slot name="actions" />
            <Button
                v-if="selectable"
                type="blue-hollow"
                size="sm"
                @click="$emit('toggle-selecting')"
            >
                {{ selecting ? 'Done' : 'Select' }}
            </Button>
        </div>
    </div>
</template>

<script setup lang="ts" generic="T">
import Button from '@/components/core/Button.vue';
import UniversalSearch from '@/components/core/UniversalSearch.vue';
import type {PageScope} from '@/composables/useUniversalSearch';
import type {RouteTab} from '@/types/page-template';

defineProps<{
    tabs: RouteTab[];
    back?: string;
    activeTabIndex: number;
    searchable: boolean;
    searchPlaceholder: string;
    scope?: PageScope<T>;
    filterable: boolean;
    hasActiveFilter: boolean;
    filterCount?: number;
    selectable: boolean;
    selecting: boolean;
}>();

defineEmits<{
    'filter-click': [];
    'tab-click': [tab: RouteTab];
    'toggle-selecting': [];
    back: [];
}>();

const search = defineModel<string>('search', {default: ''});
</script>

<style scoped>
/* Just the controls row — transparent, no surface of its own. It sits at the
   top of the content glass and reads as part of that one container. */
.pt-toolbar {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    margin-bottom: var(--space-4);
}
/* Left and right take their natural (content) width; the search fills and
   centres in the space between them, so side content never overflows into it. */
.pt-toolbar__left {
    flex: 0 1 auto;
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    min-width: 0;
}
.pt-toolbar__center {
    flex: 1 1 auto;
    display: flex;
    justify-content: center;
    min-width: 0;
}
.pt-toolbar__right {
    flex: 0 1 auto;
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    justify-content: flex-end;
    flex-wrap: wrap;
    min-width: 0;
}
.pt-toolbar :deep(.route-tabs__btn) {
    padding: 0 var(--gap-lg);
    font-size: var(--type-body);
}
.pt-toggles {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
/* Back arrow at the left of the toolbar row, aligned with the tab picker. */
.pt-back-btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md, 8px);
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition:
        background-color 0.15s ease,
        color 0.15s ease,
        border-color 0.15s ease;
}
.pt-back-btn:hover {
    background: var(--glass-hover);
    color: var(--color-text-primary);
    border-color: var(--color-primary);
}
/* Size the tab switch to its content — compact for two tabs, wide enough to
   stay readable for many — instead of the fluid stretch (overlapped the search)
   or the 320px cap (squished 5 tabs). The buttons stay equal-width. */
.route-tabs {
    width: fit-content;
    max-width: none;
    overflow: visible;
}
/* Tab buttons clip their content by default; allow the badge to escape so it
   can sit outside the tab switch like the sidebar nav-badge. */
.route-tabs__btn {
    overflow: visible;
}

/* Count overlay poking out of the tab's top-right corner — matches the sidebar
   nav-badge, not an inline label. */
.pt-tab__badge {
    position: absolute;
    top: -7px;
    right: -5px;
    min-width: 16px;
    height: 16px;
    padding: 0 var(--space-1);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    line-height: 1;
    color: var(--color-text-on-danger);
    background: var(--color-danger);
    border-radius: var(--radius-full);
}

/* Stack toolbar controls on their own rows below 1280px — tabs, search and
   actions compete for width on laptops. */
@media (max-width: 1280px) {
    .pt-toolbar {
        flex-direction: column;
        align-items: stretch;
        gap: var(--gap-sm);
    }
    .pt-toolbar__left,
    .pt-toolbar__center,
    .pt-toolbar__right {
        flex: none;
        width: 100%;
    }
    .pt-toolbar__right {
        justify-content: flex-start;
    }
}
</style>
