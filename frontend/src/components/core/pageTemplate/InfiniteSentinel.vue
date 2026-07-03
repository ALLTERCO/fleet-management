<template>
    <div ref="hostRef" class="is-host">
        <div v-if="error" class="is-row is-row--error" role="alert">
            <i class="fas fa-circle-exclamation" aria-hidden="true" />
            <span>{{ errorMessage }}</span>
            <button
                type="button"
                class="is-retry"
                @click="$emit('load')"
            >
                Retry
            </button>
        </div>
        <div v-else-if="loading" class="is-row is-row--loading">
            <Spinner size="sm" />
            <span>Loading more…</span>
        </div>
        <div v-else-if="hasMore" class="is-row">
            <button
                type="button"
                class="is-more"
                aria-label="Load more"
                @click="$emit('load')"
            >
                Load more
            </button>
        </div>
        <div ref="sentinelRef" class="is-sentinel" aria-hidden="true" />
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import Spinner from '@/components/core/Spinner.vue';

const props = defineProps<{
    loading: boolean;
    hasMore: boolean;
    error: unknown;
}>();

const emit = defineEmits<{load: []}>();

const errorMessage = computed(() => {
    if (props.error instanceof Error) return props.error.message;
    return 'Could not load more items.';
});

const hostRef = ref<HTMLElement | null>(null);
const sentinelRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

function resolveScrollOwner(): Element | null {
    return (
        hostRef.value?.closest('[data-scroll-owner="page"]') ?? null
    );
}

function attach(): void {
    if (!sentinelRef.value) return;
    observer?.disconnect();
    observer = new IntersectionObserver(
        (entries) => {
            if (!entries[0]?.isIntersecting) return;
            if (!props.hasMore || props.loading || props.error) return;
            emit('load');
        },
        {
            root: resolveScrollOwner(),
            rootMargin: '0px 0px 400px 0px'
        }
    );
    observer.observe(sentinelRef.value);
}

onMounted(attach);

watch(
    () => [props.hasMore, props.loading, props.error],
    () => {
        if (!observer || !sentinelRef.value) return;
        if (!props.hasMore || props.loading || props.error) return;
        observer.unobserve(sentinelRef.value);
        observer.observe(sentinelRef.value);
    }
);

onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
});
</script>

<style scoped>
.is-host {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    padding: var(--space-3) 0;
}
.is-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.is-row--error {
    color: var(--color-danger-text, var(--color-text-primary));
    background: var(--color-danger-bg, transparent);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-danger);
}
.is-retry {
    margin-left: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-primary);
    cursor: pointer;
}
.is-retry:hover {
    background: var(--color-surface-4);
}
.is-more {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-primary);
    cursor: pointer;
    transition: background var(--duration-fast) ease;
}
.is-more:hover {
    background: var(--color-surface-4);
}
.is-sentinel {
    height: 1px;
}
</style>
