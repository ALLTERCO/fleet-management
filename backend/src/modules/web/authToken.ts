import type express from 'express';

type AuthTokenRequest = Pick<express.Request, 'cookies' | 'headers' | 'path'>;

export function isNodeRedPath(path: string): boolean {
    return path === '/node-red' || path.startsWith('/node-red/');
}

export function selectHttpAuthToken(
    req: AuthTokenRequest,
    nodeRedCookieName: string
): string {
    if (typeof req.headers.authorization === 'string') {
        const authHeader = req.headers.authorization;
        if (authHeader.includes(' ')) return authHeader.split(' ').at(-1)!;
        return '';
    }

    if (isNodeRedPath(req.path) && req.cookies[nodeRedCookieName]) {
        return req.cookies[nodeRedCookieName];
    }

    return req.cookies.token || '';
}
