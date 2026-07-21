import {routes} from '@router-routes';
import {createRouter, createWebHistory} from 'vue-router';
import {redirectForPageAccess, resolveDefaultPage} from '@/auth/pageAccess';
import {
    DEVICES_PATH,
    LOGIN_PATH,
    NODE_RED_ENABLED,
    ORGANIZE_PATH
} from '@/constants';
import {useAuthStore} from '@/stores/auth';
import {newBundleIsServed} from '@/tools/bundleVersion';
import {trackInteraction} from '@/tools/observability';
import {isUpdatePending, tryActivateUpdate} from '@/tools/swUpdate';

const IS_CLIENT_BUILD = import.meta.env.MODE === 'client';

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
    scrollBehavior(_to, _from, savedPosition) {
        if (savedPosition) return savedPosition;
        return {top: 0};
    }
});

// Why: OIDC callback is timing-sensitive — SW reload would break the code exchange
function isOidcCallback(toPath: string, fromPath: string): boolean {
    return (
        toPath === '/callback' ||
        toPath.startsWith('/auth/signinwin') ||
        fromPath === '/callback'
    );
}

// One release generation of aliases only: paths that existed in the
// previous release redirect to their new home; older aliases are gone.
function guardLegacyRouteAliases(toPath: string): string | null {
    // Alerts and Monitoring moved under Settings — old links and bookmarks
    // keep working.
    if (toPath === '/alerts' || toPath.startsWith('/alerts/')) {
        return `/settings${toPath}`;
    }
    if (toPath === '/monitoring' || toPath.startsWith('/monitoring/')) {
        return `/settings${toPath}`;
    }
    // Device Auth moved under Settings > Security.
    if (toPath === '/operations/device-auth') {
        return '/settings/security/credentials';
    }
    if (toPath === '/operations/device-auth/certificates') {
        return '/settings/security/certificates';
    }
    // The launcher hubs were removed — land on the nearest real page.
    if (toPath === '/settings/monitoring/investigate') {
        return '/settings/monitoring/logs';
    }
    if (toPath === '/settings/monitoring/resources') {
        return '/settings/monitoring/runtime';
    }
    return null;
}

// Why: users with zero permissions should only see the no-permissions page
function guardPermissions(
    toPath: string,
    authStore: ReturnType<typeof useAuthStore>
): string | null {
    if (authStore.hasNoPermissions)
        return toPath === '/no-permissions' ? null : '/no-permissions';
    if (toPath === '/no-permissions') return '/';
    return null;
}

router.beforeEach((to, from) => {
    if (isOidcCallback(to.path, from.path)) {
        return true;
    }

    // SW update: full reload to pick up new assets
    if (isUpdatePending() && to.path !== from.path) {
        if (tryActivateUpdate(to.fullPath)) return false;
    }

    // Legacy aliases need no auth state at all — rewrite first so cold
    // loads to old URLs never hit the 404 catch-all.
    const legacyRedirect = guardLegacyRouteAliases(to.path);
    if (legacyRedirect) {
        return legacyRedirect;
    }

    const authStore = useAuthStore();

    if (authStore.status === 'booting') {
        if (to.path === '/organize') return ORGANIZE_PATH;
        if (to.path === '/') return DEVICES_PATH;
        return true;
    }

    // Not logged in — only allow /login
    if (!authStore.loggedIn) {
        if (to.path === LOGIN_PATH) return true;
        return LOGIN_PATH;
    }

    // Logged in but permissions still loading — allow navigation, block /login.
    // `/` is a special case: there's no pages/index.vue route, so without an
    // explicit redirect here the auto-routes catch-all renders a 404 page in
    // the brief window between login and permissionsLoaded. Once permissions
    // finish loading, resolveDefaultPage uses the shared page-access registry.
    if (!authStore.permissionsLoaded) {
        if (to.path === LOGIN_PATH) return '/';
        if (to.path === '/organize') return ORGANIZE_PATH;
        if (to.path === '/') return DEVICES_PATH;
        return true;
    }

    // Permission guards
    const permRedirect = guardPermissions(to.path, authStore);
    if (permRedirect) {
        return permRedirect;
    }

    const pageRedirect = redirectForPageAccess(to.path, authStore);
    if (pageRedirect) {
        return pageRedirect;
    }

    if (to.path === '/organize') {
        return ORGANIZE_PATH;
    }

    // Node-RED route gated on FM_NODE_RED_ENABLED → runtime config.
    if (to.path.startsWith('/automations/node-red') && !NODE_RED_ENABLED) {
        return '/automations/actions';
    }

    // Redirect /login → / and / → dash or devices
    if (to.path === LOGIN_PATH) {
        return '/';
    }
    if (!IS_CLIENT_BUILD && to.path === '/') {
        return resolveDefaultPage(authStore);
    }

    return true;
});

// Stale tabs 404 on old hashed chunks after deploy — reload once to refetch the chunk map.
const CHUNK_RELOAD_KEY = 'chunk_reload';

function isChunkLoadError(message: string): boolean {
    return (
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Importing a module script failed') ||
        message.includes('error loading dynamically imported module')
    );
}

async function reloadForNewBundle(target: string): Promise<void> {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        console.error('[chunk-reload] failed again after reload, giving up');
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
        return;
    }
    // Reload only for a genuinely new build, not a transient import failure.
    if (!(await newBundleIsServed())) return;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    console.warn('[chunk-reload] new version deployed, reloading once');
    window.location.assign(target);
}

router.afterEach((to) => {
    trackInteraction('navigation', 'pageview', to.path);
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
});

router.onError((err, to) => {
    if (isChunkLoadError(err?.message || '')) {
        void reloadForNewBundle(to.fullPath);
    }
});

// Catches modulepreload 404s that happen before router.onError sees them.
// preventDefault stops Vite's built-in automatic reload from firing too —
// reloadForNewBundle owns the sessionStorage-guarded reload path.
window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    void reloadForNewBundle(window.location.href);
});

// Backstop for import() rejections that escape both above.
window.addEventListener('unhandledrejection', (event) => {
    const message = String(event.reason?.message ?? event.reason ?? '');
    if (isChunkLoadError(message)) {
        event.preventDefault();
        void reloadForNewBundle(window.location.href);
    }
});

export default router;
