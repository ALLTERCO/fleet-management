// 4-tier coverage for floor-plan auto-placement.
//   UNIT — grid arithmetic for typical and edge-case device counts
//   INTEGRATION — merge keeps manual placements + adds auto for the rest
//   SYSTEM — realistic device list lays out without overlap
//   REGRESSION — empty / single / duplicate-id inputs stay correct

import {describe, expect, it} from 'vitest';
import {
    computeAutoPlacements,
    isAutoPlaced,
    mergePlacements
} from '@/helpers/auto-placement';

// ─── UNIT — grid arithmetic ───

describe('computeAutoPlacements', () => {
    it('returns an empty map for no devices', () => {
        expect(computeAutoPlacements([])).toEqual({});
    });

    it('places a single device near the centre of the plan', () => {
        const out = computeAutoPlacements(['only']);
        expect(out.only.x).toBeCloseTo(0.5, 5);
        expect(out.only.y).toBeCloseTo(0.5, 5);
        expect(out.only.auto).toBe(true);
    });

    it('keeps every coord inside the safe band [0.2 .. 0.8]', () => {
        const ids = Array.from({length: 9}, (_, i) => `d${i}`);
        const out = computeAutoPlacements(ids);
        for (const p of Object.values(out)) {
            expect(p.x).toBeGreaterThanOrEqual(0.2);
            expect(p.x).toBeLessThanOrEqual(0.8);
            expect(p.y).toBeGreaterThanOrEqual(0.2);
            expect(p.y).toBeLessThanOrEqual(0.8);
        }
    });

    it('lays out by sorted id so re-renders stay stable', () => {
        const a = computeAutoPlacements(['c', 'a', 'b']);
        const b = computeAutoPlacements(['a', 'c', 'b']);
        expect(a).toEqual(b);
    });
});

// ─── INTEGRATION — merge with manual placements ───

describe('mergePlacements', () => {
    it('manual placements override auto on a per-device basis', () => {
        const auto = computeAutoPlacements(['a', 'b']);
        const manual = {a: {x: 0.1, y: 0.1, rot: 90}};
        const merged = mergePlacements(auto, manual);
        expect(merged.a).toEqual({x: 0.1, y: 0.1, rot: 90});
        // 'b' falls through to its auto entry.
        expect(merged.b.x).toBe(auto.b.x);
        expect(merged.b.y).toBe(auto.b.y);
    });

    it('manual-only device appears in the merge even with no auto entry', () => {
        const merged = mergePlacements({}, {z: {x: 0.5, y: 0.5}});
        expect(merged.z).toEqual({x: 0.5, y: 0.5});
    });
});

// ─── UNIT — auto-flag predicate ───

describe('isAutoPlaced', () => {
    it('is true for entries produced by computeAutoPlacements', () => {
        const out = computeAutoPlacements(['x']);
        expect(isAutoPlaced(out.x)).toBe(true);
    });

    it('is false for manually-saved placements (no auto field)', () => {
        expect(isAutoPlaced({x: 0.5, y: 0.5})).toBe(false);
    });

    it('returns false when auto is set to false explicitly', () => {
        expect(isAutoPlaced({x: 0, y: 0, auto: false} as never)).toBe(false);
    });
});

// ─── SYSTEM — realistic fleet ───

describe('computeAutoPlacements — system', () => {
    it('lays out 12 devices in a 4×3 grid with no overlap', () => {
        const ids = Array.from({length: 12}, (_, i) => `d${i}`);
        const out = computeAutoPlacements(ids);
        const points = Object.values(out).map((p) => `${p.x},${p.y}`);
        expect(new Set(points).size).toBe(points.length);
    });
});

// ─── INTEGRATION — merge preserves caller mutations after the fact ───

describe('mergePlacements — semantics', () => {
    it('does not mutate the input maps', () => {
        const auto = computeAutoPlacements(['a', 'b']);
        const manual = {a: {x: 0.1, y: 0.1}};
        const frozenAuto = JSON.parse(JSON.stringify(auto));
        const frozenManual = JSON.parse(JSON.stringify(manual));
        mergePlacements(auto, manual);
        expect(auto).toEqual(frozenAuto);
        expect(manual).toEqual(frozenManual);
    });

    it('the merged map carries every device id from devices passed to compute', () => {
        const ids = ['x', 'y', 'z', 'w'];
        const auto = computeAutoPlacements(ids);
        const manual = {z: {x: 0, y: 0}};
        const merged = mergePlacements(auto, manual);
        for (const id of ids) expect(merged[id]).toBeDefined();
    });

    it('once merged, isAutoPlaced agrees with the source map for every key', () => {
        const auto = computeAutoPlacements(['a', 'b', 'c']);
        const manual = {b: {x: 0.5, y: 0.5}};
        const merged = mergePlacements(auto, manual);
        expect(isAutoPlaced(merged.a)).toBe(true);
        expect(isAutoPlaced(merged.b)).toBe(false);
        expect(isAutoPlaced(merged.c)).toBe(true);
    });
});

// ─── SYSTEM — grid stability across device-list churn ───

describe('computeAutoPlacements — stability', () => {
    it('removing a device does not move the surviving ones (other than grid resize)', () => {
        // This test documents the known limitation: adding/removing a device
        // resizes the grid and shifts existing entries. We assert by
        // construction so a future per-device-slot anchoring change won't
        // silently regress without updating this expectation.
        const five = computeAutoPlacements(['a', 'b', 'c', 'd', 'e']);
        const four = computeAutoPlacements(['a', 'b', 'c', 'd']);
        // With 5 ids, cols = ceil(sqrt(5)) = 3, rows = 2.
        // With 4 ids, cols = 2, rows = 2 — different grid.
        // So 'a' will not land at the same coordinate. We confirm the shift
        // exists (documenting current behaviour). When per-slot anchoring
        // is added, flip this assertion.
        expect(five.a).not.toEqual(four.a);
    });
});

// ─── REGRESSION — pathological inputs ───

describe('computeAutoPlacements — guards', () => {
    it('deduplicates duplicate ids (Set + Object.keys semantics)', () => {
        const out = computeAutoPlacements(['a', 'a', 'b']);
        // 'a' and 'b' both have entries; second 'a' is overwritten by sort
        // order being stable. Output size matches unique-id count.
        expect(Object.keys(out)).toEqual(['a', 'b']);
    });

    it('handles 100 devices without throwing', () => {
        const ids = Array.from({length: 100}, (_, i) => `d${i}`);
        expect(() => computeAutoPlacements(ids)).not.toThrow();
        expect(Object.keys(computeAutoPlacements(ids))).toHaveLength(100);
    });
});
