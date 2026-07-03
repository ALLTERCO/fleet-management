// Express middleware: recognize Bearer scoped tokens on the /rpc routes.
// Runs before isLoggedIn — if the method accepts a scoped token and the
// presented Bearer consumes successfully, req.user is swapped for a
// synthetic user pinned to the token's org.

import type express from 'express';
import {getLogger} from 'log4js';
import {
    getScopedTokenPurpose,
    userForScopedToken
} from '../auth/scopedTokenAccess';
import {consumeScopedToken} from '../auth/scopedTokenRepo';
import {UNAUTHORIZED_USER} from '../user';
import {formatError} from '../util/formatError';
import {refundScopedTokenAttempt, tryScopedTokenAttempt} from './rateLimit';

const logger = getLogger('scopedTokenAuth');

const BEARER_RE = /^Bearer\s+(.+)$/i;

export function extractBearerToken(
    authorization: string | undefined
): string | undefined {
    if (!authorization) return undefined;
    const match = BEARER_RE.exec(authorization);
    if (!match) return undefined;
    const token = match[1].trim();
    return token.length > 0 ? token : undefined;
}

export function methodFromRequest(req: express.Request): string | undefined {
    const fromPath =
        typeof req.params?.method === 'string' ? req.params.method : '';
    if (fromPath) return fromPath;
    const body = req.body as unknown;
    if (body && typeof body === 'object' && 'method' in body) {
        const candidate = (body as {method?: unknown}).method;
        if (typeof candidate === 'string' && candidate.length > 0)
            return candidate;
    }
    return undefined;
}

function isUnauthenticated(req: express.Request): boolean {
    return !req.user || req.user.username === UNAUTHORIZED_USER.username;
}

export function scopedTokenAuthMiddleware(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
): void {
    handleScopedTokenAuth(req, res).then((handled) => {
        if (!handled) next();
    }, next);
}

async function handleScopedTokenAuth(
    req: express.Request,
    res: express.Response
): Promise<boolean> {
    if (!isUnauthenticated(req)) return false;
    const token = extractBearerToken(req.get('authorization'));
    if (!token) return false;
    const method = methodFromRequest(req);
    if (!method) return false;
    const purpose = getScopedTokenPurpose(method);
    if (!purpose) return false;

    // Refund on success so only failed floods drain the per-IP bucket.
    const ip = clientIpOrUnknown(req);
    if (!tryScopedTokenAttempt(ip)) {
        respondRateLimited(res);
        return true;
    }
    const actor = `bearer:${ip}`;
    const row = await tryConsumeScopedToken(token, purpose, actor);
    if (!row) {
        respondUnauthorized(res);
        return true;
    }
    refundScopedTokenAttempt(ip);
    req.user = userForScopedToken(row);
    return false;
}

function clientIpOrUnknown(req: express.Request): string {
    const ip = (req.ip ?? '').trim();
    return ip.length > 0 ? ip : 'unknown';
}

async function tryConsumeScopedToken(
    token: string,
    purpose: string,
    actor: string
) {
    try {
        return await consumeScopedToken(token, purpose, actor);
    } catch (err) {
        logger.warn(
            'scoped token consume failed purpose=%s: %s',
            purpose,
            formatError(err)
        );
        return null;
    }
}

function respondUnauthorized(res: express.Response): void {
    res.status(401)
        .json({error: {code: -32000, message: 'Unauthorized'}})
        .end();
}

function respondRateLimited(res: express.Response): void {
    res.status(429)
        .json({error: 'Too Many Requests', route: 'rpc-scoped-token'})
        .end();
}
