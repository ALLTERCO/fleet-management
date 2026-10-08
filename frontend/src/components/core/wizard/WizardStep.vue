<template>
    <div class="wz-step" :data-step="name">
        <p v-if="lede" class="wz-step__lede">{{ lede }}</p>
        <slot />
    </div>
</template>

<script setup lang="ts">
// The step rail already names the step. The lede says what to do in it, so a
// step never repeats its own title as a heading.
// `name` is the step's stable identity for tests and for the scroller — a class
// used as an identity hook disappears the moment the styling changes.
defineProps<{name: string; lede?: string}>();
</script>

<style scoped>
.wz-step {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    min-height: 0;
}

.wz-step__lede {
    margin: 0;
    max-width: var(--wizard-lede-width);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    line-height: var(--leading-snug);
}
</style>
