import {onBeforeUnmount, onMounted, ref} from 'vue';

// Reactive monotonic ms since composable mount. Drives map-layer pulse
// animations without burning the GPU on full buffer rebuilds.
export function useRafTime() {
    const time = ref(0);
    let rafId: number | null = null;
    let start = 0;

    function tick(now: number): void {
        if (start === 0) start = now;
        time.value = now - start;
        rafId = requestAnimationFrame(tick);
    }

    onMounted(() => {
        rafId = requestAnimationFrame(tick);
    });
    onBeforeUnmount(() => {
        if (rafId !== null) cancelAnimationFrame(rafId);
    });

    return {time};
}
