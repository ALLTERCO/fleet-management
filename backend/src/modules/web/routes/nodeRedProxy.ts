import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import {type Duplex, finished, pipeline} from 'node:stream';
import * as tls from 'node:tls';
import express from 'express';
import log4js from 'log4js';
import {tuning} from '../../../config/tuning';
import RpcError from '../../../rpc/RpcError';
import type {user_t} from '../../../types';
import {permissionMatches} from '../../nodeRed/access';
import {mayUseNodeRedEditor} from '../../nodeRed/editorAccess';
import {
    checkEditorSession,
    closeEditorSession,
    type EditorSessionRefusal,
    type OpenedEditorSession,
    openEditorSession,
    revokeEditorSessionHolder,
    revokeEditorSessionsForUser
} from '../../nodeRed/editorSession';
import {trackEditorTunnel} from '../../nodeRed/editorTunnels';
import {
    type NodeRedEditorIdentity,
    nodeRedUserHeader
} from '../../nodeRed/editorUserToken';
import {isNodeRedAdminPath} from '../../nodeRed/flowClient';
import {
    NODE_RED_WRONG_ORGANIZATION,
    nodeRedOrgAllows
} from '../../nodeRed/orgLock';
import {readNodeRedStatus} from '../../nodeRed/statusProbe';
import * as Observability from '../../Observability';
import {ANONYMOUS_USERNAME} from '../../user/anonymous';
import {reportHandledPeerError} from '../../util/faultGuard';
import {isNodeRedPath} from '../authToken';
import {isLoggedIn} from '../utils/authMiddleware';
import {isSecureRequest} from '../utils/secureCookie';

const logger = log4js.getLogger('node-red-proxy');
const router = express.Router();
const LEGACY_NODE_RED_AUTH_COOKIE = 'token';
export const NODE_RED_AUTH_COOKIE = 'fm_node_red_session';

const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade'
]);

export function targetUrl(path: string | undefined): URL {
    const rawPath = path || '/node-red';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawPath) || rawPath.startsWith('//')) {
        throw new Error('absolute Node-RED proxy URL is not allowed');
    }
    // Encoded separators/dots survive new URL() and only decode upstream, so
    // /node-red/..%2fadmin would pass the prefix check below. Reject them in the
    // path part (queries may legitimately carry them).
    const pathPart = rawPath.split('?')[0]!.toLowerCase();
    if (
        pathPart.includes('%2f') ||
        pathPart.includes('%5c') ||
        pathPart.includes('%2e')
    ) {
        throw new Error('Node-RED proxy path encodes a separator or dot');
    }
    const url = new URL(rawPath, tuning.nodeRed.proxyTarget);
    // Reject `..` traversal that escapes the prefix (e.g. /node-red/../admin).
    // Single chokepoint for both the HTTP and WS proxy paths.
    if (
        url.pathname !== '/node-red' &&
        !url.pathname.startsWith('/node-red/')
    ) {
        throw new Error('Node-RED proxy path escaped the /node-red prefix');
    }
    return url;
}

// The permission rule itself lives in modules/nodeRed/access.ts, because the
// RPC surface enforces the same one. Re-exported so existing importers of this
// route module keep working.
export {permissionMatches};

// Fail closed: the shared upstream relies on this secret to reject requests
// that bypass FM auth; an empty secret in production would skip that gate.
export function requireProxySecret(): string {
    if (proxySecretMissing()) {
        throw new Error('FM_NODE_RED_PROXY_SECRET is required');
    }
    return tuning.nodeRed.proxySecret;
}

/** A required secret that is empty is a server misconfig, not a bad request. */
export function proxySecretMissing(): boolean {
    return !tuning.nodeRed.proxySecret && tuning.nodeRed.proxySecretRequired;
}

function callerOrg(user: user_t | undefined): string {
    const org = user?.organizationId;
    if (!org) throw new Error('Node-RED caller has no organization');
    return org;
}

// Requests are org-scoped for upstream tenant isolation; no org = no access.
function hasCallerOrg(user: user_t | undefined): boolean {
    return Boolean(user?.organizationId);
}

type EditorAccessProblem =
    | 'wrongOrganization'
    | 'permissionRequired'
    | 'organizationRequired';

// Throws when the permission shape cannot be loaded: unknown, not "no".
async function editorAccessProblem(
    user: user_t | undefined
): Promise<EditorAccessProblem | undefined> {
    // Cheap and fail-closed, so it runs before the permission lookup.
    if (!nodeRedOrgAllows(user?.organizationId)) return 'wrongOrganization';
    if (!(await mayUseNodeRedEditor(user))) return 'permissionRequired';
    if (!hasCallerOrg(user)) return 'organizationRequired';
    return undefined;
}

function sendPermissionCheckFailure(
    res: express.Response,
    error: unknown
): void {
    const status = error instanceof RpcError ? 503 : 500;
    logger.error('Node-RED permission check failed: %s', error);
    res.status(status).json({error: 'Node-RED permission check failed'});
}

export async function requireNodeRedPermission(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
): Promise<void> {
    if (!tuning.nodeRed.enabled) {
        res.status(404).json({error: 'Node-RED is not enabled'});
        return;
    }
    let problem: EditorAccessProblem | undefined;
    try {
        problem = await editorAccessProblem(req.user);
    } catch (error) {
        sendPermissionCheckFailure(res, error);
        return;
    }
    if (problem) {
        sendProxyError(res, problem);
        return;
    }
    next();
}

function editorIdentity(user: user_t): NodeRedEditorIdentity {
    return {
        username: user.username,
        ...(user.displayName ? {displayName: user.displayName} : {})
    };
}

// Only the editor and admin API learn the user; flows must not read the token.
function editorUserHeaders(
    target: URL,
    user: user_t | undefined
): Record<string, string> {
    if (!user || !isNodeRedAdminPath(target.pathname)) return {};
    return nodeRedUserHeader(editorIdentity(user));
}

function proxyHeaders(req: express.Request): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower)) continue;
        if (lower === 'authorization') continue;
        if (lower === 'cookie') continue;
        if (lower.startsWith('x-fm-')) continue;
        headers[key] = value;
    }

    const target = targetUrl(req.originalUrl);
    headers.host = target.host;
    headers['x-fm-node-red-proxy'] = '1';
    const secret = requireProxySecret();
    if (secret) headers['x-fm-node-red-proxy-secret'] = secret;
    if (req.user?.username) headers['x-fm-user'] = req.user.username;
    headers['x-fm-organization-id'] = callerOrg(req.user);
    return {...headers, ...editorUserHeaders(target, req.user)};
}

// Stable codes so the UI can show a clear sentence instead of a blank page.
const PROXY_ERRORS = {
    unavailable: {
        status: 502,
        code: 'node_red_unavailable',
        error: 'Node-RED is unavailable. It may be stopped or still starting.'
    },
    wrongOrganization: {
        status: 403,
        code: NODE_RED_WRONG_ORGANIZATION,
        error: 'This Node-RED belongs to another organization.'
    },
    secretMissing: {
        status: 500,
        code: 'node_red_misconfigured',
        error: 'Node-RED proxy secret is not configured'
    },
    badPath: {
        status: 400,
        code: 'node_red_bad_path',
        error: 'Invalid Node-RED proxy path'
    },
    sessionExpired: {
        status: 401,
        code: 'node_red_session_expired',
        error: 'The Node-RED editor session has ended. Reopen the editor.'
    },
    permissionRequired: {
        status: 403,
        code: 'node_red_permission_required',
        error: 'Node-RED permission required'
    },
    organizationRequired: {
        status: 403,
        code: 'node_red_organization_required',
        error: 'Node-RED organization required'
    },
    signInRequired: {
        status: 401,
        code: 'node_red_sign_in_required',
        error: 'Missing Fleet Manager token'
    },
    sessionUnavailable: {
        status: 503,
        code: 'node_red_session_unavailable',
        error: 'The Node-RED editor session could not be checked. Try again.'
    }
} as const;

export type NodeRedProxyError = keyof typeof PROXY_ERRORS;

export function sendProxyError(
    res: express.Response,
    kind: NodeRedProxyError
): void {
    if (res.headersSent) return;
    const {status, code, error} = PROXY_ERRORS[kind];
    res.status(status).json({error, code});
}

function requestOrigin(req: express.Request): string | undefined {
    const host =
        req.get('x-forwarded-host')?.split(',').at(0)?.trim() ||
        req.get('host');
    if (!host) return undefined;
    const forwardedProto = req
        .get('x-forwarded-proto')
        ?.split(',')
        .at(0)
        ?.trim()
        .toLowerCase();
    const proto = forwardedProto || req.protocol;
    return `${proto}://${host}`;
}

function allowedSessionOrigin(req: express.Request): string | undefined {
    const origin = req.get('origin');
    if (!origin) return undefined;
    if (origin === requestOrigin(req)) return origin;
    if (
        tuning.nodeRed.sessionAllowedOrigins.some(
            (allowed) => normalizedOrigin(allowed) === origin
        )
    ) {
        return origin;
    }
    return undefined;
}

function normalizedOrigin(value: string): string {
    try {
        return new URL(value).origin;
    } catch {
        return value;
    }
}

function applySessionCors(
    req: express.Request,
    res: express.Response
): boolean {
    const origin = req.get('origin');
    if (!origin) return true;

    const allowed = allowedSessionOrigin(req);
    if (!allowed) {
        res.status(403).json({error: 'Node-RED session origin is not allowed'});
        return false;
    }

    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'authorization, content-type'
    );
    res.setHeader('Vary', 'Origin');
    return true;
}

export function nodeRedSessionPreflight(
    req: express.Request,
    res: express.Response
) {
    if (!tuning.nodeRed.enabled) {
        res.status(404).end();
        return;
    }
    if (!applySessionCors(req, res)) return;
    res.status(204).end();
}

router.options('/session', nodeRedSessionPreflight);

// Same checks the proxy would hit on the first editor request, answered with
// the same JSON, so the UI never loads an error body into the iframe.
async function editorSessionProblem(
    req: express.Request
): Promise<NodeRedProxyError | undefined> {
    if (!nodeRedOrgAllows(req.user?.organizationId)) return 'wrongOrganization';
    if (proxySecretMissing()) return 'secretMissing';
    const status = await readNodeRedStatus();
    return status.reachable ? undefined : 'unavailable';
}

function clearLegacySessionCookies(
    req: express.Request,
    res: express.Response
): void {
    res.clearCookie(LEGACY_NODE_RED_AUTH_COOKIE, {
        path: '/node-red',
        sameSite: 'strict'
    });
    if (isSecureRequest(req)) {
        res.clearCookie(LEGACY_NODE_RED_AUTH_COOKIE, {
            path: '/node-red',
            sameSite: 'strict',
            secure: true
        });
    }
}

function editorCookieOptions(req: express.Request): express.CookieOptions {
    return {
        httpOnly: true,
        secure:
            isSecureRequest(req) ||
            tuning.nodeRed.sessionCookieSameSite === 'none',
        sameSite: tuning.nodeRed.sessionCookieSameSite,
        path: '/node-red'
    };
}

// Whole seconds, rounded up: the cookie may outlive the session, never the reverse.
function cookieMaxAgeMs(session: OpenedEditorSession): number {
    return Math.ceil((session.expiresAt - Date.now()) / 1000) * 1000;
}

function setEditorSessionCookie(
    req: express.Request,
    res: express.Response,
    session: OpenedEditorSession
): void {
    res.cookie(NODE_RED_AUTH_COOKIE, session.sessionId, {
        ...editorCookieOptions(req),
        maxAge: cookieMaxAgeMs(session)
    });
}

function clearEditorSessionCookie(
    req: express.Request,
    res: express.Response
): void {
    res.clearCookie(NODE_RED_AUTH_COOKIE, editorCookieOptions(req));
}

function editorSessionCookie(req: express.Request): string | undefined {
    const value: unknown = req.cookies?.[NODE_RED_AUTH_COOKIE];
    return typeof value === 'string' && value ? value : undefined;
}

type KeepaliveVerdict =
    | {ok: true; user: user_t}
    | {ok: false; error: NodeRedProxyError; revoke: boolean};

// Only a definite "no" ends sessions; a check that could not finish does not.
async function keepaliveVerdict(
    req: express.Request
): Promise<KeepaliveVerdict> {
    if (!req.token) {
        return {ok: false, error: 'signInRequired', revoke: false};
    }
    if (req.authFailure === 'unavailable') {
        return {ok: false, error: 'sessionUnavailable', revoke: false};
    }
    if (req.authFailure === 'org_mismatch') {
        return {ok: false, error: 'wrongOrganization', revoke: true};
    }
    const user = req.user;
    if (!user || user.username === ANONYMOUS_USERNAME) {
        return {ok: false, error: 'sessionExpired', revoke: true};
    }
    const problem = await editorAccessProblem(user);
    return problem
        ? {ok: false, error: problem, revoke: true}
        : {ok: true, user};
}

// The sign-in behind this browser is gone or lost the right: end the user's
// sessions and sockets, not just this cookie.
async function revokeRefusedKeepalive(req: express.Request): Promise<void> {
    const sessionId = editorSessionCookie(req);
    if (sessionId) await revokeEditorSessionHolder(sessionId);
    const userId = signedInUserId(req);
    if (userId) await revokeEditorSessionsForUser(userId);
}

async function renewEditorSession(
    req: express.Request,
    res: express.Response
): Promise<void> {
    if (!applySessionCors(req, res)) return;
    let verdict: KeepaliveVerdict;
    try {
        verdict = await keepaliveVerdict(req);
    } catch (error) {
        sendPermissionCheckFailure(res, error);
        return;
    }
    if (!verdict.ok) {
        if (verdict.revoke) {
            await revokeRefusedKeepalive(req);
            clearEditorSessionCookie(req, res);
        }
        sendProxyError(res, verdict.error);
        return;
    }
    const problem = await editorSessionProblem(req);
    if (problem) {
        sendProxyError(res, problem);
        return;
    }
    const session = await openEditorSession({
        user: verdict.user,
        presentedId: editorSessionCookie(req)
    });
    clearLegacySessionCookies(req, res);
    setEditorSessionCookie(req, res, session);
    res.status(204).end();
}

function handleSessionFailure(res: express.Response, error: unknown): void {
    logger.error('Node-RED editor session store failed: %s', error);
    sendProxyError(res, 'sessionUnavailable');
}

/**
 * POST /node-red/session: the only way to open or renew an editor session,
 * so a session outlives its Fleet Manager sign-in by one idle period at most.
 * Mounted before the editor proxy so a refused keepalive can end the user's
 * sessions instead of meeting a generic 401.
 */
export function renewNodeRedSession(
    req: express.Request,
    res: express.Response
): void {
    if (!tuning.nodeRed.enabled) {
        res.status(404).end();
        return;
    }
    renewEditorSession(req, res).catch((error) =>
        handleSessionFailure(res, error)
    );
}

function signedInUserId(req: express.Request): string | undefined {
    if (!req.token || req.user?.username === ANONYMOUS_USERNAME) {
        return undefined;
    }
    return req.user?.userId;
}

// Logout from this browser; a signed-in caller also ends its other sessions.
async function endEditorSessions(req: express.Request): Promise<void> {
    const sessionId = editorSessionCookie(req);
    if (sessionId) await closeEditorSession(sessionId);
    const userId = signedInUserId(req);
    if (userId) await revokeEditorSessionsForUser(userId);
}

/** DELETE /node-red/session. Open on purpose, like the app's own logout:
 *  only the server can clear an httpOnly cookie. */
export function closeNodeRedSession(
    req: express.Request,
    res: express.Response
): void {
    if (!tuning.nodeRed.enabled) {
        res.status(404).end();
        return;
    }
    if (!applySessionCors(req, res)) return;
    endEditorSessions(req).then(
        () => {
            clearEditorSessionCookie(req, res);
            res.status(204).end();
        },
        (error) => handleSessionFailure(res, error)
    );
}

const REFUSAL_ERRORS: Record<EditorSessionRefusal, NodeRedProxyError> = {
    expired: 'sessionExpired',
    wrongOrganization: 'wrongOrganization',
    permissionLost: 'permissionRequired'
};

async function useEditorSession(
    route: {
        req: express.Request;
        res: express.Response;
        next: express.NextFunction;
    },
    sessionId: string
): Promise<void> {
    const {req, res, next} = route;
    const check = await checkEditorSession(sessionId);
    if (!check.ok) {
        clearEditorSessionCookie(req, res);
        sendProxyError(res, REFUSAL_ERRORS[check.refusal]);
        return;
    }
    req.user = check.user;
    next();
}

function handleSessionCheckFailure(
    res: express.Response,
    error: unknown
): void {
    // Unknown is not "no": a store or policy outage must not read as logout.
    logger.error('Node-RED editor session check failed: %s', error);
    sendProxyError(res, 'sessionUnavailable');
}

/**
 * Bearer callers (API clients, the session endpoint) take the normal login
 * check. A browser brings only the editor session cookie.
 */
export function authenticateNodeRedRequest(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
): void {
    const sessionId = editorSessionCookie(req);
    if (req.headers.authorization !== undefined || !sessionId) {
        isLoggedIn(req, res, next);
        return;
    }
    useEditorSession({req, res, next}, sessionId).catch((error) =>
        handleSessionCheckFailure(res, error)
    );
}

router.use((req, res) => {
    Observability.incrementCounter('node_red_proxy_requests');
    if (proxySecretMissing()) {
        sendProxyError(res, 'secretMissing');
        return;
    }
    let target: URL;
    let headers: http.OutgoingHttpHeaders;
    try {
        target = targetUrl(req.originalUrl);
        headers = proxyHeaders(req);
    } catch {
        sendProxyError(res, 'badPath');
        return;
    }
    const transport = target.protocol === 'https:' ? https : http;
    const rawBody = (req as unknown as {rawBody?: Buffer}).rawBody;

    const proxyReq = transport.request(
        {
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            method: req.method,
            path: `${target.pathname}${target.search}`,
            headers,
            timeout: tuning.nodeRed.proxyTimeoutMs
        },
        (proxyRes) => {
            res.status(proxyRes.statusCode ?? 502);
            for (const [key, value] of Object.entries(proxyRes.headers)) {
                const lower = key.toLowerCase();
                if (HOP_BY_HOP_HEADERS.has(lower)) continue;
                if (lower === 'set-cookie') continue;
                if (value !== undefined) res.setHeader(key, value);
            }
            // pipeline (not pipe) so an upstream reset or client disconnect
            // errors into the callback instead of an unhandled 'error'.
            pipeline(proxyRes, res, (err) => {
                if (err)
                    logger.warn('Node-RED response stream failed: %s', err);
            });
        }
    );

    proxyReq.on('timeout', () => {
        proxyReq.destroy(new Error('Node-RED proxy request timed out'));
    });
    proxyReq.on('error', (error) => {
        logger.warn('Node-RED proxy failed: %s', error);
        sendProxyError(res, 'unavailable');
    });

    if (Buffer.isBuffer(rawBody)) {
        proxyReq.end(rawBody);
    } else {
        pipeline(req, proxyReq, (err) => {
            if (err) logger.warn('Node-RED request stream failed: %s', err);
        });
    }
});

function parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx <= 0) continue;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (!key) continue;
        try {
            out[key] = decodeURIComponent(value);
        } catch {
            out[key] = value;
        }
    }
    return out;
}

function rejectUpgrade(socket: Duplex, status: string) {
    socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
    socket.destroy();
}

export function buildNodeRedUpgradeRequest(
    request: http.IncomingMessage,
    target: URL,
    user: user_t
): string {
    const headers: string[] = [
        `GET ${target.pathname}${target.search} HTTP/1.1`,
        `Host: ${target.host}`,
        'X-FM-Node-RED-Proxy: 1',
        `X-FM-Organization-Id: ${callerOrg(user)}`
    ];
    const secret = requireProxySecret();
    if (secret) headers.push(`X-FM-Node-RED-Proxy-Secret: ${secret}`);
    if (user.username) headers.push(`X-FM-User: ${user.username}`);
    for (const [name, value] of Object.entries(
        editorUserHeaders(target, user)
    )) {
        headers.push(`${name}: ${value}`);
    }

    for (const [key, value] of Object.entries(request.headers)) {
        const lower = key.toLowerCase();
        if (lower === 'host') continue;
        if (lower === 'authorization') continue;
        if (lower === 'cookie') continue;
        if (lower.startsWith('x-fm-')) continue;
        if (Array.isArray(value)) {
            for (const v of value) headers.push(`${key}: ${v}`);
        } else if (value !== undefined) {
            headers.push(`${key}: ${value}`);
        }
    }
    return `${headers.join('\r\n')}\r\n\r\n`;
}

export function filterNodeRedUpgradeResponseHeaders(
    rawHeaders: string
): string {
    const lines = rawHeaders.split('\r\n');
    const filtered = lines.filter((line, index) => {
        if (index === 0) return true;
        const colon = line.indexOf(':');
        if (colon <= 0) return true;
        return line.slice(0, colon).trim().toLowerCase() !== 'set-cookie';
    });
    return `${filtered.join('\r\n')}\r\n\r\n`;
}

// The editor socket lives for hours and idles between heartbeats. The
// connect-phase timeout must not outlive the handshake; keepalive takes over.
function enterLongLivedMode(
    upstream: net.Socket | tls.TLSSocket,
    socket: Duplex
): void {
    upstream.setTimeout(0);
    upstream.setKeepAlive(true, tuning.nodeRed.wsKeepAliveMs);
    if (socket instanceof net.Socket) {
        socket.setTimeout(0);
        socket.setKeepAlive(true, tuning.nodeRed.wsKeepAliveMs);
    }
}

function pipeFilteredUpgradeResponse(
    upstream: net.Socket | tls.TLSSocket,
    socket: Duplex
) {
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        const headerEnd = buffered.indexOf('\r\n\r\n');
        if (headerEnd < 0) {
            if (buffered.length > 64 * 1024) {
                upstream.destroy(
                    new Error('Node-RED upgrade headers too large')
                );
                socket.destroy();
            }
            return;
        }

        upstream.off('data', onData);
        enterLongLivedMode(upstream, socket);
        const rawHeaders = buffered.subarray(0, headerEnd).toString('latin1');
        const body = buffered.subarray(headerEnd + 4);
        socket.write(filterNodeRedUpgradeResponseHeaders(rawHeaders), 'latin1');
        if (body.length > 0) socket.write(body);
        upstream.pipe(socket);
    };

    upstream.on('data', onData);
}

interface AuthorizedUpgrade {
    user: user_t;
    sessionId: string;
}

async function authorizeUpgrade(
    request: http.IncomingMessage
): Promise<AuthorizedUpgrade | null> {
    const sessionId = parseCookies(request.headers.cookie)[
        NODE_RED_AUTH_COOKIE
    ];
    if (!sessionId) return null;
    try {
        const check = await checkEditorSession(sessionId);
        return check.ok ? {user: check.user, sessionId} : null;
    } catch (error) {
        logger.warn('Node-RED websocket auth failed: %s', error);
        return null;
    }
}

/** Opens the upstream socket for an already authorized editor upgrade. */
export function tunnelNodeRedUpgrade(input: {
    request: http.IncomingMessage;
    socket: Duplex;
    head: Buffer;
    user: user_t;
    /** The editor session the socket belongs to; it closes with it. */
    sessionId: string;
}): void {
    const {request, socket, head, user, sessionId} = input;
    const target = targetUrl(request.url);
    const port = Number(
        target.port || (target.protocol === 'https:' ? 443 : 80)
    );
    const upstream =
        target.protocol === 'https:'
            ? tls.connect(port, target.hostname)
            : net.connect(port, target.hostname);

    upstream.setTimeout(tuning.nodeRed.proxyTimeoutMs);
    upstream.once(
        target.protocol === 'https:' ? 'secureConnect' : 'connect',
        () => {
            upstream.write(buildNodeRedUpgradeRequest(request, target, user));
            if (head.length > 0) upstream.write(head);
            socket.pipe(upstream);
            pipeFilteredUpgradeResponse(upstream, socket);
        }
    );
    upstream.on('timeout', () => {
        upstream.destroy();
        if (!socket.destroyed) socket.destroy();
    });
    upstream.on('error', (error) => {
        logger.warn('Node-RED websocket proxy failed: %s', error);
        if (!socket.destroyed) rejectUpgrade(socket, '502 Bad Gateway');
    });
    // Tear down upstream once the client socket is done. A clean
    // FIN finishes the socket without an 'error', so use the stream
    // lifecycle (covers end / close / error) instead of a raw close
    // listener — the latter is reserved for ConnectionContext.
    socket.on('error', () => upstream.destroy());
    const untrack = user.userId
        ? trackEditorTunnel({userId: user.userId, sessionId}, socket)
        : () => undefined;
    finished(socket, () => {
        untrack();
        if (!upstream.destroyed) upstream.destroy();
    });
}

export function registerNodeRedUpgradeProxy(server: http.Server) {
    server.on('upgrade', (request, socket, head) => {
        if (!tuning.nodeRed.enabled || request.url === undefined) return;
        let incoming: URL;
        try {
            incoming = new URL(request.url, 'http://localhost');
        } catch {
            return;
        }
        if (!isNodeRedPath(incoming.pathname)) return;

        // Guard the raw socket before the auth await; a peer reset in that
        // window would otherwise emit an unhandled 'error'. Expected peer
        // behaviour, handled quietly.
        socket.on('error', (err) => {
            reportHandledPeerError('nodered-upgrade', err);
            if (!socket.destroyed) socket.destroy();
        });

        void (async () => {
            try {
                const authorized = await authorizeUpgrade(request);
                if (!authorized) {
                    rejectUpgrade(socket, '403 Forbidden');
                    return;
                }

                tunnelNodeRedUpgrade({request, socket, head, ...authorized});
            } catch (err) {
                logger.warn('Node-RED upgrade auth threw: %s', err);
                if (!socket.destroyed) socket.destroy();
            }
        })();
    });
}

export default router;
