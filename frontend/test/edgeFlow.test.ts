// UNIT mapping, INTEGRATION bucketing, SYSTEM monotonic behaviour,
// REGRESSION negatives + extremes.

import {describe, expect, it} from 'vitest';
import {flowDurationSec} from '@/helpers/edgeFlow';

// ─── UNIT — mapping rules ───

describe('flowDurationSec', () => {
    it('zero throughput maps to the slow ceiling (6s)', () => {
        expect(flowDurationSec(0)).toBe(6);
    });

    it('the reference rate (60/min) hits the fast floor (1.2s rounded to 1)', () => {
        expect(flowDurationSec(60)).toBeLessThanOrEqual(1.5);
        expect(flowDurationSec(60)).toBeGreaterThanOrEqual(1);
    });
});

// ─── INTEGRATION — bucketing ───

describe('flowDurationSec — 0.5s buckets', () => {
    it('throughputs that map within 0.5s of each other round to the same bucket', () => {
        expect(flowDurationSec(10) % 0.5).toBeCloseTo(0, 5);
        expect(flowDurationSec(11) % 0.5).toBeCloseTo(0, 5);
        expect(flowDurationSec(12) % 0.5).toBeCloseTo(0, 5);
    });
});

// ─── SYSTEM — monotonicity ───

describe('flowDurationSec — monotonic decrease with throughput', () => {
    it('higher throughput cannot produce a slower (longer) duration', () => {
        const samples = [0, 10, 20, 30, 60, 120];
        const durations = samples.map(flowDurationSec);
        for (let i = 1; i < durations.length; i++) {
            expect(durations[i]).toBeLessThanOrEqual(durations[i - 1]);
        }
    });
});

// ─── REGRESSION — extremes ───

describe('flowDurationSec — guards', () => {
    it('treats negative throughput as zero', () => {
        expect(flowDurationSec(-50)).toBe(6);
    });

    it('saturates above the reference rate at the floor', () => {
        expect(flowDurationSec(10_000)).toBe(flowDurationSec(60));
    });
});
