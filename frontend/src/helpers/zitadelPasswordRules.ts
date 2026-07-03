// Password-policy rule list + check helpers. Mirrors the Zitadel default
// policy (length, upper, lower, number). Surface for the create-user
// form and any future change-password UI — the rule labels are the SoT
// shown to the user.

import {ZITADEL_PASSWORD_MIN_LENGTH} from '@/constants';

export interface PasswordRule {
    key: 'length' | 'upper' | 'lower' | 'number';
    label: string;
    valid: boolean;
}

// Answer — the 4-rule list with valid flags for a given password.
export function passwordRulesFor(password: string): PasswordRule[] {
    return [
        {
            key: 'length',
            label: `At least ${ZITADEL_PASSWORD_MIN_LENGTH} characters`,
            valid: password.length >= ZITADEL_PASSWORD_MIN_LENGTH
        },
        {
            key: 'upper',
            label: 'At least one upper-case letter',
            valid: /[A-Z]/.test(password)
        },
        {
            key: 'lower',
            label: 'At least one lower-case letter',
            valid: /[a-z]/.test(password)
        },
        {
            key: 'number',
            label: 'At least one number',
            valid: /\d/.test(password)
        }
    ];
}

// Answer — does the password satisfy every rule?
export function isPasswordPolicyValid(password: string): boolean {
    return passwordRulesFor(password).every((rule) => rule.valid);
}

// Answer — does the password satisfy every rule, OR is it empty (so the
// form does not show errors before the user starts typing)?
export function isPasswordValidOrEmpty(password: string): boolean {
    return !password || isPasswordPolicyValid(password);
}

// Email pattern used in the create-user form. Single source so a typo
// fix in one place propagates.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Answer — does the input look like an email address? Trim-aware so a
// trailing space does not pass.
export function isLikelyEmail(value: string): boolean {
    return EMAIL_PATTERN.test(value.trim());
}
