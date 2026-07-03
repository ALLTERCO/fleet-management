<template>
    <img
        v-if="group.imageAssetId"
        :src="group.imageAssetId"
        :alt="group.name"
        class="gg gg--image"
    />
    <i
        v-else
        :class="['gg', 'gg--icon', group.visual?.icon || 'fas fa-layer-group']"
        :style="group.visual?.accent ? {color: `rgb(var(--accent-${group.visual.accent}))`} : undefined"
        :aria-label="group.name"
    />
</template>

<script setup lang="ts">
// Single home for "how do I draw this group's avatar". Image wins over
// icon; falls back to fa-layer-group when no decoration is set.

defineProps<{
    group: {
        name: string;
        imageAssetId?: string | null;
        visual?: {icon?: string; accent?: string};
    };
}>();
</script>

<style scoped>
.gg {
    flex-shrink: 0;
}
.gg--icon {
    font-size: 1em;
    color: var(--color-text-secondary);
    line-height: 1;
}
/* Material Design Icons hardcode a 24px glyph via @mdi/font, so picked (mdi)
   icons don't grow with the avatar the way the FontAwesome fallback does.
   Make the glyph scale with font-size so default and picked icons match. */
.gg--icon.mdi::before {
    font-size: inherit;
    line-height: inherit;
}
.gg--image {
    width: 1em;
    height: 1em;
    border-radius: var(--radius-xs);
    object-fit: contain;
    vertical-align: middle;
}
</style>
