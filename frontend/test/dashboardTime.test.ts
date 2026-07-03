import {describe, expect, it} from 'vitest';
import {formatRelative, isStale} from '@/helpers/dashboardTime';

describe('formatRelative', () => {
    it('shows "just now" for negative or zero deltas', () => {
        expect(formatRelative(-1000)).toBe('just now');
        expect(formatRelative(0)).toBe('0s ago');
    });

    it('shows seconds up to a minute', () => {
        expect(formatRelative(5_000)).toBe('5s ago');
        expect(formatRelative(59_000)).toBe('59s ago');
    });

    it('shows minutes up to an hour', () => {
        expect(formatRelative(60_000)).toBe('1m ago');
        expect(formatRelative(60 * 59 * 1000)).toBe('59m ago');
    });

    it('shows hours up to a day', () => {
        expect(formatRelative(60 * 60 * 1000)).toBe('1h ago');
        expect(formatRelative(60 * 60 * 23 * 1000)).toBe('23h ago');
    });

    it('shows days up to a month', () => {
        expect(formatRelative(60 * 60 * 24 * 1000)).toBe('1d ago');
        expect(formatRelative(60 * 60 * 24 * 29 * 1000)).toBe('29d ago');
    });

    it('shows months up to a year', () => {
        expect(formatRelative(60 * 60 * 24 * 30 * 1000)).toBe('1mo ago');
        expect(formatRelative(60 * 60 * 24 * 30 * 11 * 1000)).toBe('11mo ago');
    });

    it('shows years above 12 months', () => {
        expect(formatRelative(60 * 60 * 24 * 30 * 12 * 1000)).toBe('1y ago');
        expect(formatRelative(60 * 60 * 24 * 30 * 30 * 1000)).toBe('2y ago');
    });
});

describe('isStale', () => {
    const now = 1_700_000_000_000;

    it('returns false when no last-update or interval is given', () => {
        expect(isStale(undefined, 1000, now)).toBe(false);
        expect(isStale(now, undefined, now)).toBe(false);
    });

    it('returns false when the last update is within the expected window', () => {
        expect(isStale(now - 500, 1000, now)).toBe(false);
    });

    it('returns true when the last update is older than the expected window', () => {
        expect(isStale(now - 1500, 1000, now)).toBe(true);
    });
});
