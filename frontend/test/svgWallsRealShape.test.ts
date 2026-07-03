// SYSTEM-level tests against the actual SVG shape Qt produces. Fixtures
// below are real-world transform strings observed in the user's uploaded
// file:
//   - `scale(0.75)` — the common case (58 occurrences in the real file)
//   - `matrix(0.75,0,0,0.75,tx,ty)` — Inkscape-style scaled+translated layer
//   - `matrix(0.53033,0.53033,-0.53033,0.53033,tx,ty)` — cos(45°)·0.75 rotated
//
// These tests guard against silently dropping transform support, which the
// old `readAccumulatedScale` implementation did for every form except a
// bare `scale(k)`.

import {describe, expect, it} from 'vitest';
import {parseSvgFloorPlan} from '@/helpers/svg-walls';

function wrap(body: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="370mm" height="254mm">${body}</svg>`;
}

// ─── SYSTEM — common Qt scale ───

describe('parseSvgFloorPlan — Qt scale(0.75) wrapper', () => {
    it('scales every wall by 0.75', () => {
        const out = parseSvgFloorPlan(
            wrap(
                '<g transform="scale(0.75)">' +
                    '<path stroke="#000" d="M 0,0 H 200 V 200 H 0 V 0" />' +
                    '</g>'
            )
        );
        expect(out).not.toBeNull();
        // After 0.75 scale the bbox spans 150 × 150.
        expect(out!.width).toBeCloseTo(150, 5);
        expect(out!.height).toBeCloseTo(150, 5);
    });
});

// ─── SYSTEM — Inkscape-style matrix(s,0,0,s,tx,ty) ───

describe('parseSvgFloorPlan — translated + scaled matrix', () => {
    it('applies scale + translate from a single matrix()', () => {
        // matrix(0.75,0,0,0.75,-7.5,0) shifts by -7.5 X then 0.75-scales.
        // After bbox translation to origin the offset is normalized out,
        // but the dimensions still tell us scale was applied.
        const out = parseSvgFloorPlan(
            wrap(
                '<g transform="matrix(0.75,0,0,0.75,-7.5,0)">' +
                    '<path stroke="#000" d="M 0,0 H 100 V 100 H 0 V 0" />' +
                    '</g>'
            )
        );
        expect(out!.width).toBeCloseTo(75, 5);
        expect(out!.height).toBeCloseTo(75, 5);
    });
});

// ─── SYSTEM — rotated matrix (the 0.53033 ones in the real file) ───

describe('parseSvgFloorPlan — rotated matrix', () => {
    it('handles cos(45°)·k matrix without crashing or producing NaN', () => {
        // matrix(c, c, -c, c, ...) where c = 0.53033 ≈ cos(45°)·0.75 — a
        // door swing or fixture rotated 45°. Old code dropped this whole
        // sub-tree because the regex only matched scale().
        const out = parseSvgFloorPlan(
            wrap(
                '<g transform="matrix(0.53033,0.53033,-0.53033,0.53033,0,0)">' +
                    '<path stroke="#000" d="M 0,0 H 100 V 100 H 0 V 0" />' +
                    '</g>'
            )
        );
        expect(out).not.toBeNull();
        for (const w of out!.walls) {
            expect(Number.isFinite(w.from[0])).toBe(true);
            expect(Number.isFinite(w.from[1])).toBe(true);
            expect(Number.isFinite(w.to[0])).toBe(true);
            expect(Number.isFinite(w.to[1])).toBe(true);
        }
    });

    it('a 100×100 square rotated 45° produces a √2·100 ≈ 141 diagonal bbox', () => {
        // Pure rotation by 45° (cos≈sin≈0.7071). A unit square rotates to
        // a diamond whose bbox is √2 wide.
        const out = parseSvgFloorPlan(
            wrap(
                '<g transform="matrix(0.7071,0.7071,-0.7071,0.7071,0,0)">' +
                    '<path stroke="#000" d="M 0,0 H 100 V 100 H 0 V 0" />' +
                    '</g>'
            )
        );
        expect(out!.width).toBeCloseTo(141.42, 0);
        expect(out!.height).toBeCloseTo(141.42, 0);
    });
});

// ─── SYSTEM — nested transforms compose ───

describe('parseSvgFloorPlan — nested transform composition', () => {
    it('inner translate composes after outer scale', () => {
        // Real file pattern: `<g transform="scale(0.75)"><g transform="translate(...)"><path/>`.
        // The inner translate is applied first (per SVG semantics), then the
        // outer scale. Bbox dimensions depend on scale only.
        const out = parseSvgFloorPlan(
            wrap(
                '<g transform="scale(0.5)">' +
                    '<g transform="translate(100, 100)">' +
                    '<path stroke="#000" d="M 0,0 H 200 V 200 H 0 V 0" />' +
                    '</g></g>'
            )
        );
        // path 200×200 → translated → scaled by 0.5 → bbox 100×100.
        expect(out!.width).toBeCloseTo(100, 5);
        expect(out!.height).toBeCloseTo(100, 5);
    });
});

// ─── SYSTEM — dashed transforms still skipped ───

describe('parseSvgFloorPlan — dimension lines still skipped under transforms', () => {
    it('skips dashed paths even inside transformed groups', () => {
        const out = parseSvgFloorPlan(
            wrap(
                '<g transform="scale(0.75)">' +
                    '<path stroke="#000" stroke-dasharray="4,2" d="M 0,0 H 1000 V 1000 H 0 V 0" />' +
                    '<path stroke="#000" d="M 0,0 H 100 V 100 H 0 V 0" />' +
                    '</g>'
            )
        );
        // Only the solid 100×100 path survives; scaled 0.75 → 75×75 bbox.
        expect(out!.width).toBeCloseTo(75, 5);
        expect(out!.height).toBeCloseTo(75, 5);
    });
});

// ─── REGRESSION — extracted walls must form a closed loop count ───

describe('parseSvgFloorPlan — closed-shape segment counts', () => {
    it('a 4-vertex rectangle yields 4 wall segments', () => {
        const out = parseSvgFloorPlan(
            wrap('<path stroke="#000" d="M 0,0 H 100 V 100 H 0 V 0" />')
        );
        expect(out!.walls.length).toBe(4);
    });

    it('two disjoint rectangles in one path yield 8 segments', () => {
        const out = parseSvgFloorPlan(
            wrap(
                '<path stroke="#000" d="' +
                    'M 0,0 H 50 V 50 H 0 V 0 ' +
                    'M 100,0 H 200 V 50 H 100 V 0" />'
            )
        );
        expect(out!.walls.length).toBe(8);
    });
});
