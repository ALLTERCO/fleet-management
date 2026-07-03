import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import SparkLine from '@/components/monitoring/SparkLine.vue';

describe('SparkLine', () => {
    it('renders a polyline for the supplied series', () => {
        const wrapper = mount(SparkLine, {
            props: {data: [1, 4, 2, 8], filled: false}
        });
        const points = wrapper.find('polyline').attributes('points');
        // One coordinate pair per data point.
        expect(points?.trim().split(/\s+/)).toHaveLength(4);
        wrapper.unmount();
    });

    it('applies the colour through CSS style so design tokens resolve in SVG', () => {
        // A var(--token) reference only resolves when set as a CSS property,
        // never as an SVG presentation attribute — so the binding must be style.
        const wrapper = mount(SparkLine, {
            props: {data: [1, 2, 3], color: 'var(--color-primary)'}
        });

        expect(wrapper.find('polyline').attributes('style')).toContain(
            'stroke: var(--color-primary)'
        );
        for (const stop of wrapper.findAll('stop')) {
            expect(stop.attributes('style')).toContain(
                'stop-color: var(--color-primary)'
            );
        }
        wrapper.unmount();
    });
});
