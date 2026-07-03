<template>
    <section class="dps">
        <h4 class="dps__label">{{ label }}</h4>
        <div class="dps__rows" role="group" :aria-label="label">
            <slot />
        </div>
    </section>
</template>

<script setup lang="ts">
defineProps<{label: string}>();
</script>

<style scoped>
.dps {
    padding: var(--space-2) 0;
}

.dps + .dps {
    border-top: 1px solid var(--color-border-default);
    margin-top: var(--space-2);
    padding-top: var(--space-3);
}

.dps__label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-tertiary);
    padding: 0 var(--space-3);
    margin: 0 0 var(--space-1);
}

.dps__rows {
    display: flex;
    flex-direction: column;
}
</style>
