<template>
    <section class="drr">
        <header class="drr__head">
            <h3 class="drr__title">{{ title }}</h3>
            <div class="drr__actions">
                <button class="drr__btn" @click="expandAll">Expand all</button>
                <button class="drr__btn" @click="collapseAll">Collapse all</button>
            </div>
        </header>

        <details
            v-for="item in items"
            :key="item.id"
            class="drr__row"
            :open="openIds.has(String(item.id))"
            @toggle="onToggle(item.id, ($event.target as HTMLDetailsElement).open)"
        >
            <summary class="drr__summary">
                <span class="drr__chev">
                    <i class="fas fa-chevron-right" />
                </span>
                <span class="drr__label">{{ item.label }}</span>
                <span v-if="item.count != null" class="drr__count">{{ item.count }}</span>
            </summary>
            <div class="drr__body">
                <slot name="row" :item="item" />
            </div>
        </details>
    </section>
</template>

<script setup lang="ts">
import {ref, watch} from 'vue';
import {reseedOpenIds} from '@/helpers/collapsibleRowState';

export interface RowItem {
    id: number | string;
    label: string;
    count?: number;
}

const props = withDefaults(
    defineProps<{
        title: string;
        items: RowItem[];
        defaultExpanded?: boolean;
    }>(),
    {defaultExpanded: false}
);

const initialIds = props.items.map((i) => String(i.id));
const openIds = ref<ReadonlySet<string>>(
    new Set(props.defaultExpanded ? initialIds : [])
);
const seededIds = ref<ReadonlySet<string>>(new Set(initialIds));

// ASCII Unit Separator (0x1F) — illegal in numeric and UUID ids, so two
// distinct id arrays never produce the same joined signature.
const ID_SEP = '\x1F';

watch(
    () => props.items.map((i) => String(i.id)).join(ID_SEP),
    (signature) => {
        const nextIds = signature.length === 0 ? [] : signature.split(ID_SEP);
        openIds.value = reseedOpenIds(
            nextIds,
            seededIds.value,
            openIds.value,
            props.defaultExpanded
        );
        seededIds.value = new Set(nextIds);
    }
);

function onToggle(id: number | string, open: boolean): void {
    const key = String(id);
    const next = new Set(openIds.value);
    if (open) next.add(key);
    else next.delete(key);
    openIds.value = next;
}

function expandAll(): void {
    openIds.value = new Set(props.items.map((i) => String(i.id)));
}

function collapseAll(): void {
    openIds.value = new Set();
}
</script>

<style scoped>
.drr {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    overflow: hidden;
}

.drr__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
}

.drr__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.drr__actions {
    display: flex;
    gap: var(--space-1);
}

.drr__btn {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    border-radius: var(--radius-sm);
    font-size: var(--type-caption);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}

.drr__btn:hover {
    background: var(--glass-hover);
    color: var(--color-text-primary);
}

.drr__row {
    border-bottom: 1px solid var(--color-border-default);
}

.drr__row:last-child {
    border-bottom: none;
}

.drr__summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    list-style: none;
    user-select: none;
    transition: background-color var(--duration-fast) var(--ease-default);
}

.drr__summary::-webkit-details-marker {
    display: none;
}

.drr__summary:hover {
    background: var(--glass-hover);
}

.drr__chev {
    width: var(--icon-size-sm);
    color: var(--color-text-tertiary);
    transition: transform var(--duration-fast) var(--ease-default);
}

.drr__row[open] .drr__chev {
    transform: rotate(90deg);
    color: var(--color-primary);
}

.drr__label {
    flex: 1;
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
}

.drr__count {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    background: var(--color-surface-3);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-sm);
}

.drr__body {
    padding: var(--space-3) var(--space-4) var(--space-4);
    background: var(--color-surface-1);
}
</style>
