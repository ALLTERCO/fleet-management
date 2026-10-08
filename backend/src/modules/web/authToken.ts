import type express from 'express';

type AuthTokenRequest = Pick<express.Request, 'cookies' | 'headers' | 'path'>;

export function isNodeRedPath(path: string): boolean {
    return path === '/node-red' || path.startsWith('/node-red/');
}

export function selectHttpAuthToken(req: AuthTokenRequest): string {
    if (typeof req.headers.authorization === 'string') {
        const authHeader = req.headers.authorization;
        if (authHeader.includes(' ')) return authHeader.split(' ').at(-1)!;
        return '';
    }

    // Editor browsers authenticate with the editor session cookie, which is
    // not a Fleet Manager token; no cookie may stand in for one there.
    if (isNodeRedPath(req.path)) return '';

    return req.cookies.token || '';
}
