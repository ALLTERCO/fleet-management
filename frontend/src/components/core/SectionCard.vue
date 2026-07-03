<template>
    <section class="sc">
        <header class="sc__hdr">
            <div class="sc__hdr-text">
                <h3 class="sc__title">{{ title }}</h3>
                <p v-if="hint" class="sc__hint">{{ hint }}</p>
            </div>
            <div v-if="$slots.aside" class="sc__aside">
                <slot name="aside" />
            </div>
        </header>

        <div class="sc__body">
            <slot />
        </div>
    </section>
</template>

<script setup lang="ts">
defineProps<{
    title: string;
    hint?: string;
}>();
</script>

<style scoped>
.sc {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    background-color: var(--glass-1-bg);
    backdrop-filter: var(--glass-1-filter);
    -webkit-backdrop-filter: var(--glass-1-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-xl);
    box-shadow: inset 0 1px 0 var(--glass-highlight);
    overflow: hidden;
}

.sc__hdr {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}

.sc__hdr-text {
    flex: 1;
    min-width: 0;
}

.sc__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    letter-spacing: 0.02em;
}

.sc__hint {
    margin: var(--space-0-5) 0 0;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
}

.sc__aside {
    display: flex;
    align-items: center;
    flex-shrink: 0;
}

.sc__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
</style>
