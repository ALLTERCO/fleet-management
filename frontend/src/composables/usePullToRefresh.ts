// Pull-to-refresh on a scrollable container. When the user pulls down past the
// threshold while at scrollTop=0, `onRefresh` fires. `pullDistance` and
// `triggered` are exposed so callers can render a spinner / progress hint.

import {onBeforeUnmount, type Ref, ref, watch} from 'vue';
import {PULL_REFRESH_PX} from '@/constants';

export type PullToRefreshOptions = {
    thresholdPx?: number;
    /** Resistance factor 0..1 — visual pull travels slower than finger. */
    resistance?: number;
};

export function usePullToRefresh(
    target: Ref<HTMLElement | null | undefined>,
    onRefresh: () => Promise<void> | void,
    options: PullToRefreshOptions = {}
) {
    const threshold = options.thresholdPx ?? PULL_REFRESH_PX;
    const resistance = options.resistance ?? 0.5;

    const pullDistance = ref(0);
    const refreshing = ref(false);

    let startY = 0;
    let pulling = false;

    function onTouchStart(ev: TouchEvent): void {
        const el = target.value;
        if (!el || refreshing.value) return;
        if (el.scrollTop > 0) return;
        startY = ev.touches[0]?.clientY ?? 0;
        pulling = true;
    }

    function onTouchMove(ev: TouchEvent): void {
        if (!pulling) return;
        const dy = (ev.touches[0]?.clientY ?? 0) - startY;
        if (dy <= 0) {
            pullDistance.value = 0;
            return;
        }
        pullDistance.value = dy * resistance;
        // Keep native scroll snappy below the threshold.
        if (dy > 4) ev.preventDefault();
    }

    async function onTouchEnd(): Promise<void> {
        if (!pulling) return;
        pulling = false;
        if (pullDistance.value >= threshold && !refreshing.value) {
            refreshing.value = true;
            try {
                await onRefresh();
            } finally {
                refreshing.value = false;
                pullDistance.value = 0;
            }
        } else {
            pullDistance.value = 0;
        }
    }

    function attach(el: HTMLElement): () => void {
        el.addEventListener('touchstart', onTouchStart, {passive: true});
        el.addEventListener('touchmove', onTouchMove, {passive: false});
        el.addEventListener('touchend', onTouchEnd);
        el.addEventListener('touchcancel', onTouchEnd);
        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('touchcancel', onTouchEnd);
        };
    }

    let detach: (() => void) | undefined;
    watch(
        target,
        (el) => {
            detach?.();
            detach = el ? attach(el) : undefined;
        },
        {immediate: true}
    );
    onBeforeUnmount(() => detach?.());

    return {pullDistance, refreshing, threshold};
}
