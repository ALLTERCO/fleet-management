// Names for the Fleet screens a template may send an administrator to.
//
// A raw path was never a promise Fleet meant to make, and it has already been
// broken: `/settings/utility-accounting?tab=tariffs` is hardcoded in a template
// and survives today only because `router/routeAliases.ts` still rewrites it.
// A key names the destination instead, so Fleet can move its own URL and every
// template follows without a release.
//
// Raw paths still work, because the keys cannot name a screen that needs an id
// and taking that away would break templates that already ship.

/** Where Fleet's own admin app is mounted; a template owns the site root. */
export const FLEET_ADMIN_MOUNT = '/admin';

/** Paths inside the Fleet admin SPA, below the mount above. */
export const FLEET_ADMIN_DESTINATIONS = {
    // The router picks the real landing page from the reader's permissions,
    // so this one is a root, not a page file.
    home: '/',
    'alert-rules': '/settings/alerts/rules',
    tariffs: '/settings/energy/tariffs'
} as const;

export type FleetAdminDestination = keyof typeof FLEET_ADMIN_DESTINATIONS;

/** A screen no key covers. Fleet may rename one of these without notice. */
export type FleetAdminPath = `/${string}`;

/** The path a key names, or null when no key owns that word. */
export function adminDestinationPath(key: string): string | null {
    // Read through a widened alias so an inherited name (`toString`) cannot
    // reach a lookup at all.
    const table: Readonly<Record<string, string>> = FLEET_ADMIN_DESTINATIONS;
    return Object.hasOwn(table, key) ? table[key] : null;
}

/**
 * The Fleet-relative path to open.
 *
 * A target holding a slash is a raw path and is passed through. A bare word is
 * a destination key, and an unknown one throws rather than opening a 404: a
 * misspelled key that navigated anyway would look like a Fleet bug to the
 * customer reading the screen.
 *
 * Takes a plain string on purpose. The narrow union is the promise, and it
 * lives on `FleetNavigation.openAdmin`; templates compile against a copy of
 * that signature in another repo, so any word at all can reach this guard.
 */
export function resolveAdminDestination(target?: string): string {
    if (!target) return FLEET_ADMIN_DESTINATIONS.home;
    if (target.includes('/')) {
        return target.startsWith('/') ? target : `/${target}`;
    }
    const path = adminDestinationPath(target);
    if (path === null) {
        throw new Error(
            `openAdmin("${target}") names no Fleet destination; use one of ${Object.keys(FLEET_ADMIN_DESTINATIONS).join(', ')} or a path starting with "/"`
        );
    }
    return path;
}

/** The address to open. The mount lives here, beside the paths it prefixes,
 *  so one file knows the whole shape of a Fleet admin URL. */
export function adminDestinationHref(target?: string): string {
    return `${FLEET_ADMIN_MOUNT}${resolveAdminDestination(target)}`;
}
