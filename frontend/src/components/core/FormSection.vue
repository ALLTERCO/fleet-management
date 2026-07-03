<template>
    <section class="form-section">
        <header class="form-section__head">
            <i v-if="icon" :class="icon" aria-hidden="true" />
            <span>{{ title }}</span>
            <span v-if="badge" class="form-section__badge">{{ badge }}</span>
        </header>
        <slot />
    </section>
</template>

<script setup lang="ts">
// A titled card that groups related form fields inside a modal.
defineProps<{
    icon?: string;
    title: string;
    badge?: string;
}>();
</script>

<style scoped>
.form-section {
    display: grid;
    gap: var(--gap-md);
    padding: var(--gap-md);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
}
.form-section__head {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.form-section__head i {
    color: var(--color-primary-text);
}
.form-section__badge {
    margin-left: auto;
    font-weight: var(--font-regular);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
}
</style>
