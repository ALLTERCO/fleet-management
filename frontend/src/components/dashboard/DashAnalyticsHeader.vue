<template>
    <div class="dah">
        <div class="dah__title">
            <h1 class="dah__h1">{{ title }}</h1>
            <p v-if="subtitle" class="dah__sub">{{ subtitle }}</p>
        </div>
        <div v-if="$slots.filters" class="dah__filters">
            <slot name="filters" />
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{title: string; subtitle?: string}>();
</script>

<style scoped>
.dah {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
}
.dah__title {
    min-width: 0;
}
.dah__h1 {
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
}
.dah__sub {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.dah__filters {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
}
</style>
