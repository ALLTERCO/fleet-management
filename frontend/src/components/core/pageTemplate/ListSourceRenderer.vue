<template>
    <div class="lsr">
        <!-- Grouped: visual sections sharing the same key-based selection. -->
        <template v-if="groups">
            <div v-for="group in groups" :key="group.key" class="lsr__group">
                <slot name="group-header" :group="group.key" :count="group.items.length">
                    <div class="lsr__group-hdr">
                        <span class="lsr__group-name">{{ group.key }}</span>
                        <span class="lsr__group-count">{{ group.items.length }}</span>
                    </div>
                </slot>
                <div :class="['lsr__grid', gridClass]">
                    <template v-for="item in group.items" :key="keyOf(item)">
                        <slot name="item" :item="item" />
                    </template>
                </div>
            </div>
        </template>
        <div v-else :class="['lsr__grid', gridClass]">
            <template v-for="item in source.pageItems.value" :key="keyOf(item)">
                <slot name="item" :item="item" />
            </template>
        </div>
        <PagedListControls
            v-if="mode === 'pages'"
            :page="source.page.value"
            :page-size="source.pageSize.value"
            :page-count="source.pageCount.value"
            :total="source.total.value"
            :rendered-on-page="source.pageItems.value.length"
            :loading="source.loading.value"
            :has-more="source.hasMore.value"
            :error="source.error.value"
            :size-options="sizeOptions"
            @go="source.goToPage"
            @size="source.setPageSize"
            @retry="source.refresh"
        />
        <InfiniteSentinel
            v-else
            :loading="source.loading.value"
            :has-more="source.hasMore.value"
            :error="source.error.value"
            @load="source.loadMore"
        />
    </div>
</template>

<script setup lang="ts" generic="T">
import {computed} from 'vue';
import type {UseListSource} from '@/composables/useListSource';
import InfiniteSentinel from './InfiniteSentinel.vue';
import PagedListControls from './PagedListControls.vue';

const props = withDefaults(
    defineProps<{
        source: UseListSource<T>;
        mode: 'pages' | 'infinite';
        keyOf: (item: T) => string | number;
        gridClass?: string;
        sizeOptions?: number[];
        /** Optional section label per item. When set, the page items render
         *  as grouped sections (first-seen order); selection is unaffected
         *  because it stays keyed by keyOf. */
        groupBy?: (item: T) => string;
    }>(),
    {gridClass: 'dc-grid', sizeOptions: () => [25, 50, 100, 200]}
);

// Group the current page's items by label, preserving first-seen order.
const groups = computed(() => {
    if (!props.groupBy) return null;
    const order: string[] = [];
    const byKey = new Map<string, T[]>();
    for (const item of props.source.pageItems.value) {
        const label = props.groupBy(item);
        let bucket = byKey.get(label);
        if (!bucket) {
            bucket = [];
            byKey.set(label, bucket);
            order.push(label);
        }
        bucket.push(item);
    }
    return order.map((key) => ({key, items: byKey.get(key) as T[]}));
});

defineSlots<{
    item(props: {item: T}): unknown;
    'group-header'(props: {group: string; count: number}): unknown;
}>();
</script>

<style scoped>
.lsr {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.lsr__grid {
    /* Content-sized so layout-main's overflow-y picks up overflow.
       Forcing flex:1 here clipped long lists inside non-fill GlassShells. */
}
.lsr__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.lsr__group + .lsr__group {
    margin-top: var(--space-4);
}
.lsr__group-hdr {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.lsr__group-name {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.lsr__group-count {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
</style>
