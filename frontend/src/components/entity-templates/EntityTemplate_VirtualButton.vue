<template>
    <div class="et-vbtn">
        <button
            v-if="canExecute"
            class="et-vbtn__trigger"
            :disabled="pressing"
            @click="press"
        >
            <i v-if="pressing" class="fas fa-spinner fa-spin" />
            <i v-else class="fas fa-circle-dot" />
            <span>Press</span>
        </button>
        <div v-else class="et-vbtn__readonly">
            <i class="fas fa-circle-dot" />
            <span>Button (read-only)</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import {onBeforeUnmount, ref} from 'vue';

defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
}>();

const emit = defineEmits<{
    press: [];
}>();

const pressing = ref(false);
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function press() {
    pressing.value = true;
    emit('press');
    if (releaseTimer !== undefined) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
        pressing.value = false;
        releaseTimer = undefined;
    }, 1000);
}

onBeforeUnmount(() => {
    if (releaseTimer !== undefined) clearTimeout(releaseTimer);
});
</script>

<style scoped>
.et-vbtn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
}
.et-vbtn__trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-6);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 15%, transparent);
    color: var(--color-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}
.et-vbtn__trigger:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-primary) 25%, transparent);
}
.et-vbtn__trigger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
.et-vbtn__readonly {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    color: var(--color-text-disabled);
    font-size: var(--type-body);
}
</style>
