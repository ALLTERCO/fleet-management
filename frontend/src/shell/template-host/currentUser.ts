import {computed} from 'vue';
import {useAuthStore} from '@/stores/auth';

type HostUser = {
    id?: string;
    email?: string;
    name?: string;
    username?: string;
    isAdmin: boolean;
    isViewer: boolean;
    roles: readonly string[];
    loggedIn: boolean;
};

export function useCurrentUser() {
    const auth = useAuthStore();

    return computed<HostUser>(() => ({
        // Session isolation keys off this, so it is the store's signed-in
        // identity rather than an optional profile field.
        id: auth.currentUserId ?? undefined,
        email: auth.identity?.email ?? undefined,
        name: auth.displayName ?? undefined,
        username: auth.username ?? undefined,
        isAdmin: auth.isAdmin,
        isViewer: auth.isViewer,
        roles: auth.roles,
        loggedIn: auth.loggedIn
    }));
}

/**
 * Trigger the FM auth-store logout flow (clears local tokens + redirects
 * to Zitadel end_session). Exposed via @host so templates can render an
 * in-template Sign Out button — without it non-admin users can't reach
 * the FM admin SPA's logout link.
 */
export async function signOut(): Promise<void> {
    const auth = useAuthStore();
    await auth.logout();
}

export const auth = {
    useCurrentUser,
    signOut
};
