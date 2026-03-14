import {createRouter, createWebHistory} from 'vue-router/auto';
import {useAuthStore} from '@/stores/auth';
import {trackInteraction} from '@/tools/observability';

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    scrollBehavior(_to, _from, savedPosition) {
        if (savedPosition) return savedPosition;
        return {top: 0};
    }
});

router.beforeEach((to, from, next) => {
    // allow OIDC callback routes to pass
    if (to.path.startsWith('/auth/signinwin') || to.path === '/callback') {
        next();
        return;
    }

    const authStore = useAuthStore();
    if (authStore.loggedIn) {
        // Permissions still loading — let navigation proceed without redirecting
        if (!authStore.permissionsLoaded) {
            if (to.path === '/login') {
                next('/');
                return;
            }
            next();
            return;
        }

        // Check if user has no permissions (after permissions are loaded)
        if (authStore.hasNoPermissions) {
            if (to.path === '/no-permissions') {
                next();
            } else {
                next('/no-permissions');
            }
            return;
        }

        // Allow no-permissions page only if user actually has no permissions
        if (to.path === '/no-permissions' && !authStore.hasNoPermissions) {
            next('/');
            return;
        }

        // Guard admin-only routes
        if (to.path === '/settings/users' && !authStore.isAdmin) {
            next('/settings');
            return;
        }

        if (to.path === '/login') {
            next('/');
            return;
        } else if (to.path == '/') {
            const canAccessDashboards =
                authStore.canReadComponent('dashboards');
            next(canAccessDashboards ? '/dash/1' : '/devices');
            return;
        }
    } else {
        if (to.path === '/login') {
            next();
        } else {
            next('/login');
        }
        return;
    }

    next();
});

router.afterEach((to) => {
    trackInteraction('navigation', 'pageview', to.path);
});

export default router;
