// Builds the one runtime context the Fleet shell hands to a mounted template.
// Templates receive a projection of Fleet state, never the Pinia store.

import {type ComputedRef, computed} from 'vue';
import type {RouteLocationNormalizedLoaded, Router} from 'vue-router';
import {resolveDeviceLogo, resolveVisualDecoration} from '@/helpers/deviceLogo';
import {useCustomization as useShellCustomization} from '@/shell/customization';
import {useOperationalBindings as useShellOperationalBindings} from '@/shell/operational-bindings';
import {useOrganizationStore} from '@/stores/organization';
import type {shelly_device_t} from '@/types';
import {adminDestinationHref} from '../core/admin-destinations';
import {createFleetClient, createTemplateRuntimeContext} from '../core/client';
import {setDeviceLogoResolver} from '../core/device-logo';
import {createExternalStore} from '../core/external-store';
import {createSessionBoundOperationalBindings} from '../core/operational-bindings';
import {
    ANONYMOUS_SESSION,
    type FleetSessionIdentity,
    sameSessionIdentity
} from '../core/session';
import type {
    FleetOrganizationProfile,
    FleetPermissions,
    FleetRouteLocation,
    FleetUser,
    TemplateCustomization,
    TemplateRuntimeContext
} from '../core/types';
import {setVisualResolver} from '../core/visual';
import {useCurrentUser} from '../currentUser';
import {usePermissions} from '../permissions';
import {createVueStoreBridge} from '../vue/external-store';
import {createFleetConnection} from './fleet-connection';
import {fleetControlSubmitter} from './fleet-controls';
import {createFleetLiveEvents} from './fleet-live-events';
import {fleetAppTransport} from './fleet-transport';

export type FleetRuntimeContextOptions = {
    hostVersion: string;
    router?: Router;
};

/** Opens the Fleet admin SPA at a named destination, or at a raw path. */
function openAdmin(target?: string): void {
    // OIDC state is tab-scoped. Staying in the current tab preserves the
    // authenticated session; opening a noopener tab would force a second
    // login whose callback belongs to the Business Manager shell.
    window.location.assign(adminDestinationHref(target));
}

function routeLocationOf(
    route?: RouteLocationNormalizedLoaded
): FleetRouteLocation {
    if (!route) {
        return {
            pathname: window.location.pathname,
            search: window.location.search,
            hash: window.location.hash
        };
    }
    const parsed = new URL(route.fullPath, window.location.origin);
    return {
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash
    };
}

function sameRouteLocation(
    left: FleetRouteLocation,
    right: FleetRouteLocation
): boolean {
    return (
        left.pathname === right.pathname &&
        left.search === right.search &&
        left.hash === right.hash
    );
}

export function createFleetRuntimeContext(
    options: FleetRuntimeContextOptions
): TemplateRuntimeContext {
    const bridge = createVueStoreBridge();
    const routeLocation = createExternalStore<FleetRouteLocation>(
        routeLocationOf(options.router?.currentRoute.value)
    );
    const updateRouteLocation = (next: FleetRouteLocation): void => {
        if (sameRouteLocation(routeLocation.getSnapshot(), next)) return;
        routeLocation.setSnapshot(next);
    };
    const releaseRoute = options.router?.afterEach((to) => {
        updateRouteLocation(routeLocationOf(to));
    });
    const syncWindowRoute = (): void => updateRouteLocation(routeLocationOf());
    if (!options.router) {
        // pushState/replaceState are synchronized by navigate below. Browser
        // traversal and direct hash changes need their own notifications.
        window.addEventListener('popstate', syncWindowRoute);
        window.addEventListener('hashchange', syncWindowRoute);
    }
    const navigate = async (
        target: string,
        navigationOptions: {replace?: boolean} = {}
    ): Promise<void> => {
        if (options.router) {
            const method = navigationOptions.replace
                ? options.router.replace
                : options.router.push;
            await method.call(options.router, target);
            return;
        }
        window.history[
            navigationOptions.replace ? 'replaceState' : 'pushState'
        ](window.history.state, '', target);
        updateRouteLocation(routeLocationOf());
    };
    const organization = useOrganizationStore();
    const currentUserRef = useCurrentUser();

    const permissions = bridge.toExternalStore(
        usePermissions() as unknown as ComputedRef<FleetPermissions>
    );
    const currentUser = bridge.toExternalStore(
        computed<FleetUser | null>(() =>
            currentUserRef.value.loggedIn ? currentUserRef.value : null
        )
    );
    const customization = bridge.toExternalStore(
        computed<TemplateCustomization>(
            () => useShellCustomization().value as TemplateCustomization
        )
    );
    const organizationProfile = bridge.toExternalStore(
        computed<FleetOrganizationProfile | null>(() => {
            const profile = organization.profile;
            if (!profile) return null;
            return {
                id: profile.id,
                displayName: profile.displayName,
                timezoneDefault: profile.timezoneDefault,
                localeDefault: profile.localeDefault,
                currencyDefault: profile.currencyDefault,
                unitSystemDefault: profile.unitSystemDefault
            };
        })
    );
    const operationalBindingsSource = bridge.toExternalStore(
        computed(() => useShellOperationalBindings().value)
    );
    const identity = bridge.toExternalStore(
        computed<FleetSessionIdentity>(() => {
            const user = currentUserRef.value;
            if (!user.loggedIn) return ANONYMOUS_SESSION;
            return {
                userId: user.id ?? null,
                // The caller-org profile is the authoritative tenant id.
                organizationId: organization.profile?.id ?? null,
                isAdmin: user.isAdmin
            };
        })
    );

    // Any user-field change re-emits, so the exposed store deduplicates down
    // to a real identity change.
    const session = createExternalStore<FleetSessionIdentity>(
        identity.getSnapshot()
    );
    const releaseIdentity = identity.subscribe(() => {
        const next = identity.getSnapshot();
        if (sameSessionIdentity(session.getSnapshot(), next)) return;
        session.setSnapshot(next);
    });
    const operationalBindings = createSessionBoundOperationalBindings({
        source: operationalBindingsSource,
        session
    });

    // Fleet owns the image rules; core only renders what it is handed. Installed
    // here rather than imported by core, which must stay free of Fleet code.
    setDeviceLogoResolver((rawDevice) =>
        resolveDeviceLogo(rawDevice as shelly_device_t)
    );
    // The same rules, for everything else that carries a picture.
    setVisualResolver((subject) => resolveVisualDecoration(subject));

    const connection = createFleetConnection();
    const fleet = createFleetClient({
        transport: fleetAppTransport,
        live: createFleetLiveEvents(fleetAppTransport, connection),
        permissions,
        currentUser,
        controlSubmitter: fleetControlSubmitter
    });

    // The profile backs the tenant id, so it is loaded, not assumed.
    void organization.fetchProfile();

    return createTemplateRuntimeContext({
        fleet,
        customization,
        organizationProfile,
        operationalBindings: operationalBindings.store,
        navigation: {location: routeLocation, navigate, openAdmin},
        session,
        hostVersion: options.hostVersion,
        dispose() {
            releaseRoute?.();
            if (!options.router) {
                window.removeEventListener('popstate', syncWindowRoute);
                window.removeEventListener('hashchange', syncWindowRoute);
            }
            operationalBindings.dispose();
            connection.dispose();
            releaseIdentity();
            bridge.dispose();
        }
    });
}
