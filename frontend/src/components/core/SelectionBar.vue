<template>
    <div class="selbar">
        <span class="selbar__count">{{ count }} selected</span>
        <span class="selbar__sep" />
        <slot />
        <Button
            type="blue-hollow"
            size="sm"
            @click="allSelected ? emit('clear') : emit('select-all')"
        >
            {{ allSelected ? 'Deselect all' : 'Select all' }}
        </Button>
        <Button type="blue-hollow" size="sm" @click="emit('done')">
            Done
        </Button>
    </div>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';

defineProps<{count: number; allSelected: boolean}>();
const emit = defineEmits<{'select-all': []; clear: []; done: []}>();
</script>

<style scoped>
.selbar {
    position: fixed;
    bottom: var(--space-5);
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--glass-4-bg);
    -webkit-backdrop-filter: var(--glass-4-filter);
    backdrop-filter: var(--glass-4-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-full);
    box-shadow: var(--glass-shadow);
}
.selbar__count {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    white-space: nowrap;
    padding-inline: var(--space-1);
}
.selbar__sep {
    width: 1px;
    align-self: stretch;
    min-height: var(--space-5);
    background: var(--color-border-medium);
}
</style>
