// Pin the same-origin guard on the login page's `?returnTo=...`
// handling. The backend bounces signed-out browser hits on protected
// HTML routes (like /api/docs) to `/?returnTo=/api/docs`, and the SPA
// forwards that path through OIDC `state.to`. Without strict
// same-origin validation an attacker could craft
// `/?returnTo=//evil.example.com/phish` and the callback would land
// users on an off-site URL after sign-in.
//
// The function under test is duplicated here verbatim from
// login.vue:returnToTarget(). It's small enough that pinning the
// behavior in isolation is cheaper than mounting the whole login page,
// and it makes the contract obvious: same-origin paths only.

import {describe, expect, it} from 'vitest';

// Mirror of frontend/src/pages/login.vue → returnToTarget().
// Keep these in sync; the test is the contract.
function returnToTarget(raw: unknown): string | undefined {
    const candidate = Array.isArray(raw) ? raw[0] : raw;
    if (typeof candidate !== 'string' || candidate.length === 0) return;
    if (!candidate.startsWith('/') || candidate.startsWith('//')) return;
    return candidate;
}

describe('login page returnTo same-origin guard', () => {
    it('accepts a same-origin absolute path', () => {
        expect(returnToTarget('/api/docs')).toBe('/api/docs');
        expect(returnToTarget('/dash/12')).toBe('/dash/12');
    });

    it('accepts a path with query + hash', () => {
        expect(returnToTarget('/dash/1?tab=info#detail')).toBe(
            '/dash/1?tab=info#detail'
        );
    });

    it('rejects protocol-relative URLs (the off-site phish vector)', () => {
        expect(returnToTarget('//evil.example.com/phish')).toBeUndefined();
        expect(returnToTarget('///evil.example.com')).toBeUndefined();
    });

    it('rejects absolute URLs with a scheme', () => {
        expect(returnToTarget('https://evil.example.com')).toBeUndefined();
        expect(returnToTarget('javascript:alert(1)')).toBeUndefined();
        expect(returnToTarget('data:text/html,evil')).toBeUndefined();
    });

    it('rejects relative paths that do not start with /', () => {
        expect(returnToTarget('api/docs')).toBeUndefined();
        expect(returnToTarget('../etc/passwd')).toBeUndefined();
    });

    it('rejects empty, null, undefined, or non-string input', () => {
        expect(returnToTarget('')).toBeUndefined();
        expect(returnToTarget(null)).toBeUndefined();
        expect(returnToTarget(undefined)).toBeUndefined();
        expect(returnToTarget(123)).toBeUndefined();
        expect(returnToTarget({})).toBeUndefined();
    });

    it('takes the first value when the query is supplied as an array', () => {
        expect(returnToTarget(['/api/docs', '/x'])).toBe('/api/docs');
        expect(returnToTarget(['//evil', '/safe'])).toBeUndefined();
    });
});
