<template>
    <div class="ihd">
        <button
            type="button"
            class="ihd__trigger"
            :aria-expanded="open"
            @click="toggle"
        >
            <i class="fa-solid fa-circle-question" aria-hidden="true" />
            <span class="ihd__question">{{ question }}</span>
            <i
                class="fa-solid ihd__chevron"
                :class="open ? 'fa-chevron-up' : 'fa-chevron-down'"
                aria-hidden="true"
            />
        </button>

        <Transition name="ihd-fade">
            <div v-if="open" class="ihd__body">
                <slot />
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import {ref} from 'vue';

defineProps<{
    question: string;
}>();

const open = ref(false);

function toggle(): void {
    open.value = !open.value;
}
</script>

<style scoped>
.ihd {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.ihd__trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    cursor: pointer;
    align-self: flex-start;
}

.ihd__trigger:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}

.ihd__question {
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 3px;
}

.ihd__chevron {
    font-size: 0.7em;
}

.ihd__body {
    padding: var(--space-3) var(--space-4);
    background-color: var(--color-surface-2);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    line-height: var(--leading-normal);
}

.ihd-fade-enter-active,
.ihd-fade-leave-active {
    transition:
        opacity var(--duration-fast) var(--ease-out-expo),
        transform var(--duration-fast) var(--ease-out-expo);
}

.ihd-fade-enter-from,
.ihd-fade-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
    .ihd-fade-enter-active,
    .ihd-fade-leave-active {
        transition-duration: 0ms;
    }
}
</style>
