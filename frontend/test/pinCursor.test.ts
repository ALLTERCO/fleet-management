import {describe, expect, it} from 'vitest';
import {pinCursor} from '@/composables/useDeckOverlay';

describe('pinCursor', () => {
    it('uses grabbing while the user drags the map', () => {
        expect(pinCursor({isDragging: true, isHovering: false})).toBe(
            'grabbing'
        );
    });
    it('uses pointer when hovering a pickable feature and not dragging', () => {
        expect(pinCursor({isDragging: false, isHovering: true})).toBe(
            'pointer'
        );
    });
    it('falls back to grab when idle', () => {
        expect(pinCursor({isDragging: false, isHovering: false})).toBe('grab');
    });
    it('prefers grabbing over pointer when both are true', () => {
        expect(pinCursor({isDragging: true, isHovering: true})).toBe(
            'grabbing'
        );
    });
});
