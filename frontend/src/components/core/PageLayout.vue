<!--
  @deprecated Use PageTemplate.vue instead.
  PageTemplate is a backwards-compatible superset that adds :tabs, :stats, etc.
  This file will be removed once all callers migrate.
-->
<template>
    <div class="h-full flex flex-col">
        <ErrorBoundary>
            <div class="flex-1 flex flex-col pl-page">
                <header class="dp-header">
                    <div class="dp-header__left">
                        <slot name="title">
                            <h1 class="dp-header__title">{{ title }}</h1>
                            <span
                                v-if="count !== undefined"
                                class="dp-header__count"
                            >
                                {{ count }}
                            </span>
                        </slot>
                        <div v-if="$slots.stats" class="dp-header__stats">
                            <slot name="stats" />
                        </div>
                    </div>
                    <div v-if="searchable || $slots.center" class="dp-header__center">
                        <slot name="center">
                            <FilterPill
                                v-if="searchable"
                                v-model="searchModel"
                                :placeholder="searchPlaceholder"
                                :filterable="filterable"
                                :has-active-filter="hasActiveFilter"
                                :filter-count="filterCount"
                                @filter-click="$emit('filter-click')"
                            />
                        </slot>
                    </div>
                    <div v-if="$slots.actions" class="dp-header__right">
                        <slot name="actions" />
                    </div>
                </header>

                <div v-if="$slots.toggles" class="pl-toggles">
                    <slot name="toggles" />
                </div>

                <slot name="filter-bar" />

                <Transition name="pl-fade">
                    <BasicBlock
                        v-if="loading"
                        key="skeleton"
                        bordered
                        padding="sm"
                        class="flex-1"
                    >
                        <slot name="skeleton">
                            <div :class="skeletonGrid">
                                <Skeleton
                                    v-for="n in skeletonCount"
                                    :key="n"
                                    :variant="skeletonVariant"
                                />
                            </div>
                        </slot>
                    </BasicBlock>
                    <BasicBlock
                        v-else
                        key="content"
                        bordered
                        padding="sm"
                        class="flex-1 overflow-auto"
                        data-scroll-owner="page"
                    >
                        <EmptyBlock v-if="empty">
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
                        <slot v-else />
                    </BasicBlock>
                </Transition>
            </div>
        </ErrorBoundary>

        <slot name="modals" />
    </div>
</template>

<script setup lang="ts">
import '@/styles/device-page.css';
import BasicBlock from '@/components/core/BasicBlock.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import FilterPill from '@/components/core/FilterPill.vue';
import Skeleton from '@/components/core/Skeleton.vue';

withDefaults(
    defineProps<{
        title: string;
        count?: string | number;
        loading?: boolean;
        skeletonCount?: number;
        skeletonVariant?: 'card' | 'row' | 'text' | 'rect';
        skeletonGrid?: string;
        searchable?: boolean;
        searchPlaceholder?: string;
        filterable?: boolean;
        hasActiveFilter?: boolean;
        filterCount?: number;
        empty?: boolean;
        emptyTitle?: string;
        emptySub?: string;
    }>(),
    {
        loading: false,
        skeletonCount: 6,
        skeletonVariant: 'card',
        skeletonGrid: 'dc-grid',
        searchable: false,
        searchPlaceholder: 'Search…',
        filterable: false,
        hasActiveFilter: false,
        empty: false
    }
);

const searchModel = defineModel<string>('search', {default: ''});

defineEmits<{'filter-click': []}>();
</script>

<style scoped>
.pl-page {
    gap: var(--gap-xs);
}
.dp-header__stats {
    margin-top: var(--space-0-5);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.pl-toggles {
    display: flex;
    justify-content: center;
    padding: 0 var(--gap-md);
}
.pl-fade-enter-active,
.pl-fade-leave-active {
    transition: opacity var(--duration-normal, 200ms) ease;
}
.pl-fade-enter-from,
.pl-fade-leave-to {
    opacity: 0;
}
</style>
