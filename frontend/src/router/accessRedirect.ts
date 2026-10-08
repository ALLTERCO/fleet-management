import {
    NO_ACCESS_PATH,
    type PageAccessContext,
    redirectForPageAccess,
    resolveDefaultPage
} from '@/auth/pageAccess';
import {LOGIN_PATH, ORGANIZE_PATH} from '@/constants';

export type AccessRedirectContext = PageAccessContext & {
    hasNoPermissions: boolean;
};

// Enough hops for alias, page and landing redirects; more means a cycle.
const MAX_REDIRECT_HOPS = 8;

/**
 * One redirect decision for a signed-in user with loaded permissions. The
 * chain is followed here, so the router redirects once to a page that admits.
 */
export function resolveAccessRedirect(
    path: string,
    access: AccessRedirectContext
): string | null {
    const visited = new Set<string>([path]);
    let current = path;
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
        const next = nextRedirect(current, access);
        if (next === null || next === current) {
            return current === path ? null : current;
        }
        if (visited.has(next)) break;
        visited.add(next);
        current = next;
    }
    console.error('[router] access redirect cycle', [...visited]);
    return path === NO_ACCESS_PATH ? null : NO_ACCESS_PATH;
}

function nextRedirect(
    path: string,
    access: AccessRedirectContext
): string | null {
    if (access.hasNoPermissions) {
        return path === NO_ACCESS_PATH ? null : NO_ACCESS_PATH;
    }
    if (path === NO_ACCESS_PATH) {
        return resolveDefaultPage(access) === NO_ACCESS_PATH ? null : '/';
    }
    const pageRedirect = redirectForPageAccess(path, access);
    if (pageRedirect) return pageRedirect;
    if (path === '/organize') return ORGANIZE_PATH;
    if (path === LOGIN_PATH || path === '/') return resolveDefaultPage(access);
    return null;
}
