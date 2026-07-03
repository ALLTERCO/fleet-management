import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import MapSkeleton from '@/components/core/maps/MapSkeleton.vue';

describe('MapSkeleton', () => {
    it('renders the shimmer + caption + ghost pins', () => {
        const w = mount(MapSkeleton);
        expect(w.find('.map-skel__shimmer').exists()).toBe(true);
        expect(w.find('.map-skel__caption').exists()).toBe(true);
        expect(w.findAll('.map-skel__pin').length).toBe(5);
    });

    it('marks itself busy for assistive tech', () => {
        const w = mount(MapSkeleton);
        const root = w.get('.map-skel');
        expect(root.attributes('aria-busy')).toBe('true');
        expect(root.attributes('aria-label')).toBe('Loading map');
    });

    it('positions each ghost pin via inline top + left percentages', () => {
        const w = mount(MapSkeleton);
        for (const pin of w.findAll('.map-skel__pin')) {
            const style = pin.attributes('style') ?? '';
            expect(style).toMatch(/top:\s*\d+%/);
            expect(style).toMatch(/left:\s*\d+%/);
        }
    });
});
