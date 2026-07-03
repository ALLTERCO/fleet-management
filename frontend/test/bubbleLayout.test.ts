import {describe, expect, it} from 'vitest';
import {layoutBubbles, requiredHeight} from '@/helpers/bubbleLayout';

describe('layoutBubbles', () => {
    it('returns empty layout for empty input', () => {
        expect(layoutBubbles([])).toEqual([]);
    });

    it('uses min radius for everyone when all metrics are zero', () => {
        const out = layoutBubbles(
            [
                {id: 1, metric: 0},
                {id: 2, metric: 0}
            ],
            {minRadius: 5, maxRadius: 30}
        );
        expect(out.every((p) => p.r === 5)).toBe(true);
    });

    it('scales radii proportionally to the largest metric', () => {
        const out = layoutBubbles(
            [
                {id: 1, metric: 0},
                {id: 2, metric: 5},
                {id: 3, metric: 10}
            ],
            {minRadius: 0, maxRadius: 100}
        );
        expect(out[0].r).toBe(0);
        expect(out[1].r).toBe(50);
        expect(out[2].r).toBe(100);
    });

    it('places bubbles on a grid that wraps to multiple rows', () => {
        const inputs = Array.from({length: 7}, (_, i) => ({
            id: i,
            metric: i + 1
        }));
        const out = layoutBubbles(inputs, {
            width: 200,
            maxRadius: 20,
            padding: 5
        });
        const xs = new Set(out.map((p) => p.cx));
        const ys = new Set(out.map((p) => p.cy));
        expect(xs.size).toBeGreaterThan(1);
        expect(ys.size).toBeGreaterThan(1);
    });
});

describe('requiredHeight', () => {
    it('uses the default height for an empty input', () => {
        expect(requiredHeight(0, {height: 200})).toBe(200);
    });

    it('grows beyond the minimum height when many bubbles need rows', () => {
        const tall = requiredHeight(50, {
            width: 200,
            maxRadius: 20,
            padding: 5
        });
        expect(tall).toBeGreaterThan(320);
    });
});
