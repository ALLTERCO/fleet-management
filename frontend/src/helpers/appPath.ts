// The path as the router sees it, not as the browser reports it.
//
// A runtime-bm deployment serves the operator SPA under /admin/, so
// window.location.pathname reads /admin/login where the route is /login. Every
// guard that compares a raw pathname against a route literal silently stops
// matching there — and a guard that never matches is not a guard, it is a
// redirect loop or a reload in the middle of an OIDC callback.
//
// vue-router already strips the base for its own matching. Anything reading
// window.location directly has to do the same, and it should do it here.

/**
 * Strips the app's base prefix from a browser pathname.
 *
 * Base is normally '/' (nothing to strip) or '/admin/'. A path outside the
 * base is returned untouched — it is not ours to reinterpret.
 */
export function routePathOf(
    pathname: string = window.location.pathname,
    base: string = import.meta.env.BASE_URL
): string {
    const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
    if (!prefix) return pathname || '/';
    if (pathname === prefix) return '/';
    if (pathname.startsWith(`${prefix}/`)) {
        return pathname.slice(prefix.length) || '/';
    }
    return pathname;
}

/** Answer: is the browser sitting on this route, whatever the base? */
export function isRoutePath(
    route: string,
    pathname?: string,
    base?: string
): boolean {
    return routePathOf(pathname, base) === route;
}

/** Answer: is the browser somewhere under this route, whatever the base? */
export function isUnderRoutePath(
    route: string,
    pathname?: string,
    base?: string
): boolean {
    const current = routePathOf(pathname, base);
    return current === route || current.startsWith(`${route}/`);
}
