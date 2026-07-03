import {describe, expect, it} from 'vitest';

import {firstString} from '@/helpers/firstString';

describe('firstString', () => {
    it('returns the first non-empty string', () => {
        expect(firstString('alpha', 'beta')).toBe('alpha');
    });

    it('skips empty strings to find the next candidate', () => {
        expect(firstString('', 'alpha')).toBe('alpha');
    });

    it('skips non-string values silently', () => {
        expect(firstString({name: 'X'}, 'alpha')).toBe('alpha');
        expect(firstString([1, 2], 'alpha')).toBe('alpha');
        expect(firstString(42, 'alpha')).toBe('alpha');
    });

    it('returns null when no candidate is a non-empty string', () => {
        expect(firstString(null, undefined, '')).toBe(null);
        expect(firstString({}, [], 0, false)).toBe(null);
    });

    it('returns null when called with no arguments', () => {
        expect(firstString()).toBe(null);
    });
});
