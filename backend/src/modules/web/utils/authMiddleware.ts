import {timingSafeEqual} from 'node:crypto';
import type express from 'express';
import {tuning} from '../../../config';
import type CommandSender from '../../../model/CommandSender';
import type {ComponentName, CrudOperation} from '../../../model/permissions';
import type {FleetRole} from '../../../types/api/authzCatalog';
import {
    canPerformComponentOperationAsync,
    isComponentPermissionAllowed
} from '../../authz/evaluator';
import {
    canCrossOrganizationBoundary,
    canUsePlatformAdmin,
    canUseTenantAdmin
} from '../../authz/evaluator/policies';
import {UNAUTHORIZED_USER} from '../../user';
import {buildSender, senderFromUser} from './senderFromRequest';

function senderFor(user: express.Request['user']): CommandSender | undefined {
    if (!user) return undefined;
    return buildSender(user);
}

function userIsAdmin(user: express.Request['user']): boolean {
    const sender = senderFor(user);
    return sender ? canUseTenantAdmin(sender) : false;
}

function userIsPlatformAdmin(user: express.Request['user']): boolean {
    const sender = senderFor(user);
    return sender ? canUsePlatformAdmin(sender) : false;
}

function userCanCrossOrganizations(user: express.Request['user']): boolean {
    const sender = senderFor(user);
    return sender ? canCrossOrganizationBoundary(sender) : false;
}

function userHasRole(user: express.Request['user'], role: FleetRole): boolean {
    const sender = senderFor(user);
    if (!sender || sender.hasCredentialBoundary()) return false;
    return sender.getRoles().includes(role);
}

type AuthCheck = 'ok' | 'no_token' | 'unauthorized_user';

function checkAuth(req: express.Request): AuthCheck {
    if (!req.token) return 'no_token';
    if (!req.user || req.user.username === UNAUTHORIZED_USER.username) {
        return 'unauthorized_user';
    }
    return 'ok';
}

// A navigation: Sec-Fetch says so, or — when a proxy strips it — a GET for HTML.
function wantsHtmlResponse(req: express.Request): boolean {
    if (req.get('sec-fetch-dest') === 'document') return true;
    if (req.get('sec-fetch-mode') === 'navigate') return true;
    return req.method === 'GET' && acceptsHtml(req);
}

function acceptsHtml(req: express.Request): boolean {
    return (req.get('accept') ?? '').includes('text/html');
}

export function isLoggedIn(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    const result = checkAuth(req);
    if (result === 'no_token') {
        res.status(401).json({error: {code: -32000, message: 'Unauthorized'}});
        return;
    }
    if (result === 'unauthorized_user') {
        res.status(403).json({error: {code: -32000, message: 'Forbidden'}});
        return;
    }
    next();
}

// Browser-aware variant: same auth contract as isLoggedIn, but a 302
// to the SPA root replaces the JSON response when the caller is a top-
// level browser navigation. Lets routes that serve HTML directly (e.g.
// /api/docs) bounce through OIDC and return to the originally-requested
// path. The SPA reads `?returnTo=...` and passes it through the OIDC
// `state.to` parameter so the callback resumes there.
export function isLoggedInOrRedirect(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (checkAuth(req) === 'ok') {
        next();
        return;
    }
    if (wantsHtmlResponse(req)) {
        const dest = `/?returnTo=${encodeURIComponent(req.originalUrl)}`;
        res.redirect(302, dest);
        return;
    }
    isLoggedIn(req, res, next);
}

// Logged-in session OR FM_OBS_AUTH_TOKEN bearer. Constant-time token compare.
export function requireObsAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (matchesObsBearerToken(req)) return next();
    isLoggedIn(req, res, next);
}

function matchesObsBearerToken(req: express.Request): boolean {
    const expected = tuning.observability.authToken;
    if (!expected) return false;
    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '');
    if (!match) return false;
    const presented = Buffer.from(match[1]);
    const expectedBuf = Buffer.from(expected);
    if (presented.length !== expectedBuf.length) return false;
    return timingSafeEqual(presented, expectedBuf);
}

export function isNotDefaultUser(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (req.user && req.user.username === UNAUTHORIZED_USER.username) {
        res.status(403).end();
        return;
    }
    next();
}

export function requiresAdmin(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (
        !req.user ||
        req.user.username === UNAUTHORIZED_USER.username ||
        !userIsAdmin(req.user)
    ) {
        res.status(403).end();
        return;
    }
    next();
}

// HTTP equivalent of the provider-support cross-organization policy.
export function requiresPlatformAdmin(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (
        !req.user ||
        req.user.username === UNAUTHORIZED_USER.username ||
        !userCanCrossOrganizations(req.user)
    ) {
        res.status(403).end();
        return;
    }
    next();
}

// Admin OR auditor — mirrors canViewAuditLog.
export function requiresAuditView(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (!req.user || req.user.username === UNAUTHORIZED_USER.username) {
        res.status(403).end();
        return;
    }
    if (!userIsAdmin(req.user) && !userHasRole(req.user, 'auditor')) {
        res.status(403).end();
        return;
    }
    next();
}

const GRAFANA_ACCESS_GRANTS = new Set([
    'grafana:read',
    'grafana:*',
    'grafana:execute'
]);

function userCanAccessGrafana(user: express.Request['user']): boolean {
    const sender = senderFor(user);
    if (!sender || sender.hasCredentialBoundary()) return false;
    if (canUseTenantAdmin(sender)) return true;
    return sender
        .getPermissions()
        .some((perm) => GRAFANA_ACCESS_GRANTS.has(perm));
}

// Per-user lock on /grafana/*. Without this, isLoggedIn would let every
// authenticated user reach Grafana — OSS Grafana has no notion of
// "user is not allowed Grafana at all" so the gate must live here.
export function requireGrafanaPermission(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (!req.user || req.user.username === UNAUTHORIZED_USER.username) {
        res.status(403).end();
        return;
    }
    if (!userCanAccessGrafana(req.user)) {
        res.status(403).json({error: 'Grafana access required'});
        return;
    }
    next();
}

// V2-aware HTTP gate. Builds a CommandSender so the resolver honors
// credentialBoundary (scoped PAT) the same way @CrudPermission does.
// Grants when the sender holds ANY of the listed permissions (OR).
export function requiresAnyPermission(...required: string[]) {
    return async (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        const user = req.user;
        if (!user || user.username === UNAUTHORIZED_USER.username) {
            res.status(403).end();
            return;
        }
        try {
            const sender = await senderFromUser(user);
            for (const spec of required) {
                const colon = spec.indexOf(':');
                if (colon <= 0) continue;
                const component = spec.slice(0, colon) as ComponentName;
                const operation = spec.slice(colon + 1) as CrudOperation;
                const decision = await canPerformComponentOperationAsync(
                    sender,
                    component,
                    operation
                );
                if (isComponentPermissionAllowed(decision)) {
                    next();
                    return;
                }
            }
            res.status(403).end();
        } catch {
            res.status(403).end();
        }
    };
}

// Exposed for routes that need ad-hoc additive role checks.
export {
    userCanCrossOrganizations,
    userHasRole,
    userIsAdmin,
    userIsPlatformAdmin
};
