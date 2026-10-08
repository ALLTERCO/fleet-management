<template>
    <button
        type="button"
        class="copy-btn"
        :class="{'copy-btn--done': copied}"
        :title="copied ? 'Copied' : title"
        :aria-label="copied ? 'Copied' : title"
        @click="copy"
    >
        <i :class="copied ? 'fas fa-check' : 'fas fa-copy'" aria-hidden="true" />
        <span v-if="label" class="copy-btn__label">{{ copied ? 'Copied' : label }}</span>
    </button>
</template>

<script setup lang="ts">
import {onUnmounted, ref} from 'vue';

const props = withDefaults(
    defineProps<{text: string; label?: string; title?: string}>(),
    {title: 'Copy'}
);

// Shared clipboard button: one green, animated confirmation everywhere, so no
// component reinvents the copy-and-flash-check pattern.
const DONE_MS = 1600;
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

async function copy() {
    if (!(await writeClipboard(props.text))) return;
    copied.value = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        copied.value = false;
    }, DONE_MS);
}

async function writeClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Insecure-context / permission fallback.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    }
}

onUnmounted(() => {
    if (timer) clearTimeout(timer);
});
</script>

<style scoped>
.copy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    min-width: var(--touch-target-min);
    height: var(--touch-target-min);
    padding: 0 var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition:
        color var(--duration-fast),
        border-color var(--duration-fast),
        background var(--duration-fast);
}
.copy-btn:hover {
    background: var(--color-surface-3);
    border-color: var(--color-border-strong);
    color: var(--color-text-secondary);
}
.copy-btn--done {
    color: var(--color-status-on);
    border-color: rgba(var(--color-status-on-rgb), 0.4);
    background: rgba(var(--color-status-on-rgb), 0.12);
}
.copy-btn--done i {
    animation: copy-pop var(--duration-normal) ease-out;
}
.copy-btn__label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}
@keyframes copy-pop {
    0% {
        transform: scale(0.6);
        opacity: 0.4;
    }
    60% {
        transform: scale(1.15);
    }
    100% {
        transform: scale(1);
        opacity: 1;
    }
}
@media (prefers-reduced-motion: reduce) {
    .copy-btn--done i {
        animation: none;
    }
}
</style>
