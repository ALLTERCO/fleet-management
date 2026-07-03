<template>
    <div class="empty-block">
        <div class="empty-block__inner">
            <!-- Icon slot — defaults to a generic compass-icon if a page
                 doesn't supply its own. Pages should pass a category-specific
                 icon (e.g. fa-microchip for devices) for better recognition. -->
            <div class="empty-block__icon">
                <slot name="icon">
                    <i class="fas fa-compass" />
                </slot>
            </div>

            <!-- Title slot — primary message. Falls back to `title` prop. -->
            <h3 v-if="$slots.title || title" class="empty-block__title">
                <slot name="title">{{ title }}</slot>
            </h3>

            <!-- Description slot — short copy explaining what this list is
                 and how to populate it. Falls back to `description` prop. -->
            <p
                v-if="$slots.description || description"
                class="empty-block__desc"
            >
                <slot name="description">{{ description }}</slot>
            </p>

            <!-- Default slot — legacy fallback for callers that pass markup
                 directly (e.g. <EmptyBlock><p>...</p></EmptyBlock>). -->
            <div v-if="$slots.default" class="empty-block__body">
                <slot />
            </div>

            <!-- Action slot — primary call-to-action button(s). -->
            <div v-if="$slots.action" class="empty-block__action">
                <slot name="action" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
withDefaults(
    defineProps<{
        title?: string;
        description?: string;
    }>(),
    {
        title: '',
        description: ''
    }
);
</script>

<style scoped>
/* No own surface — sits inside whatever glass shell renders the empty state. */
.empty-block {
    width: 100%;
    min-height: 16rem;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
}
.empty-block__inner {
    max-width: 28rem;
    width: 100%;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
}
.empty-block__icon {
    font-size: var(--type-heading);
    color: var(--color-text-tertiary);
    opacity: 0.55;
    line-height: 1;
}
.empty-block__title {
    margin: 0;
    font-size: var(--type-subheading);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    line-height: var(--leading-tight);
}
.empty-block__desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
    max-width: var(--prose-max-width);
}
.empty-block__body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
}
.empty-block__action {
    margin-top: var(--space-2);
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    justify-content: center;
}
</style>
