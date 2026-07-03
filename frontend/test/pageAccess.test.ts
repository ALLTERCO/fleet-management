import {describe, expect, it} from 'vitest';

import {
    canAccessPage,
    type PageAccessContext,
    redirectForPageAccess,
    resolveDefaultPage
} from '@/auth/pageAccess';
import {
    ALERTS_PATH,
    DASHBOARDS_PATH,
    DEVICES_PATH,
    ORGANIZE_PATH,
    SETTINGS_PATH
} from '@/constants';
import type {ComponentName, CrudOperation} from '@/helpers/sharedInfo';

function pageAccess(
    overrides: Partial<PageAccessContext> = {}
): PageAccessContext {
    return {
        isAdmin: false,
        canAccessPlatformAdmin: false,
        canReadPolicies: false,
        canViewAuditLog: false,
        canPerformComponent: () => false,
        ...overrides
    };
}

function componentKey(
    component: ComponentName,
    operation: CrudOperation
): string {
    return `${component}:${operation}`;
}

function componentAccess(
    allowed: readonly [ComponentName, CrudOperation][]
): PageAccessContext['canPerformComponent'] {
    const keys = new Set(
        allowed.map(([component, operation]) =>
            componentKey(component, operation)
        )
    );
    return (component, operation) =>
        keys.has(componentKey(component, operation));
}

describe('pageAccess', () => {
    it('allows unknown pages because backend RPC gates remain authoritative', () => {
        expect(canAccessPage('/custom/plugin-page', pageAccess())).toBe(true);
    });

    it('redirects admin-only pages for non-admin users', () => {
        expect(redirectForPageAccess('/settings/branding', pageAccess())).toBe(
            SETTINGS_PATH
        );
    });

    it('allows admin-only pages for admins', () => {
        expect(
            redirectForPageAccess(
                '/settings/branding',
                pageAccess({isAdmin: true})
            )
        ).toBeNull();
    });

    it('keeps provider-support pages hidden from tenant admins', () => {
        expect(
            redirectForPageAccess(
                '/settings/identity-policies',
                pageAccess({isAdmin: true})
            )
        ).toBe(SETTINGS_PATH);
    });

    it('allows provider-support pages for provider-support admins', () => {
        expect(
            redirectForPageAccess(
                '/settings/identity-policies',
                pageAccess({canAccessPlatformAdmin: true})
            )
        ).toBeNull();
    });

    it('uses audit permission before the broader monitoring admin rule', () => {
        expect(
            redirectForPageAccess(
                '/monitoring/audit-log',
                pageAccess({canViewAuditLog: true})
            )
        ).toBeNull();

        expect(
            redirectForPageAccess(
                '/monitoring/control-panel',
                pageAccess({canViewAuditLog: true})
            )
        ).toBe('/no-permissions');
    });

    it('requires waiting-room read access for waiting-room pages', () => {
        const access = pageAccess({
            canPerformComponent: componentAccess([['waiting_room', 'read']])
        });

        expect(redirectForPageAccess('/waiting-room', access)).toBeNull();
        expect(
            redirectForPageAccess('/waiting-room/item-1', access)
        ).toBeNull();
        expect(redirectForPageAccess('/waiting-room', pageAccess())).toBe(
            '/no-permissions'
        );
    });

    it('requires devices read access for device pages', () => {
        const dashboardOnly = pageAccess({
            canPerformComponent: componentAccess([['dashboards', 'read']])
        });

        expect(redirectForPageAccess('/devices', dashboardOnly)).toBe(
            DASHBOARDS_PATH
        );
        expect(
            redirectForPageAccess(
                '/devices',
                pageAccess({
                    canPerformComponent: componentAccess([['devices', 'read']])
                })
            )
        ).toBeNull();
    });

    it('requires matching component access for organize subpages', () => {
        const locationReader = pageAccess({
            canPerformComponent: componentAccess([['locations', 'read']])
        });

        expect(ORGANIZE_PATH).toBe('/organize/locations');
        expect(redirectForPageAccess('/organize', locationReader)).toBeNull();
        expect(
            redirectForPageAccess('/organize/locations', locationReader)
        ).toBeNull();
        expect(redirectForPageAccess('/organize/groups', locationReader)).toBe(
            ORGANIZE_PATH
        );
    });


    it('requires alerts read access for alert management pages', () => {
        const alertsReader = pageAccess({
            canPerformComponent: componentAccess([['alerts', 'read']])
        });

        expect(redirectForPageAccess(ALERTS_PATH, alertsReader)).toBeNull();
        expect(redirectForPageAccess('/alerts/rules', alertsReader)).toBeNull();
    });

    it('keeps authz simulator provider-support only', () => {
        expect(
            redirectForPageAccess(
                '/settings/authz-simulator',
                pageAccess({isAdmin: true})
            )
        ).toBe(SETTINGS_PATH);
        expect(
            redirectForPageAccess(
                '/settings/authz-simulator',
                pageAccess({canAccessPlatformAdmin: true})
            )
        ).toBeNull();
    });

    it('redirects denied pages to the first accessible section', () => {
        expect(
            redirectForPageAccess(
                '/monitoring/audit-log',
                pageAccess({
                    canPerformComponent: componentAccess([['devices', 'read']])
                })
            )
        ).toBe(DEVICES_PATH);
    });

    it('resolves the default page from the same page-access order', () => {
        expect(
            resolveDefaultPage(
                pageAccess({
                    canPerformComponent: componentAccess([
                        ['devices', 'read'],
                        ['dashboards', 'read']
                    ])
                })
            )
        ).toBe(DASHBOARDS_PATH);
        expect(
            resolveDefaultPage(
                pageAccess({
                    canPerformComponent: componentAccess([['devices', 'read']])
                })
            )
        ).toBe(DEVICES_PATH);
        expect(resolveDefaultPage(pageAccess())).toBe('/no-permissions');
    });

    it('redirects audit log readers without another section to no-permissions when audit access is missing', () => {
        expect(
            redirectForPageAccess('/monitoring/audit-log', pageAccess())
        ).toBe('/no-permissions');
    });
});
