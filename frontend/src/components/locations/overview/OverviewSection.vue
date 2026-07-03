<template>
    <section class="ov-section">
        <header v-if="title" class="ov-section__hdr">
            <i v-if="icon" :class="['fas', icon, 'ov-section__icon']" aria-hidden="true" />
            <h3 class="ov-section__title">{{ title }}</h3>
            <span v-if="hint" class="ov-section__hint">{{ hint }}</span>
        </header>
        <div class="ov-section__body">
            <slot />
        </div>
    </section>
</template>

<script setup lang="ts">
defineProps<{
    title?: string;
    icon?: string;
    hint?: string;
}>();
</script>

<style scoped>
.ov-section {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
}

.ov-section__hdr {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
}

.ov-section__icon {
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-sm);
}

.ov-section__title {
    margin: 0;
    font-size: var(--type-subheading);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
    flex: 1;
    min-width: 0;
}

.ov-section__hint {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.ov-section__body {
    min-width: 0;
}
</style>
