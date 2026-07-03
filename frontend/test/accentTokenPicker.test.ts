// Token list is the source of truth — the Vue picker is a thin renderer.
// Logic-level tests ensure no raw hex sneaks into user data and the
// guard rejects keys outside the curated set.
import {describe, expect, it} from 'vitest';
import {ACCENT_TOKENS, isAccentTokenKey} from '@/config/accentTokens';

describe('ACCENT_TOKENS', () => {
    it('opens with the "Default" entry mapped to null', () => {
        expect(ACCENT_TOKENS[0]).toEqual({key: null, label: 'Default'});
    });

    it('every non-default entry uses a non-empty token key', () => {
        for (const t of ACCENT_TOKENS.slice(1)) {
            expect(typeof t.key).toBe('string');
            expect((t.key as string).length).toBeGreaterThan(0);
        }
    });

    it('no token key contains arbitrary CSS — letters/digits/underscore only', () => {
        for (const t of ACCENT_TOKENS.slice(1)) {
            expect(t.key).toMatch(/^[a-z][a-z0-9_]*$/);
        }
    });
});

describe('isAccentTokenKey guard', () => {
    it('accepts every color in the registry', () => {
        for (const t of ACCENT_TOKENS.slice(1)) {
            expect(isAccentTokenKey(t.key)).toBe(true);
        }
    });

    it('rejects null', () => {
        expect(isAccentTokenKey(null)).toBe(false);
    });

    it('rejects an unknown token', () => {
        expect(isAccentTokenKey('mystery')).toBe(false);
    });

    it('rejects a raw hex value', () => {
        expect(isAccentTokenKey('#4495D1')).toBe(false);
    });
});
