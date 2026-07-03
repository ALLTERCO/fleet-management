import {type ComputedRef, computed, type Ref} from 'vue';
import type {
    FocusCardDims,
    FocusCardPosition,
    FocusCardReserves
} from '@/types/focusCard';

interface Pin {
    readonly x: number;
    readonly y: number;
}

interface Viewport {
    readonly w: number;
    readonly h: number;
}

export function positionBelowPin(input: {
    readonly pin: Pin;
    readonly dims: FocusCardDims;
    readonly reserves: FocusCardReserves;
}): FocusCardPosition {
    return {
        left: input.pin.x - input.dims.w / 2,
        top: input.pin.y + input.reserves.pinGap
    };
}

export function flipAboveIfOverflowsBottom(input: {
    readonly pos: FocusCardPosition;
    readonly pin: Pin;
    readonly dims: FocusCardDims;
    readonly reserves: FocusCardReserves;
    readonly viewport: Viewport;
}): FocusCardPosition {
    const overflows =
        input.pos.top + input.dims.h >
        input.viewport.h - input.reserves.edgePad;
    if (!overflows) return input.pos;
    return {
        left: input.pos.left,
        top: input.pin.y - input.dims.h - input.reserves.pinGap
    };
}

export function clampLeftWithinViewport(input: {
    readonly left: number;
    readonly dims: FocusCardDims;
    readonly reserves: FocusCardReserves;
    readonly viewport: Viewport;
}): number {
    const max =
        input.viewport.w -
        input.reserves.sidePanel -
        input.dims.w -
        input.reserves.edgePad;
    return Math.max(input.reserves.edgePad, Math.min(input.left, max));
}

export function clampTopWithinViewport(input: {
    readonly top: number;
    readonly dims: FocusCardDims;
    readonly reserves: FocusCardReserves;
    readonly viewport: Viewport;
}): number {
    const max = input.viewport.h - input.dims.h - input.reserves.edgePad;
    return Math.max(input.reserves.topBar, Math.min(input.top, max));
}

export function clampToViewport(input: {
    readonly pos: FocusCardPosition;
    readonly dims: FocusCardDims;
    readonly reserves: FocusCardReserves;
    readonly viewport: Viewport;
}): FocusCardPosition {
    return {
        left: clampLeftWithinViewport({
            left: input.pos.left,
            dims: input.dims,
            reserves: input.reserves,
            viewport: input.viewport
        }),
        top: clampTopWithinViewport({
            top: input.pos.top,
            dims: input.dims,
            reserves: input.reserves,
            viewport: input.viewport
        })
    };
}

export function useFocusCardPosition(input: {
    readonly pin: Ref<Pin | null>;
    readonly dims: Ref<FocusCardDims>;
    readonly reserves: Ref<FocusCardReserves>;
    readonly viewport: Ref<Viewport>;
}): ComputedRef<FocusCardPosition | null> {
    return computed(() => {
        if (input.pin.value == null) return null;
        const base = positionBelowPin({
            pin: input.pin.value,
            dims: input.dims.value,
            reserves: input.reserves.value
        });
        const flipped = flipAboveIfOverflowsBottom({
            pos: base,
            pin: input.pin.value,
            dims: input.dims.value,
            reserves: input.reserves.value,
            viewport: input.viewport.value
        });
        return clampToViewport({
            pos: flipped,
            dims: input.dims.value,
            reserves: input.reserves.value,
            viewport: input.viewport.value
        });
    });
}

export const FOCUS_CARD_DIMS_DEFAULT: FocusCardDims = Object.freeze({
    w: 460,
    h: 340
});

export const FOCUS_CARD_DIMS_EXPANDED: FocusCardDims = Object.freeze({
    w: 760,
    h: 540
});

export const DEFAULT_FOCUS_CARD_RESERVES: FocusCardReserves = Object.freeze({
    edgePad: 16,
    topBar: 84,
    sidePanel: 380,
    pinGap: 22
});
