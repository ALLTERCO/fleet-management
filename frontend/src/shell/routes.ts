export const SHELL_SYSTEM_ROUTES = Object.freeze([
    '/callback',
    '/login',
    '/no-permissions',
    '/auth/signinwin/zitadel'
]);

export function isShellSystemRoute(path: string): boolean {
    return (
        SHELL_SYSTEM_ROUTES.includes(path) || path.startsWith('/auth/signinwin')
    );
}
