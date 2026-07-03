import {describe, expect, it} from 'vitest';
import {hasNonLatin} from '@/helpers/asciiText';

describe('hasNonLatin', () => {
    it('returns false for pure ASCII text', () => {
        expect(hasNonLatin('Sofia')).toBe(false);
        expect(hasNonLatin('')).toBe(false);
        expect(hasNonLatin('123 Main St.')).toBe(false);
    });

    it('returns true when any character is non-ASCII', () => {
        expect(hasNonLatin('Sofiá')).toBe(true);
        expect(hasNonLatin('Plovdiv, Бг')).toBe(true);
    });

    it('returns true for fully non-ASCII strings', () => {
        expect(hasNonLatin('Москва')).toBe(true);
        expect(hasNonLatin('東京')).toBe(true);
    });
});
