// Round-trip + edge-case coverage for the drag math.
// Critical: normalized → world → normalized must be lossless so dropping a
// pin at a position stores the exact coords the renderer reads back.

import {describe, expect, it} from 'vitest';
import {
    type FloorSize,
    normalizedToWorld,
    worldToNormalizedXY
} from '@/helpers/floor-plan-coords';

const FALLBACK = 100;

function pointClose(a: {x: number; y: number}, b: {x: number; y: number}) {
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
}

// ─── UNIT — normalized → world centred on origin ───

describe('normalizedToWorld', () => {
    it('maps (0.5, 0.5) to the origin regardless of plan size', () => {
        const size: FloorSize = {planW: 240, planH: 160};
        const w = normalizedToWorld({x: 0.5, y: 0.5}, size, FALLBACK);
        expect(w.x).toBe(0);
        expect(w.z).toBe(0);
    });

    it('maps the four normalized corners to the four world corners', () => {
        const size: FloorSize = {planW: 240, planH: 160};
        expect(normalizedToWorld({x: 0, y: 0}, size, FALLBACK)).toEqual({
            x: -120,
            z: -80
        });
        expect(normalizedToWorld({x: 1, y: 1}, size, FALLBACK)).toEqual({
            x: 120,
            z: 80
        });
        expect(normalizedToWorld({x: 1, y: 0}, size, FALLBACK)).toEqual({
            x: 120,
            z: -80
        });
        expect(normalizedToWorld({x: 0, y: 1}, size, FALLBACK)).toEqual({
            x: -120,
            z: 80
        });
    });

    it('uses the square fallback when no plan has been loaded', () => {
        const w = normalizedToWorld({x: 0.25, y: 0.75}, null, FALLBACK);
        expect(w.x).toBe(-25);
        expect(w.z).toBe(25);
    });

    it('does not squash a non-square plan into a square', () => {
        // Aspect 3:1 — the wide plan must spread X across 300 units while
        // Z stays at 100. Earlier code hardcoded the square constant for
        // both axes and corner pins drifted off the floor.
        const wide: FloorSize = {planW: 300, planH: 100};
        const cornerNorm = {x: 1, y: 1};
        const w = normalizedToWorld(cornerNorm, wide, FALLBACK);
        expect(w.x).toBe(150);
        expect(w.z).toBe(50);
    });
});

// ─── UNIT — world → normalized ───

describe('worldToNormalizedXY', () => {
    it('inverts normalizedToWorld at the corners', () => {
        const size: FloorSize = {planW: 240, planH: 160};
        const n = worldToNormalizedXY({x: 120, z: 80}, size);
        expect(n.x).toBe(1);
        expect(n.y).toBe(1);
    });

    it('clamps the centre to (0.5, 0.5)', () => {
        const size: FloorSize = {planW: 47, planH: 91};
        const n = worldToNormalizedXY({x: 0, z: 0}, size);
        expect(n.x).toBeCloseTo(0.5, 9);
        expect(n.y).toBeCloseTo(0.5, 9);
    });
});

// ─── INTEGRATION — round-trip lossless ───

describe('normalize ↔ world round-trip', () => {
    const sizes: FloorSize[] = [
        {planW: 100, planH: 100},
        {planW: 1050, planH: 720},
        {planW: 1, planH: 1},
        {planW: 0.5, planH: 0.5},
        {planW: 10_000, planH: 100}
    ];
    const points = [
        {x: 0, y: 0},
        {x: 1, y: 1},
        {x: 0.5, y: 0.5},
        {x: 0.13579, y: 0.97531},
        {x: 0.000001, y: 0.999999}
    ];

    for (const size of sizes) {
        for (const p of points) {
            it(`round-trips ${JSON.stringify(p)} on ${JSON.stringify(size)}`, () => {
                const world = normalizedToWorld(p, size, FALLBACK);
                const back = worldToNormalizedXY(world, size);
                pointClose(back, p);
            });
        }
    }
});

// ─── SYSTEM — realistic drag flow ───

describe('drag math — end-to-end drag simulation', () => {
    it('drag from centre to upper-right quadrant persists the dropped position', () => {
        // Realistic flow: pin starts at stored normalized (0.5, 0.5), user
        // drags it +60 world-units on X and -30 on Z on a 240×160 plan,
        // we convert back to normalized and persist. The persisted value is
        // what the next render reads — it must match the visual drop point.
        const size: FloorSize = {planW: 240, planH: 160};
        const start = normalizedToWorld({x: 0.5, y: 0.5}, size, FALLBACK);
        const dropped = {x: start.x + 60, z: start.z - 30};
        const persisted = worldToNormalizedXY(dropped, size);
        // 60 / 240 = 0.25 in X; -30 / 160 = -0.1875 in Y (Z+ is normalized Y+).
        expect(persisted.x).toBeCloseTo(0.75, 9);
        expect(persisted.y).toBeCloseTo(0.3125, 9);
    });

    it('drags across an extreme aspect ratio without axis mixing', () => {
        // 10000×100 plan — exposes any axis-mixing bug because X and Z are
        // wildly different scales. A 1000-unit drag on X is 0.1 normalized;
        // a 50-unit drag on Z is 0.5 normalized.
        const wide: FloorSize = {planW: 10_000, planH: 100};
        const start = normalizedToWorld({x: 0.3, y: 0.2}, wide, FALLBACK);
        const dropped = {x: start.x + 1000, z: start.z + 50};
        const persisted = worldToNormalizedXY(dropped, wide);
        expect(persisted.x).toBeCloseTo(0.4, 9);
        expect(persisted.y).toBeCloseTo(0.7, 9);
    });
});

// ─── REGRESSION — pathological inputs ───

describe('drag math — guards', () => {
    it('handles zero-sized plan via the fallback', () => {
        const w = normalizedToWorld({x: 1, y: 0}, null, FALLBACK);
        expect(w.x).toBe(50);
        expect(w.z).toBe(-50);
    });

    it('extrapolates beyond [0, 1] linearly (caller is responsible for clamping)', () => {
        const size: FloorSize = {planW: 100, planH: 100};
        // Drop a pin off the floor — the math itself shouldn't clamp; the
        // app's onDeviceMove handler does that. We verify the linear behaviour
        // so a future bug introducing a hidden clamp here would be caught.
        const w = normalizedToWorld({x: 1.5, y: -0.2}, size, FALLBACK);
        expect(w.x).toBe(100);
        expect(w.z).toBe(-70);
    });
});
