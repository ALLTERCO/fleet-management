<template>
    <div class="plc">
        <div v-if="error" class="plc__error" role="alert">
            <i class="fas fa-circle-exclamation" aria-hidden="true" />
            <span>{{ errorMessage }}</span>
            <button type="button" class="plc__retry" @click="$emit('retry')">
                Retry
            </button>
        </div>
        <div class="plc__range">
            <span v-if="total !== null">
                {{ formattedRange }} of {{ formatNumber(total) }}
            </span>
            <span v-else>{{ formattedRange }}</span>
        </div>
        <div class="plc__nav">
            <button
                type="button"
                class="plc__btn"
                :disabled="page === 1 || loading"
                aria-label="First page"
                @click="$emit('go', 1)"
            >
                <i class="fas fa-angles-left" />
            </button>
            <button
                type="button"
                class="plc__btn"
                :disabled="page === 1 || loading"
                aria-label="Previous page"
                @click="$emit('go', page - 1)"
            >
                <i class="fas fa-angle-left" />
            </button>
            <span class="plc__page">
                Page <b>{{ page }}</b>
                <template v-if="pageCount > 0">/ {{ pageCount }}</template>
            </span>
            <button
                type="button"
                class="plc__btn"
                :disabled="!canNext || loading"
                aria-label="Next page"
                @click="$emit('go', page + 1)"
            >
                <i class="fas fa-angle-right" />
            </button>
            <button
                type="button"
                class="plc__btn"
                :disabled="!canLast || loading"
                aria-label="Last page"
                @click="$emit('go', pageCount)"
            >
                <i class="fas fa-angles-right" />
            </button>
        </div>
        <label class="plc__size">
            <span>Rows</span>
            <select
                :value="pageSize"
                :disabled="loading"
                @change="
                    $emit(
                        'size',
                        Number(($event.target as HTMLSelectElement).value)
                    )
                "
            >
                <option v-for="opt in sizeOptions" :key="opt" :value="opt">
                    {{ opt }}
                </option>
            </select>
        </label>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(
    defineProps<{
        page: number;
        pageSize: number;
        pageCount: number;
        total: number | null;
        renderedOnPage: number;
        loading: boolean;
        hasMore: boolean;
        error: unknown;
        sizeOptions?: number[];
    }>(),
    {sizeOptions: () => [25, 50, 100, 200]}
);

defineEmits<{
    go: [page: number];
    size: [size: number];
    retry: [];
}>();

const errorMessage = computed(() => {
    if (props.error instanceof Error) return props.error.message;
    return 'Could not load this page.';
});

const canNext = computed(() => {
    if (props.pageCount > 0) return props.page < props.pageCount;
    return props.hasMore || props.renderedOnPage === props.pageSize;
});
const canLast = computed(() => props.pageCount > 0 && props.page < props.pageCount);

const formattedRange = computed(() => {
    if (props.renderedOnPage === 0) return '0';
    const start = (props.page - 1) * props.pageSize + 1;
    const end = start + props.renderedOnPage - 1;
    return `${formatNumber(start)}–${formatNumber(end)}`;
});

function formatNumber(n: number): string {
    return n.toLocaleString();
}
</script>

<style scoped>
.plc {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}
.plc__range {
    font-variant-numeric: tabular-nums;
}
.plc__nav {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}
.plc__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: var(--radius-md);
    background: transparent;
    border: 1px solid transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: background var(--duration-fast) ease;
}
.plc__btn:hover:not(:disabled) {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}
.plc__btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
.plc__page {
    min-width: 6rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
}
.plc__size {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}
.plc__size select {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}
</style>
