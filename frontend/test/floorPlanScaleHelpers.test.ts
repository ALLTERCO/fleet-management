// Floor-plan scale math + file-shape gating. Each test targets one rule.

import {describe, expect, it} from 'vitest';
import {
    ACCEPTED_FLOOR_PLAN_MIME,
    isAcceptedFloorPlanFile,
    isReasonablePxPerMeter,
    MAX_FLOOR_PLAN_BYTES,
    pixelDistance,
    pxPerMeterFromLine,
    toMeters
} from '@/helpers/floor-plan-scale';

describe('toMeters — unit conversion', () => {
    it('passes metric values through unchanged because they are already in metres', () => {
        expect(toMeters(12.5, 'm')).toBe(12.5);
    });

    it('converts feet to metres using the standard 3.28084 ratio so floor plans match site surveys', () => {
        expect(toMeters(10, 'ft')).toBeCloseTo(3.048, 3);
    });

    it('treats zero and negative inputs as zero because a real-world distance cannot be <= 0', () => {
        expect(toMeters(0, 'm')).toBe(0);
        expect(toMeters(-5, 'm')).toBe(0);
    });
});

describe('pixelDistance — geometric length of the dragged line', () => {
    it('returns the Pythagorean length so diagonal drags are measured correctly', () => {
        expect(pixelDistance({x1: 0, y1: 0, x2: 3, y2: 4})).toBe(5);
    });

    it('returns zero for a zero-length line so the scale step can skip it', () => {
        expect(pixelDistance({x1: 10, y1: 10, x2: 10, y2: 10})).toBe(0);
    });
});

describe('pxPerMeterFromLine — final scale formula', () => {
    it('divides pixel length by real-world metres so 100 px ÷ 10 m gives 10 px/m', () => {
        const px = pxPerMeterFromLine({
            line: {x1: 0, y1: 0, x2: 100, y2: 0},
            realDistance: 10,
            unit: 'm'
        });
        expect(px).toBe(10);
    });

    it('uses the ft→m conversion so a 32.8084 ft line of 100 px produces ~10 px/m', () => {
        const px = pxPerMeterFromLine({
            line: {x1: 0, y1: 0, x2: 100, y2: 0},
            realDistance: 32.8084,
            unit: 'ft'
        });
        expect(px).toBeCloseTo(10, 2);
    });

    it('returns zero when the line has no length so the component does not store a bogus scale', () => {
        const px = pxPerMeterFromLine({
            line: {x1: 5, y1: 5, x2: 5, y2: 5},
            realDistance: 10,
            unit: 'm'
        });
        expect(px).toBe(0);
    });

    it('returns zero when the real-world distance is zero so we do not divide by zero', () => {
        const px = pxPerMeterFromLine({
            line: {x1: 0, y1: 0, x2: 100, y2: 0},
            realDistance: 0,
            unit: 'm'
        });
        expect(px).toBe(0);
    });
});

describe('isAcceptedFloorPlanFile — upload preflight', () => {
    it('accepts a small PNG because PNG is in the allowlist', () => {
        const verdict = isAcceptedFloorPlanFile({
            type: 'image/png',
            size: 1024
        });
        expect(verdict).toEqual({ok: true});
    });

    it('rejects a PDF because PDF is not in the allowlist', () => {
        const verdict = isAcceptedFloorPlanFile({
            type: 'application/pdf',
            size: 1024
        });
        expect(verdict).toEqual({ok: false, reason: 'mime'});
    });

    it('rejects an oversize file because exceeding the cap wastes a server round-trip', () => {
        const verdict = isAcceptedFloorPlanFile({
            type: 'image/png',
            size: MAX_FLOOR_PLAN_BYTES + 1
        });
        expect(verdict).toEqual({ok: false, reason: 'size'});
    });

    it('exposes the configured cap so the UI label can reflect env overrides', () => {
        expect(MAX_FLOOR_PLAN_BYTES).toBeGreaterThan(0);
    });

    it('exposes the MIME allowlist so the file input accept attr stays in sync', () => {
        expect(ACCEPTED_FLOOR_PLAN_MIME).toContain('image/png');
        expect(ACCEPTED_FLOOR_PLAN_MIME).toContain('image/svg+xml');
    });
});

describe('isReasonablePxPerMeter — sanity bounds on computed scale', () => {
    it('accepts a typical office scale so normal use cases proceed', () => {
        // 50 px / m is plausible for a 1024-px image of a 20m room
        expect(isReasonablePxPerMeter(50)).toBe(true);
    });

    it('rejects values below 1 px/m because the plan would be uselessly tiny', () => {
        expect(isReasonablePxPerMeter(0.5)).toBe(false);
    });

    it('rejects values above 10000 px/m because no real floor plan is that detailed', () => {
        expect(isReasonablePxPerMeter(20_000)).toBe(false);
    });

    it('rejects NaN because garbage in should never become a saved scale', () => {
        expect(isReasonablePxPerMeter(Number.NaN)).toBe(false);
    });
});
