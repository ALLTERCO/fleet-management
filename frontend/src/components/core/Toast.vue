<template>
    <!-- Error toasts use assertive/role=alert so screen readers preempt
         the current narration; non-errors stay polite. -->
    <div class="toast-stack fixed right-4 left-auto bottom-auto w-full max-w-[350px]" style="z-index: var(--z-toast)" :aria-live="hasErrorToast ? 'assertive' : 'polite'" :role="hasErrorToast ? 'alert' : 'status'">
        <Notification
            v-for="toast in toasts"
            v-show="toast.visible"
            :key="toast.id"
            :type="toast.type"
            class="transition-slow"
        >
            <div class="toast-body">
                <span>{{ toast.message }}</span>
                <button
                    v-if="toast.action"
                    class="toast-action"
                    @click="handleAction(toast)"
                >
                    {{ toast.actionLabel || 'Undo' }}
                </button>
            </div>
        </Notification>
    </div>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {computed} from 'vue';
import type {toast_t} from '@/stores/toast';
import {useToastStore} from '@/stores/toast';
import Notification from './Notification.vue';

const toastStore = useToastStore();
const {toasts} = storeToRefs(toastStore);

const hasErrorToast = computed(() =>
    toasts.value.some((t) => t.visible && t.type === 'error')
);

function handleAction(toast: toast_t) {
    toast.action?.();
    toastStore.removeToast(toast);
}
</script>

<style scoped>
/* Respect notch / status-bar inset on mobile. */
.toast-stack {
    top: max(1rem, env(safe-area-inset-top, 0px));
}
.toast-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
}

.toast-action {
    flex-shrink: 0;
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-primary-text);
    background: transparent;
    border: 1px solid var(--color-primary-text);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
        background var(--duration-fast) var(--ease-default),
        color var(--duration-fast) var(--ease-default);
    white-space: nowrap;
    line-height: var(--leading-snug);
}
.toast-action:hover {
    background: var(--color-primary-text);
    color: var(--color-surface-1);
}
</style>
