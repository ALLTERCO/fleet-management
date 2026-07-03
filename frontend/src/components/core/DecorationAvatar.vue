<template>
    <component
        :is="editable ? 'button' : 'span'"
        :type="editable ? 'button' : undefined"
        class="deco-avatar"
        :class="{'deco-avatar--editable': editable}"
        :style="sizeStyle"
        :aria-label="editable ? editLabel : undefined"
        @click="editable && emit('edit')"
    >
        <img
            v-if="imageSrc"
            :src="imageSrc"
            alt=""
            class="deco-avatar__img"
        />
        <i
            v-else
            :class="['deco-avatar__glyph', glyphClass]"
            :style="glyphStyle"
            aria-hidden="true"
        />
        <span v-if="editable" class="deco-avatar__edit" aria-hidden="true">
            <i class="fas fa-pen" />
        </span>
    </component>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {accentToCss} from '@/config/accentTokens';
import {resolveAssetSrc} from '@/helpers/deviceLogo';

const props = withDefaults(
    defineProps<{
        icon?: string | null;
        accent?: string | null;
        imageAssetId?: string | null;
        fallbackIcon?: string;
        editable?: boolean;
        size?: number;
    }>(),
    {fallbackIcon: 'fas fa-shapes', editable: false, size: 80}
);

const emit = defineEmits<{edit: []}>();

const editLabel = computed(() =>
    props.icon || props.imageAssetId ? 'Change graphic' : 'Add graphic'
);
const imageSrc = computed(() =>
    props.imageAssetId ? resolveAssetSrc(props.imageAssetId) : null
);
// Accept full FA/MDI classes ('fas fa-x', 'mdi mdi-x') or bare FA slugs.
const glyphClass = computed(() => {
    const v = (props.icon ?? '').trim();
    if (!v) return props.fallbackIcon;
    return v.includes(' ') ? v : `fas fa-${v}`;
});
const glyphStyle = computed(() => ({
    fontSize: `${Math.round(props.size * 0.9)}px`,
    ...(props.icon && props.accent
        ? {color: accentToCss(props.accent)}
        : {})
}));
const sizeStyle = computed(() => ({
    width: `${props.size}px`,
    height: `${props.size}px`
}));
</script>

<style scoped>
.deco-avatar {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    padding: 0;
    overflow: hidden;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
}
.deco-avatar--editable {
    cursor: pointer;
    transition: border-color var(--motion-hover);
}
.deco-avatar--editable:hover {
    border-color: var(--color-primary);
}
.deco-avatar__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.deco-avatar__glyph {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    color: var(--color-text-secondary);
}
/* Full-cover pen, revealed on hover — same affordance as the device card. */
.deco-avatar__edit {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, #000 45%, transparent);
    color: #fff;
    font-size: var(--icon-size-md, 1rem);
    opacity: 0;
    transition: opacity var(--motion-hover);
}
.deco-avatar--editable:hover .deco-avatar__edit,
.deco-avatar--editable:focus-visible .deco-avatar__edit {
    opacity: 1;
}
</style>
