import {DOMAIN_ERRORS} from '@api/errors';
import {describe, expect, it} from 'vitest';
import {
    domainErrorKind,
    formatRpcError,
    isAuthError,
    isDomainError
} from '@/helpers/domainErrors';

describe('domainErrors.isAuthError', () => {
    it('treats 401 as auth-not-settled (auth machine owns recovery)', () => {
        expect(isAuthError({code: 401})).toBe(true);
    });

    it('does NOT treat 403/PermissionDenied as auth — it must surface', () => {
        expect(isAuthError({code: 403})).toBe(false);
        expect(isAuthError({code: DOMAIN_ERRORS.PermissionDenied.code})).toBe(
            false
        );
    });
});

describe('domainErrors.formatRpcError', () => {
    it('maps GroupNameConflict (2503) to a specific message', () => {
        const err = {code: DOMAIN_ERRORS.GroupNameConflict.code};
        expect(formatRpcError(err)).toMatch(/already exists at this parent/i);
    });

    it('maps LocationDeleteBlockedHasChildren to a remediation prompt', () => {
        const err = {code: DOMAIN_ERRORS.LocationDeleteBlockedHasChildren.code};
        expect(formatRpcError(err)).toMatch(/Delete the child locations first/);
    });

    it('unwraps HTTP error envelopes with nested `.error` field', () => {
        const err = {error: {code: DOMAIN_ERRORS.TagKeyConflict.code}};
        expect(formatRpcError(err)).toMatch(/tag with that key/i);
    });

    it('prefers the mapped message over a backend-supplied message', () => {
        const err = {
            code: DOMAIN_ERRORS.GroupParentCycle.code,
            message: 'Parent change would create a cycle'
        };
        expect(formatRpcError(err)).toMatch(/would loop back on itself/);
    });

    it('falls back to backend message for unmapped known codes', () => {
        const err = {
            code: DOMAIN_ERRORS.ResourceNotFound.code,
            message: 'resource X not found'
        };
        expect(formatRpcError(err)).toBe('resource X not found');
    });

    it('returns the caller-supplied fallback for a non-RPC error', () => {
        expect(formatRpcError(new TypeError('oops'), 'Something broke')).toBe(
            'oops'
        );
        expect(formatRpcError(null, 'Something broke')).toBe('Something broke');
        expect(formatRpcError(undefined, 'Something broke')).toBe(
            'Something broke'
        );
    });

    it('caps absurdly long backend messages to prevent toast blowout', () => {
        const huge = 'x'.repeat(500);
        const err = {code: 999999, message: huge};
        const out = formatRpcError(err, 'fallback');
        expect(out).toBe('fallback');
    });
});

describe('domainErrors.isDomainError', () => {
    it('accepts any registered §9 code', () => {
        expect(isDomainError({code: DOMAIN_ERRORS.OrgScopeRequired.code})).toBe(
            true
        );
        expect(isDomainError({code: DOMAIN_ERRORS.TagNotFound.code})).toBe(
            true
        );
    });

    it('rejects unregistered numeric codes + non-error values', () => {
        expect(isDomainError({code: 999999})).toBe(false);
        expect(isDomainError(null)).toBe(false);
        expect(isDomainError('string')).toBe(false);
    });
});

describe('domainErrors.domainErrorKind', () => {
    it('resolves a numeric code back to its kind name', () => {
        expect(
            domainErrorKind({code: DOMAIN_ERRORS.GroupNameConflict.code})
        ).toBe('GroupNameConflict');
    });

    it('returns null for unknown codes', () => {
        expect(domainErrorKind({code: 12345})).toBeNull();
        expect(domainErrorKind(null)).toBeNull();
    });
});
