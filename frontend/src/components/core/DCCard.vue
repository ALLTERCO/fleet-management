<template>
    <div
        :class="[
            'dc',
            accentClass,
            {
                'dc-off': offline,
                'dc-selected': selected,
                'dc-custom-accent': !!accentColor,
                'dc-has-footer': hasFooter,
            },
        ]"
        :style="cardStyle"
        role="button"
        tabindex="0"
        @click="emit('click', $event)"
        @keydown.enter="emit('click', $event)"
        @keydown.space.prevent="emit('click', $event)"
    >
        <div class="dc-head">
            <div class="dc-head-left">
                <slot name="status" />
            </div>
            <div v-if="hasState" class="dc-head-state">
                <slot name="state" />
            </div>
        </div>
        <div class="dc-img" :class="{'dc-img--glyph': logo?.kind === 'icon'}">
            <i
                v-if="logo?.kind === 'icon'"
                :class="['dc-glyph', logo.faClass]"
                :style="glyphStyle"
                :aria-label="name"
            />
            <img
                v-else
                v-lazyload
                :data-url="logo?.src ?? image"
                :alt="name"
                @error="emit('img-error', $event)"
            />
        </div>
        <div class="dc-name">
            <div class="dc-name-txt">{{ name }}</div>
        </div>
        <div v-if="hasFooter" class="dc-footer">
            <slot name="footer" />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, useSlots} from 'vue';
import type {DeviceLogo} from '@/helpers/deviceLogo';

// `logo` is the structured resolver result (icon/image/cdn). `image` is
// kept for legacy callers that still pass a plain URL — new callers should
// pass `logo` and let the card render the right element.
const props = defineProps<{
    label?: string;
    image?: string;
    logo?: DeviceLogo;
    name: string;
    accentClass?: string;
    selected?: boolean;
    offline?: boolean;
    accentColor?: string;
}>();

const emit = defineEmits<{
    click: [event: Event];
    'img-error': [event: Event];
}>();

const slots = useSlots();
const hasFooter = computed(() => !!slots.footer);
const hasState = computed(() => !!slots.state);

const cardStyle = computed<Record<string, string> | undefined>(() =>
    props.accentColor ? {'--dc-accent': props.accentColor} : undefined
);

// Token-backed accent. Maps the backend's accent key (e.g. 'temp') to the
// existing entity accent CSS variable (`--accent-temp` is an RGB triplet).
const glyphStyle = computed<Record<string, string> | undefined>(() => {
    if (props.logo?.kind !== 'icon') return undefined;
    const accent = props.logo.accent;
    return accent ? {color: `rgb(var(--accent-${accent}))`} : undefined;
});
</script>

<style scoped>
.dc-has-footer {
    height: 234px;
}

/* FA glyph stand-in for the device image — sized to match the image box. */
.dc-glyph {
    font-size: var(--icon-size-2xl);
    color: var(--color-text-secondary);
    line-height: 1;
}

.dc-off .dc-glyph {
    color: var(--color-text-disabled);
    opacity: 0.55;
}

.dc-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    padding: 0 var(--space-3) 10px;
}

/* Custom accent — online dot in slot content */
.dc.dc-custom-accent :slotted(.dc-dot-on) {
    background: var(--dc-accent);
    box-shadow:
        0 0 0 2px color-mix(in srgb, var(--dc-accent) 12%, transparent),
        0 0 8px var(--dc-accent);
    animation: dc-accent-pulse 1.8s ease-in-out infinite;
}

@keyframes dc-accent-pulse {
    0%,
    100% {
        box-shadow:
            0 0 0 2px color-mix(in srgb, var(--dc-accent) 10%, transparent),
            0 0 6px var(--dc-accent);
    }
    50% {
        box-shadow:
            0 0 0 3px color-mix(in srgb, var(--dc-accent) 22%, transparent),
            0 0 14px var(--dc-accent);
    }
}
</style>
