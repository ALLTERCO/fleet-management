// Workbox copies this function's source into the service worker, so it must not reference anything outside its body.
export function isCacheableSpaNavigation({
    request,
    url
}: {
    request: Pick<Request, 'mode'>;
    url: Pick<URL, 'pathname'>;
}): boolean {
    return (
        request.mode === 'navigate' &&
        ![
            /^\/api/,
            /^\/health/,
            /^\/rpc/,
            /^\/node-red/,
            /^\/grafana/,
            /^\/alexa/,
            /^\/media/,
            /^\/uploads/,
            // Zitadel OIDC must reach the server, never the SW cache.
            /^\/oauth\//,
            /^\/oidc\//,
            /^\/ui\//,
            /^\/\.well-known\//
        ].some((re) => re.test(url.pathname))
    );
}
