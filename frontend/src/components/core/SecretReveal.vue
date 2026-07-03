<template>
    <div class="secret-reveal">
        <p class="secret-reveal__warn">
            <i class="fas fa-triangle-exclamation" aria-hidden="true" />
            {{ warning }}
        </p>
        <div class="secret-reveal__key">
            <code>{{ token }}</code>
            <Button type="blue-hollow" size="sm" @click="$emit('copy')">
                <i class="fas fa-copy" aria-hidden="true" /> {{ copyLabel }}
            </Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';

// One-time secret display: a shown-once warning plus the value in a copyable
// monospace box. Surrounding chrome (titles, metadata) is the caller's.
withDefaults(
    defineProps<{token: string; warning?: string; copyLabel?: string}>(),
    {warning: "This key won't be shown again.", copyLabel: 'Copy'}
);

defineEmits<{copy: []}>();
</script>

<style scoped>
.secret-reveal {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    width: 100%;
}
.secret-reveal__warn {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    margin: 0;
    color: var(--color-warning-text);
    font-size: var(--type-caption);
}
.secret-reveal__key {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-md);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
}
.secret-reveal__key code {
    flex: 1;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--color-text-primary);
    white-space: nowrap;
}
</style>
