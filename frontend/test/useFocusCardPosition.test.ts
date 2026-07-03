import {describe, expect, it} from 'vitest';
import {ref} from 'vue';
import {
    clampToViewport,
    DEFAULT_FOCUS_CARD_RESERVES,
    FOCUS_CARD_DIMS_DEFAULT,
    flipAboveIfOverflowsBottom,
    positionBelowPin,
    useFocusCardPosition
} from '@/composables/useFocusCardPosition';
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

describe('positionBelowPin', () => {
    it('centres card horizontally on pin and places pinGap below', () => {
        const pin: Pin = {x: 500, y: 300};
        const dims: FocusCardDims = {w: 460, h: 340};
        const reserves: FocusCardReserves = DEFAULT_FOCUS_CARD_RESERVES;

        const result = positionBelowPin({pin, dims, reserves});

        expect(result.left).toBe(500 - 460 / 2);
        expect(result.top).toBe(300 + 22);
    });
});

describe('flipAboveIfOverflowsBottom', () => {
    it('keeps position when card fits below', () => {
        const pin: Pin = {x: 500, y: 300};
        const dims: FocusCardDims = {w: 460, h: 340};
        const reserves: FocusCardReserves = DEFAULT_FOCUS_CARD_RESERVES;
        const viewport: Viewport = {w: 1200, h: 800};
        const pos: FocusCardPosition = {left: 270, top: 322};

        const result = flipAboveIfOverflowsBottom({
            pos,
            pin,
            dims,
            reserves,
            viewport
        });

        expect(result.left).toBe(270);
        expect(result.top).toBe(322);
    });

    it('flips above when card would overflow bottom', () => {
        const pin: Pin = {x: 500, y: 650};
        const dims: FocusCardDims = {w: 460, h: 340};
        const reserves: FocusCardReserves = DEFAULT_FOCUS_CARD_RESERVES;
        const viewport: Viewport = {w: 1200, h: 800};
        const pos: FocusCardPosition = {left: 270, top: 672};

        const result = flipAboveIfOverflowsBottom({
            pos,
            pin,
            dims,
            reserves,
            viewport
        });

        expect(result.left).toBe(270);
        expect(result.top).toBe(650 - 340 - 22);
    });
});

describe('clampToViewport', () => {
    it('reserves right side-panel column', () => {
        const dims: FocusCardDims = {w: 460, h: 340};
        const reserves: FocusCardReserves = DEFAULT_FOCUS_CARD_RESERVES;
        const viewport: Viewport = {w: 1200, h: 800};
        const pos: FocusCardPosition = {left: 1000, top: 300};

        const result = clampToViewport({pos, dims, reserves, viewport});

        const maxLeft = 1200 - 380 - 460 - 16;
        expect(result.left).toBe(maxLeft);
        expect(result.top).toBe(300);
    });

    it('reserves top bar', () => {
        const dims: FocusCardDims = {w: 460, h: 340};
        const reserves: FocusCardReserves = DEFAULT_FOCUS_CARD_RESERVES;
        const viewport: Viewport = {w: 1200, h: 800};
        const pos: FocusCardPosition = {left: 200, top: 20};

        const result = clampToViewport({pos, dims, reserves, viewport});

        expect(result.left).toBe(200);
        expect(result.top).toBe(84);
    });

    it('clamps to bottom edge', () => {
        const dims: FocusCardDims = {w: 460, h: 340};
        const reserves: FocusCardReserves = DEFAULT_FOCUS_CARD_RESERVES;
        const viewport: Viewport = {w: 1200, h: 800};
        const pos: FocusCardPosition = {left: 200, top: 700};

        const result = clampToViewport({pos, dims, reserves, viewport});

        const maxTop = 800 - 340 - 16;
        expect(result.left).toBe(200);
        expect(result.top).toBe(maxTop);
    });
});

describe('useFocusCardPosition', () => {
    it('returns null when pin is null', () => {
        const pin = ref<Pin | null>(null);
        const dims = ref<FocusCardDims>(FOCUS_CARD_DIMS_DEFAULT);
        const reserves = ref<FocusCardReserves>(DEFAULT_FOCUS_CARD_RESERVES);
        const viewport = ref<Viewport>({w: 1200, h: 800});

        const result = useFocusCardPosition({pin, dims, reserves, viewport});

        expect(result.value).toBeNull();
    });

    it('applies pipeline: positionBelowPin → flipAboveIfOverflowsBottom → clampToViewport', () => {
        const pin = ref<Pin | null>({x: 500, y: 300});
        const dims = ref<FocusCardDims>(FOCUS_CARD_DIMS_DEFAULT);
        const reserves = ref<FocusCardReserves>(DEFAULT_FOCUS_CARD_RESERVES);
        const viewport = ref<Viewport>({w: 1200, h: 800});

        const result = useFocusCardPosition({pin, dims, reserves, viewport});

        expect(result.value).not.toBeNull();
        expect(result.value?.left).toBe(500 - 460 / 2);
        expect(result.value?.top).toBe(300 + 22);
    });
});
