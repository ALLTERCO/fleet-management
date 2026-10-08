<template>
    <div ref="root">
        <slot v-if="shown" />
        <div v-else :style="{minHeight: `${minHeight}px`}" aria-hidden="true" />
    </div>
</template>

<script setup lang="ts">
import {onMounted, onUnmounted, ref} from 'vue';

// Renders its slot only once it scrolls near the viewport, reserving space so
// the scroll position stays stable. Keeps a list of heavy children (e.g. charts,
// each of which inits a chart engine synchronously) from all mounting at once
// and freezing scroll — they build as the user reaches them.
const props = withDefaults(defineProps<{minHeight?: number}>(), {
    minHeight: 200
});

const root = ref<HTMLElement | null>(null);
const shown = ref(false);
let observer: IntersectionObserver | null = null;

function stop() {
    observer?.disconnect();
    observer = null;
}

onMounted(() => {
    const el = root.value;
    if (!el) return;
    // Render a little before it's visible so it's ready when seen.
    observer = new IntersectionObserver(
        (entries) => {
            if (entries.some((e) => e.isIntersecting)) {
                shown.value = true;
                stop();
            }
        },
        {rootMargin: '250px'}
    );
    observer.observe(el);
});

onUnmounted(stop);
</script>
