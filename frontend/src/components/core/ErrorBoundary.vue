<template>
    <slot v-if="!error" />
    <div v-else class="error-boundary" role="alert">
        <div class="error-boundary__content">
            <i class="fas fa-exclamation-triangle error-boundary__icon" aria-hidden="true"></i>
            <p class="error-boundary__title">Something went wrong</p>
            <p v-if="errorMessage" class="error-boundary__message">{{ errorMessage }}</p>
            <button class="error-boundary__retry" @click="reset">
                <i class="fas fa-refresh" aria-hidden="true"></i>
                Try again
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {onErrorCaptured, ref} from 'vue';

const error = ref<Error | null>(null);
const errorMessage = ref('');

onErrorCaptured((err: Error) => {
    error.value = err;
    errorMessage.value = err.message || 'An unexpected error occurred.';
    console.error('[ErrorBoundary]', err);
    return false; // prevent propagation
});

function reset() {
    error.value = null;
    errorMessage.value = '';
}
</script>

<style scoped>
.error-boundary {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    padding: var(--space-8);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
}
.error-boundary__content {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
}
.error-boundary__icon {
    font-size: var(--text-2xl);
    color: var(--color-danger);
}
.error-boundary__title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.error-boundary__message {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    max-width: 400px;
}
.error-boundary__retry {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--btn-radius);
    background-color: var(--color-primary);
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
    font-size: var(--text-sm);
    cursor: pointer;
    border: none;
    transition: transform var(--duration-fast) var(--ease-default);
}
.error-boundary__retry:hover {
    opacity: 0.9;
}
.error-boundary__retry:active {
    transform: scale(0.97);
}
</style>
