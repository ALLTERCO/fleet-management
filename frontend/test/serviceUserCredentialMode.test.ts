import {describe, expect, it} from 'vitest';
import {
    SERVICE_USER_CREDENTIAL_MODE,
    SERVICE_USER_TOKEN_MODEL,
    serviceUserIdentityLabel
} from '../src/helpers/serviceUserCredentialMode';

describe('service user credential mode', () => {
    it('keeps service users as non-interactive machine identities', () => {
        expect(SERVICE_USER_CREDENTIAL_MODE.interactiveSignInDisabled).toBe(
            true
        );
        expect(SERVICE_USER_CREDENTIAL_MODE.signInLabel).toBe('Disabled');
    });

    it('shows both display name and username when they differ', () => {
        expect(
            serviceUserIdentityLabel({
                name: 'CI Worker',
                userName: 'svc-ci'
            })
        ).toBe('CI Worker (svc-ci)');
    });

    it('does not duplicate the same identity twice', () => {
        expect(
            serviceUserIdentityLabel({
                name: 'svc-ci',
                userName: 'svc-ci'
            })
        ).toBe('svc-ci');
    });

    it('describes Zitadel PATs and FM scoped tokens as different credentials', () => {
        expect(SERVICE_USER_TOKEN_MODEL.zitadelDescription).toContain(
            'full effective FM access'
        );
        expect(SERVICE_USER_TOKEN_MODEL.scopedDescription).toContain(
            'only narrow'
        );
    });
});
