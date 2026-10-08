import {IS_CLIENT_BUILD} from '@build-mode';
import {routes} from '@router-routes';
import {createRouter, createWebHistory} from 'vue-router';
import {redirectForAdminBundleAccess} from '@/auth/pageAccess';
import {DEVICES_PATH, LOGIN_PATH, ORGANIZE_PATH} from '@/constants';
import {resolveAccessRedirect} from '@/router/accessRedirect';
import {resolveRouteAlias} from '@/router/routeAliases';
import {useAuthStore} from '@/stores/auth';
import {newBundleIsServed} from '@/tools/bundleVersion';
import {trackInteraction} from '@/tools/observability';
import {isUpdatePending, tryActivateUpdate} from '@/tools/swUpdate';

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

router.beforeEach(async (to, from) => {
    if (isOidcCallback(to.path, from.path)) {
        return true;
    }

    // SW update: full reload to pick up new assets
    if (isUpdatePending() && to.path !== from.path) {
        if (tryActivateUpdate(to.fullPath)) return false;
    }

    // The client bundle gives every non-auth pathname to TemplateHost. Its
    // semantic routes intentionally overlap routes from the full admin SPA
    // (`/alerts`, `/devices`, `/settings`, ...), so none of the admin route
    // aliases or page-access redirects may run here. Authentication remains
    // host-owned; once it is settled, the mounted template owns the pathname.
    if (IS_CLIENT_BUILD) {
        const authStore = useAuthStore();

        if (authStore.status === 'booting') {
            await authStore.waitForSessionReady();
        }

        if (!authStore.loggedIn) {
            return to.path === LOGIN_PATH ? true : LOGIN_PATH;
        }

        if (!authStore.permissionsLoaded) {
            return to.path === LOGIN_PATH ? '/' : true;
        }

        const permissionRedirect = guardPermissions(to.path, authStore);
        if (permissionRedirect) return permissionRedirect;

        return to.path === LOGIN_PATH ? '/' : true;
    }

    // Legacy aliases need no auth state at all — rewrite first so cold
    // loads to old URLs never hit the 404 catch-all.
    const aliasRedirect = resolveRouteAlias(to);
    if (aliasRedirect) {
        return aliasRedirect;
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
    // finish loading, resolveAccessRedirect uses the shared page-access registry.
    if (!authStore.permissionsLoaded) {
        if (to.path === LOGIN_PATH) return '/';
        if (to.path === '/organize') return ORGANIZE_PATH;
        if (to.path === '/') return DEVICES_PATH;
        return true;
    }

    const adminBundleRedirect = redirectForAdminBundleAccess(
        import.meta.env.BASE_URL,
        authStore
    );
    if (adminBundleRedirect) {
        window.location.replace(adminBundleRedirect);
        return false;
    }

    const accessRedirect = resolveAccessRedirect(to.path, authStore);
    if (accessRedirect) return accessRedirect;

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
