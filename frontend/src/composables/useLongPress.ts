// Long-press handler — fires `onLongPress` after `delayMs` of sustained press.
// Cancels if the pointer moves > moveTolerancePx, or pointer up before delay.

import {onBeforeUnmount, type Ref, watch} from 'vue';
import {LONG_PRESS_MS} from '@/constants';

export type LongPressOptions = {
    delayMs?: number;
    moveTolerancePx?: number;
};

export function useLongPress(
    target: Ref<HTMLElement | null | undefined>,
    onLongPress: (ev: PointerEvent) => void,
    options: LongPressOptions = {}
): void {
    const delay = options.delayMs ?? LONG_PRESS_MS;
    const moveTolerance = options.moveTolerancePx ?? 8;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let startX = 0;
    let startY = 0;
    let fired = false;

    function clear(): void {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
    }

    function onDown(ev: PointerEvent): void {
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        startX = ev.clientX;
        startY = ev.clientY;
        fired = false;
        clear();
        timer = setTimeout(() => {
            fired = true;
            onLongPress(ev);
        }, delay);
    }
    function onMove(ev: PointerEvent): void {
        if (!timer) return;
        if (
            Math.abs(ev.clientX - startX) > moveTolerance ||
            Math.abs(ev.clientY - startY) > moveTolerance
        )
            clear();
    }
    function onUp(ev: PointerEvent): void {
        clear();
        // Suppress the synthetic click that follows a fired long-press.
        if (fired) ev.preventDefault();
    }

    function attach(el: HTMLElement): () => void {
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', clear);
        el.addEventListener('pointerleave', clear);
        return () => {
            el.removeEventListener('pointerdown', onDown);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
            el.removeEventListener('pointercancel', clear);
            el.removeEventListener('pointerleave', clear);
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
    onBeforeUnmount(() => {
        detach?.();
        clear();
    });
}
