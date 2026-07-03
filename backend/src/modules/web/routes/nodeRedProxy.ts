import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import {type Duplex, finished} from 'node:stream';
import * as tls from 'node:tls';
import express from 'express';
import log4js from 'log4js';
import {tuning} from '../../../config/tuning';
import type {user_t} from '../../../types';
import * as Observability from '../../Observability';
import {isNodeRedPath} from '../authToken';
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

function segmentMatches(granted: string, required: string): boolean {
    return granted === '*' || granted === required;
}

export function permissionMatches(granted: string, required: string): boolean {
    if (granted === '*' || granted === required) return true;

    const grantedSegments = granted.split(':');
    const requiredSegments = required.split(':');
    if (grantedSegments.length !== requiredSegments.length) return false;
    if (grantedSegments.length < 2) return false;

    return grantedSegments.every((segment, index) =>
        segmentMatches(segment, requiredSegments[index]!)
    );
}

function hasNodeRedPermission(user: user_t | undefined): boolean {
    if (!user || user.username === '<UNAUTHORIZED>') return false;
    // user.permissions is unfiltered; boundary not applied here → deny.
    if (user.credentialBoundary) return false;
    if (user.group === 'admin' || user.isPlatformAdmin === true) {
        return true;
    }
    if (user.permissions.includes('*')) return true;

    // `integration:*` is accepted during rollout for existing integration
    // administrators; new grants should use `automation:update`.
    const required = [
        ...tuning.nodeRed.uiPermissions,
        'integration:*',
        'integration:update'
    ];
    return required.some((need) =>
        user.permissions.some((granted) => permissionMatches(granted, need))
    );
}

// Fail closed: the shared upstream relies on this secret to reject requests
// that bypass FM auth; an empty secret in production would skip that gate.
function requireProxySecret(): string {
    const secret = tuning.nodeRed.proxySecret;
    if (!secret && tuning.nodeRed.proxySecretRequired) {
        throw new Error('FM_NODE_RED_PROXY_SECRET is required');
    }
    return secret;
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

export function requireNodeRedPermission(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (!tuning.nodeRed.enabled) {
        res.status(404).json({error: 'Node-RED is not enabled'});
        return;
    }
    if (!hasNodeRedPermission(req.user)) {
        res.status(403).json({error: 'Node-RED permission required'});
        return;
    }
    if (!hasCallerOrg(req.user)) {
        res.status(403).json({error: 'Node-RED organization required'});
        return;
    }
    next();
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
    return headers;
}

function writeJsonError(
    res: express.Response,
    status: number,
    message: string
) {
    if (!res.headersSent) res.status(status).json({error: message});
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
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

router.post('/session', (req, res) => {
    if (!applySessionCors(req, res)) return;
    if (!req.token) {
        res.status(401).json({error: 'Missing Fleet Manager token'});
        return;
    }
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
    res.cookie(NODE_RED_AUTH_COOKIE, req.token, {
        httpOnly: true,
        secure:
            isSecureRequest(req) ||
            tuning.nodeRed.sessionCookieSameSite === 'none',
        sameSite: tuning.nodeRed.sessionCookieSameSite,
        path: '/node-red'
    });
    res.status(204).end();
});

router.use((req, res) => {
    Observability.incrementCounter('node_red_proxy_requests');
    // A missing required secret is a server misconfig, not a bad request path.
    if (!tuning.nodeRed.proxySecret && tuning.nodeRed.proxySecretRequired) {
        writeJsonError(res, 500, 'Node-RED proxy secret is not configured');
        return;
    }
    let target: URL;
    let headers: http.OutgoingHttpHeaders;
    try {
        target = targetUrl(req.originalUrl);
        headers = proxyHeaders(req);
    } catch {
        writeJsonError(res, 400, 'Invalid Node-RED proxy path');
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
            proxyRes.pipe(res);
        }
    );

    proxyReq.on('timeout', () => {
        proxyReq.destroy(new Error('Node-RED proxy request timed out'));
    });
    proxyReq.on('error', (error) => {
        logger.warn('Node-RED proxy failed: %s', error);
        writeJsonError(res, 502, 'Node-RED is unavailable');
    });

    if (Buffer.isBuffer(rawBody)) {
        proxyReq.end(rawBody);
    } else {
        req.pipe(proxyReq);
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
        const rawHeaders = buffered.subarray(0, headerEnd).toString('latin1');
        const body = buffered.subarray(headerEnd + 4);
        socket.write(filterNodeRedUpgradeResponseHeaders(rawHeaders), 'latin1');
        if (body.length > 0) socket.write(body);
        upstream.pipe(socket);
    };

    upstream.on('data', onData);
}

async function authorizeUpgrade(
    request: http.IncomingMessage
): Promise<user_t | null> {
    const token = parseCookies(request.headers.cookie)[NODE_RED_AUTH_COOKIE];
    if (!token) return null;
    try {
        const {getUserFromToken} = await import('../../user/index.js');
        const user = await getUserFromToken(token);
        if (!hasNodeRedPermission(user ?? undefined)) return null;
        if (!hasCallerOrg(user ?? undefined)) return null;
        return user ?? null;
    } catch (error) {
        logger.warn('Node-RED websocket auth failed: %s', error);
        return null;
    }
}

export function registerNodeRedUpgradeProxy(server: http.Server) {
    server.on('upgrade', (request, socket, head) => {
        if (!tuning.nodeRed.enabled || request.url === undefined) return;
        const incoming = new URL(request.url, 'http://localhost');
        if (!isNodeRedPath(incoming.pathname)) return;

        void (async () => {
            try {
                const user = await authorizeUpgrade(request);
                if (!user) {
                    rejectUpgrade(socket, '403 Forbidden');
                    return;
                }

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
                        upstream.write(
                            buildNodeRedUpgradeRequest(request, target, user)
                        );
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
                    if (!socket.destroyed)
                        rejectUpgrade(socket, '502 Bad Gateway');
                });
                // Tear down upstream once the client socket is done. A clean
                // FIN finishes the socket without an 'error', so use the stream
                // lifecycle (covers end / close / error) instead of a raw close
                // listener — the latter is reserved for ConnectionContext.
                socket.on('error', () => upstream.destroy());
                finished(socket, () => {
                    if (!upstream.destroyed) upstream.destroy();
                });
            } catch (err) {
                logger.warn('Node-RED upgrade auth threw: %s', err);
                if (!socket.destroyed) socket.destroy();
            }
        })();
    });
}

export default router;
