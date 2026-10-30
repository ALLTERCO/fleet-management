import {describe, expect, it} from 'vitest';
import {
    redirectForPageAccess,
    type PageAccessContext
} from '../src/auth/pageAccess';

function access(isAdmin: boolean): PageAccessContext {
    return {
        isAdmin,
        canAccessPlatformAdmin: false,
        canManageAutomations: false,
        canReadPolicies: false,
        canViewAuditLog: false,
        hasGrafanaAccess: false,
        canPerformComponent: (component, operation) =>
            component === 'alerts' && operation === 'read'
    };
}

describe('alert destination detail access', () => {
    it('enforces the same admin gate as notification channels', () => {
        const viewer = access(false);
        const channelsRedirect = redirectForPageAccess(
            '/settings/alerts/channels/7',
            viewer
        );
        expect(channelsRedirect).not.toBeNull();
        expect(
            redirectForPageAccess('/settings/alerts/destinations/7', viewer)
        ).toBe(channelsRedirect);
        expect(redirectForPageAccess('/alerts', viewer)).toBeNull();
    });

    it('allows both channel and destination detail pages for admins', () => {
        const admin = access(true);
        expect(redirectForPageAccess('/settings/alerts/channels/7', admin)).toBeNull();
        expect(
            redirectForPageAccess('/settings/alerts/destinations/7', admin)
        ).toBeNull();
    });
});
