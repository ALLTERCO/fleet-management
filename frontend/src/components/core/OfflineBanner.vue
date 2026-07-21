<template>
    <Transition name="offline-banner">
        <div v-if="!online" class="offline-banner" role="status" aria-live="polite">
            <i class="fas fa-wifi offline-banner__icon" aria-hidden="true" />
            <span class="offline-banner__text">You're offline — changes will sync when reconnected.</span>
        </div>
    </Transition>
</template>

<script setup lang="ts">
import {useNetworkStatus} from '@/composables/useNetworkStatus';

const {online} = useNetworkStatus();
</script>

<style scoped>
.offline-banner {
    position: fixed;
    top: env(safe-area-inset-top, 0px);
    left: 0;
    right: 0;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--color-status-warn);
    color: var(--color-surface-0);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-align: center;
}
.offline-banner__icon {
    font-size: var(--type-body);
    opacity: 0.9;
}
.offline-banner-enter-active,
.offline-banner-leave-active {
    transition: transform var(--duration-normal) ease,
        opacity var(--duration-normal) ease;
}
.offline-banner-enter-from,
.offline-banner-leave-to {
    transform: translateY(-100%);
    opacity: 0;
}
</style>
