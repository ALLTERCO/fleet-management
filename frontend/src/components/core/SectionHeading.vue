<template>
    <div class="sh">
        <i v-if="icon" :class="icon" class="sh__icon" />
        <h3 class="sh__label"><slot /></h3>
        <span v-if="$slots.meta" class="sh__meta">
            <slot name="meta" />
        </span>
        <span v-if="$slots.action" class="sh__action">
            <slot name="action" />
        </span>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    /** FontAwesome icon class, e.g. 'fas fa-bolt'. */
    icon?: string;
}>();
</script>

<style scoped>
.sh {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    margin-top: var(--gap-md);
    margin-bottom: var(--gap-xs);
}
.sh__icon {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.sh__label {
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0;
}
.sh__meta {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
}
.sh__action {
    margin-left: auto;
}
</style>
