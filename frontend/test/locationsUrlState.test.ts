import {describe, expect, it} from 'vitest';
import {
    isDetailTabKey,
    parseDetailTab,
    parseSelectedId
} from '@/helpers/locationsUrlState';

describe('parseSelectedId', () => {
    it('returns null for missing query', () => {
        expect(parseSelectedId(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseSelectedId('')).toBeNull();
    });

    it('returns null for non-numeric input', () => {
        expect(parseSelectedId('abc')).toBeNull();
    });

    it('returns null for non-integer numbers', () => {
        expect(parseSelectedId('3.14')).toBeNull();
    });

    it('returns null for zero', () => {
        expect(parseSelectedId('0')).toBeNull();
    });

    it('returns null for negative integers', () => {
        expect(parseSelectedId('-5')).toBeNull();
    });

    it('returns the integer for a positive integer string', () => {
        expect(parseSelectedId('42')).toBe(42);
    });

    it('handles array shape from Vue Router (repeated param)', () => {
        expect(parseSelectedId(['7'])).toBe(7);
    });

    it('returns null when the array is empty', () => {
        expect(parseSelectedId([])).toBeNull();
    });

    it('returns null when the array contains a non-string', () => {
        expect(parseSelectedId([42])).toBeNull();
    });
});

describe('parseDetailTab', () => {
    it('returns "overview" for missing query', () => {
        expect(parseDetailTab(undefined)).toBe('overview');
    });

    it('returns "overview" for an unknown value (graceful fallback)', () => {
        expect(parseDetailTab('garbage')).toBe('overview');
    });

    it('returns the parsed tab when valid', () => {
        expect(parseDetailTab('plan')).toBe('plan');
        expect(parseDetailTab('devices')).toBe('devices');
        expect(parseDetailTab('settings')).toBe('settings');
    });

    it('handles array shape from Vue Router', () => {
        expect(parseDetailTab(['plan'])).toBe('plan');
    });
});

describe('isDetailTabKey', () => {
    it('accepts the four known tab keys', () => {
        expect(isDetailTabKey('overview')).toBe(true);
        expect(isDetailTabKey('plan')).toBe(true);
        expect(isDetailTabKey('devices')).toBe(true);
        expect(isDetailTabKey('settings')).toBe(true);
    });

    it('rejects unknown strings', () => {
        expect(isDetailTabKey('summary')).toBe(false);
        expect(isDetailTabKey('')).toBe(false);
    });

    it('rejects non-string values', () => {
        expect(isDetailTabKey(null)).toBe(false);
        expect(isDetailTabKey(undefined)).toBe(false);
        expect(isDetailTabKey(42)).toBe(false);
    });
});
