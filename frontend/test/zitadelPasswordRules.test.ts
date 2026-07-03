import {describe, expect, it} from 'vitest';
import {
    isLikelyEmail,
    isPasswordPolicyValid,
    isPasswordValidOrEmpty,
    passwordRulesFor
} from '@/helpers/zitadelPasswordRules';

describe('passwordRulesFor — 4-rule list mirrors the Zitadel policy', () => {
    it('returns four named rules in stable order so the UI can render them as a checklist', () => {
        const rules = passwordRulesFor('');
        expect(rules.map((r) => r.key)).toEqual([
            'length',
            'upper',
            'lower',
            'number'
        ]);
    });

    it('rules all fail for an empty password so the checklist shows them all unmet', () => {
        const rules = passwordRulesFor('');
        expect(rules.every((r) => !r.valid)).toBe(true);
    });

    it('upper rule fails when only lowercase is present', () => {
        const rule = passwordRulesFor('abcdef').find((r) => r.key === 'upper');
        expect(rule?.valid).toBe(false);
    });

    it('number rule passes when at least one digit is present', () => {
        const rule = passwordRulesFor('abcd1').find((r) => r.key === 'number');
        expect(rule?.valid).toBe(true);
    });
});

describe('isPasswordPolicyValid — strict gate', () => {
    it('rejects an empty password', () => {
        expect(isPasswordPolicyValid('')).toBe(false);
    });

    it('accepts a well-formed password meeting every rule', () => {
        expect(isPasswordPolicyValid('Strong1pass')).toBe(true);
    });

    it('rejects a password missing the number rule', () => {
        expect(isPasswordPolicyValid('StrongPass')).toBe(false);
    });
});

describe('isPasswordValidOrEmpty — form-friendly gate', () => {
    it('treats empty as valid so the form does not warn before the user types', () => {
        expect(isPasswordValidOrEmpty('')).toBe(true);
    });

    it('falls back to the strict policy once the user has typed', () => {
        expect(isPasswordValidOrEmpty('short')).toBe(false);
        expect(isPasswordValidOrEmpty('Strong1pass')).toBe(true);
    });
});

describe('isLikelyEmail — simple format guard', () => {
    it('accepts a normal email', () => {
        expect(isLikelyEmail('alice@example.com')).toBe(true);
    });

    it('rejects whitespace-only input', () => {
        expect(isLikelyEmail('   ')).toBe(false);
    });

    it('trims surrounding whitespace before testing so a stray space passes', () => {
        expect(isLikelyEmail('  alice@example.com  ')).toBe(true);
    });

    it('rejects an email without an @', () => {
        expect(isLikelyEmail('not-an-email')).toBe(false);
    });

    it('rejects an email without a tld dot', () => {
        expect(isLikelyEmail('alice@localhost')).toBe(false);
    });
});
