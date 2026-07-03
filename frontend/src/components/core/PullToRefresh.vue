<template>
    <div ref="rootEl" class="ptr">
        <div
            v-if="pullDistance > 0 || refreshing"
            class="ptr__indicator"
            :style="{transform: `translateY(${Math.min(pullDistance, threshold * 1.4)}px)`}"
        >
            <i
                class="fas"
                :class="refreshing ? 'fa-rotate fa-spin' : 'fa-arrow-down'"
                :style="{
                    transform: !refreshing && pullDistance >= threshold
                        ? 'rotate(180deg)'
                        : undefined
                }"
            />
        </div>
        <slot />
    </div>
</template>

<script setup lang="ts">
import {ref} from 'vue';
import {usePullToRefresh} from '@/composables/usePullToRefresh';

const props = defineProps<{
    onRefresh: () => Promise<void> | void;
}>();

const rootEl = ref<HTMLElement | null>(null);
const {pullDistance, refreshing, threshold} = usePullToRefresh(rootEl, () =>
    props.onRefresh()
);
</script>

<style scoped>
.ptr {
    position: relative;
    height: 100%;
    overflow-y: auto;
    overscroll-behavior-y: contain;
}
.ptr__indicator {
    position: absolute;
    top: 0;
    left: 50%;
    margin-left: calc(-1 * var(--space-5));
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
    z-index: 1;
    transition: transform var(--duration-fast) ease;
}
</style>
