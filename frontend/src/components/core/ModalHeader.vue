<template>
    <header class="mh">
        <div class="mh__title-row">
            <span v-if="icon" class="mh__icon" aria-hidden="true">
                <i :class="`fas ${icon}`" />
            </span>
            <h2 class="mh__title">
                <slot name="title">{{ title }}</slot>
            </h2>
            <span v-if="$slots.badge" class="mh__badge">
                <slot name="badge" />
            </span>
        </div>
        <p v-if="description || $slots.description" class="mh__desc">
            <slot name="description">{{ description }}</slot>
        </p>
    </header>
</template>

<script setup lang="ts">
// Single source of truth for modal headers across the app.
// Weight + color build hierarchy — size stays on the 4-step golden scale.
defineProps<{
    icon?: string;
    title?: string;
    description?: string;
}>();
</script>

<style scoped>
.mh {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.mh__title-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
}

.mh__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    flex-shrink: 0;
    background: color-mix(
        in srgb,
        var(--color-primary) 14%,
        transparent
    );
    color: var(--color-primary-text);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
}

/* Title steps up to --type-subheading (26 px) so it clearly outranks the
   16 px description; weight + colour reinforce the hierarchy. */
.mh__title {
    margin: 0;
    font-size: var(--type-subheading);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    line-height: 1.3;
    letter-spacing: var(--tracking-tight);
    word-break: break-word;
}

.mh__badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}

.mh__desc {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-normal);
    color: var(--color-text-tertiary);
    line-height: 1.5;
    max-width: 72ch;
}
</style>
