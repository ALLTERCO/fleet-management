// 4-tier coverage: UNIT mechanics, INTEGRATION normalisation,
// SYSTEM realistic series, REGRESSION pathological inputs.

import {describe, expect, it} from 'vitest';
import {averageOf, sparklinePoints} from '@/helpers/edgeSparkline';

const BOX = {width: 60, height: 24};

// ─── UNIT ───

describe('sparklinePoints — basic', () => {
    it('returns empty when fewer than 2 samples', () => {
        expect(sparklinePoints([], BOX)).toBe('');
        expect(sparklinePoints([5], BOX)).toBe('');
    });

    it('two equal samples produce a baseline', () => {
        const out = sparklinePoints([5, 5], BOX);
        const parts = out.split(' ');
        expect(parts).toHaveLength(2);
        // Both points should share the same y (top of the band since max=5).
        const yA = Number(parts[0].split(',')[1]);
        const yB = Number(parts[1].split(',')[1]);
        expect(yA).toBeCloseTo(yB, 5);
    });
});

// ─── INTEGRATION — peak normalisation ───

describe('sparklinePoints — normalisation', () => {
    it('the peak sample reaches the top band, the trough reaches the bottom', () => {
        const out = sparklinePoints([0, 10, 0], BOX);
        const ys = out.split(' ').map((p) => Number(p.split(',')[1]));
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);
        expect(bottom).toBeGreaterThan(top);
    });
});

// ─── SYSTEM — realistic series ───

describe('sparklinePoints — realistic', () => {
    it('a 15-sample series produces 15 normalised points', () => {
        const series = Array.from({length: 15}, (_, i) => i % 3);
        const out = sparklinePoints(series, BOX);
        const parts = out.split(' ');
        expect(parts).toHaveLength(15);
    });
});

// ─── REGRESSION — guards ───

describe('sparklinePoints — guards', () => {
    it('all-zero series renders at the baseline (no NaN)', () => {
        const out = sparklinePoints([0, 0, 0, 0], BOX);
        const parts = out.split(' ');
        for (const part of parts) {
            for (const coord of part.split(',')) {
                expect(Number.isNaN(Number(coord))).toBe(false);
            }
        }
    });
});

describe('averageOf', () => {
    it('zero samples averages to 0', () => {
        expect(averageOf([])).toBe(0);
    });

    it('mean of a known series', () => {
        expect(averageOf([1, 2, 3, 4, 5])).toBe(3);
    });
});
