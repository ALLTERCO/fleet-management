import {computed} from 'vue';
import {useAuthStore} from '@/stores/auth';

type HostUser = {
    id?: string;
    email?: string;
    name?: string;
    username?: string;
    isAdmin: boolean;
    loggedIn: boolean;
};

export function useCurrentUser() {
    const auth = useAuthStore();

    return computed<HostUser>(() => ({
        id:
            auth.zitadelUser?.id == null
                ? undefined
                : String(auth.zitadelUser.id),
        email: auth.zitadelUser?.email,
        name: auth.displayName || auth.zitadelUser?.name,
        username: auth.username ?? undefined,
        isAdmin: auth.isAdmin,
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
