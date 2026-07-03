// 4-tier coverage for bezier sampling.
//   UNIT — endpoints, midpoints, sample counts
//   INTEGRATION — straight-line "curve" produces straight points
//   SYSTEM — sample matches known bezier values within tolerance
//   REGRESSION — degenerate control points don't NaN

import {describe, expect, it} from 'vitest';
import {sampleCubicBezier, sampleQuadraticBezier} from '@/helpers/svg-bezier';

function pointCloseTo(a: readonly number[], b: readonly number[]) {
    expect(a[0]).toBeCloseTo(b[0], 5);
    expect(a[1]).toBeCloseTo(b[1], 5);
}

// ─── UNIT — sample count + endpoints ───

describe('sampleCubicBezier', () => {
    it('returns 8 points (skipping t=0, keeping t=1)', () => {
        const out = sampleCubicBezier([0, 0], [0, 10], [10, 10], [10, 0]);
        expect(out).toHaveLength(8);
    });

    it('last sample equals p3 (t=1 endpoint)', () => {
        const out = sampleCubicBezier([0, 0], [0, 10], [10, 10], [10, 0]);
        pointCloseTo(out[out.length - 1], [10, 0]);
    });
});

describe('sampleQuadraticBezier', () => {
    it('returns 8 points', () => {
        const out = sampleQuadraticBezier([0, 0], [5, 10], [10, 0]);
        expect(out).toHaveLength(8);
    });

    it('last sample equals p2 (t=1 endpoint)', () => {
        const out = sampleQuadraticBezier([0, 0], [5, 10], [10, 0]);
        pointCloseTo(out[out.length - 1], [10, 0]);
    });
});

// ─── INTEGRATION — straight bezier ───

describe('bezier — degenerate (collinear) cases', () => {
    it('cubic with controls on the line samples the line', () => {
        // p0..p3 all on the x-axis with controls at 1/3 and 2/3 → straight.
        const out = sampleCubicBezier([0, 0], [3, 0], [6, 0], [9, 0]);
        for (const p of out) expect(p[1]).toBeCloseTo(0, 5);
    });

    it('quadratic with control on midpoint of p0..p2 samples the line', () => {
        const out = sampleQuadraticBezier([0, 0], [5, 0], [10, 0]);
        for (const p of out) expect(p[1]).toBeCloseTo(0, 5);
    });
});

// ─── SYSTEM — known midpoint values ───

describe('bezier — known midpoints', () => {
    it('cubic at t=0.5 of unit-square arc returns (5, 7.5)', () => {
        // p0=(0,0), p1=(0,10), p2=(10,10), p3=(10,0).
        // B(0.5) = (1-0.5)^3*p0 + 3(1-0.5)^2*0.5*p1 + 3(1-0.5)*0.25*p2 + 0.125*p3
        //        = 0.125·(0,0) + 0.375·(0,10) + 0.375·(10,10) + 0.125·(10,0)
        //        = (5, 7.5)
        const out = sampleCubicBezier([0, 0], [0, 10], [10, 10], [10, 0]);
        // The 4th sample (i=4, t=0.5) is the midpoint.
        pointCloseTo(out[3], [5, 7.5]);
    });
});

// ─── SYSTEM — monotonic, bounded inside the convex hull ───

describe('sampleCubicBezier — convex-hull bound', () => {
    it('every sample lies inside the bounding box of the control points', () => {
        // Bezier curves are guaranteed to stay within the convex hull of
        // their control points, so the axis-aligned bounding box is a safe
        // looser bound that still catches NaN or runaway values.
        const out = sampleCubicBezier([0, 0], [10, 50], [30, -10], [40, 20]);
        const minX = 0,
            maxX = 40;
        const minY = -10,
            maxY = 50;
        for (const [x, y] of out) {
            expect(x).toBeGreaterThanOrEqual(minX - 1e-9);
            expect(x).toBeLessThanOrEqual(maxX + 1e-9);
            expect(y).toBeGreaterThanOrEqual(minY - 1e-9);
            expect(y).toBeLessThanOrEqual(maxY + 1e-9);
        }
    });
});

// ─── REGRESSION — guards ───

describe('bezier — guards', () => {
    it('all-coincident points stay at the point (no NaN)', () => {
        const out = sampleCubicBezier([5, 5], [5, 5], [5, 5], [5, 5]);
        for (const p of out) pointCloseTo(p, [5, 5]);
    });

    it('quadratic with coincident points stays at the point', () => {
        const out = sampleQuadraticBezier([3, 3], [3, 3], [3, 3]);
        for (const p of out) pointCloseTo(p, [3, 3]);
    });
});
