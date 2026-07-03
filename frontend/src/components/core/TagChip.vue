<template>
    <span
        class="tc"
        :class="[{'tc--clickable': clickable}, `tc--${size}`]"
        :style="pillStyle"
        :tabindex="clickable ? 0 : undefined"
        @click="onClick"
        @keyup.enter="onClick"
    >
        <span class="tc__name">{{ tag.name }}</span>
        <button
            v-if="removable"
            class="tc__remove"
            type="button"
            aria-label="Remove tag"
            @click.stop="$emit('remove')"
        >
            <i class="fas fa-xmark" />
        </button>
    </span>
</template>

<script setup lang="ts">
import type {Tag as ApiTag} from '@api/tag';
import {computed} from 'vue';

const props = withDefaults(
    defineProps<{
        tag: Pick<ApiTag, 'name' | 'color' | 'icon' | 'imageAssetId'>;
        removable?: boolean;
        clickable?: boolean;
        size?: 'sm' | 'md' | 'lg';
    }>(),
    {removable: false, clickable: false, size: 'md'}
);

const emit = defineEmits<{remove: []; click: []}>();

// Semi-transparent fill + saturated border derived from tag.color. Alpha tuned
// for dark-only theme: 0x33 fill (~20%) is the floor for perceptible chroma on
// our surface-1/2 backgrounds; lower values read as gray.
const pillStyle = computed(() => {
    const c = props.tag.color;
    if (!c) return undefined;
    // Token keys map to an --accent-<key> RGB triplet; legacy values are hex.
    if (!c.startsWith('#')) {
        return {
            background: `rgba(var(--accent-${c}), 0.2)`,
            borderColor: `rgba(var(--accent-${c}), 0.8)`,
            color: `rgb(var(--accent-${c}))`
        } as const;
    }
    return {
        background: `${c}33`,
        borderColor: `${c}cc`,
        color: c
    } as const;
});

function onClick() {
    if (props.clickable) emit('click');
}
</script>

<style scoped>
.tc {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--gap-xs);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-medium);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    line-height: 1;
    white-space: nowrap;
}
.tc__icon {
    font-size: var(--type-caption);
    opacity: 0.8;
}
.tc__img {
    width: 1em;
    height: 1em;
    border-radius: var(--radius-full);
    object-fit: cover;
}
.tc--lg .tc__img {
    width: 1.2em;
    height: 1.2em;
}
.tc__name {
    max-width: 16ch;
    overflow: hidden;
    text-overflow: ellipsis;
}
.tc__remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--icon-size-sm);
    height: var(--icon-size-sm);
    border: none;
    background: transparent;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
}
.tc__remove:hover {
    opacity: 1;
}
.tc--sm {
    padding: 0 var(--space-2);
    font-size: var(--type-caption);
}
.tc--md {
    /* default — matches base .tc */
}
.tc--lg {
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    font-size: var(--type-body);
}
.tc--lg .tc__icon {
    font-size: var(--type-body);
}
.tc--lg .tc__name {
    max-width: 24ch;
}
.tc--clickable {
    cursor: pointer;
    transition: transform var(--duration-fast);
}
.tc--clickable:hover {
    transform: translateY(-1px);
}
.tc--clickable:focus-visible {
    outline: var(--focus-ring-width) solid var(--color-primary);
    outline-offset: var(--focus-ring-offset);
}
</style>
