<template>
    <transition name="reconnect">
        <div
            v-if="phase === 'reconnecting'"
            class="reconnect"
            role="status"
            aria-live="polite"
        >
            <span class="reconnect__dot" aria-hidden="true" />
            <span>Reconnecting to live data…</span>
        </div>
    </transition>
</template>

<script setup lang="ts">
import {useConnectionStatus} from '@/composables/useConnectionStatus';

const {phase} = useConnectionStatus();
</script>

<style scoped>
.reconnect {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    padding: var(--space-1-5) var(--space-4);
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    background: var(--color-status-warn);
    color: var(--color-text-inverse);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    z-index: 7;
    box-shadow: var(--shadow-lg);
}
.reconnect__dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: 50%;
    background: var(--color-text-inverse);
    animation: blink-err 1.2s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
    .reconnect__dot { animation: none; }
}
.reconnect-enter-active,
.reconnect-leave-active {
    transition: transform var(--duration-normal) var(--ease-out-expo),
        opacity var(--duration-normal) var(--ease-out-expo);
}
.reconnect-enter-from,
.reconnect-leave-to {
    transform: translateX(-50%) translateY(-100%);
    opacity: 0;
}
</style>
