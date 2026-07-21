import * as http from 'node:http';
import * as net from 'node:net';
import {type Duplex, finished, Transform} from 'node:stream';
import express from 'express';
import {tuning} from '../../config';
import {deviceGuiConfig} from '../../config/deviceGui';
import {deviceGuiSessions} from '../redis/services';
import {reportHandledPeerError} from '../util/faultGuard';
import {
    type DeviceGuiOutcome,
    deviceGuiNetworkOutcome,
    deviceGuiTraceId,
    recordDeviceGuiBytes,
    recordDeviceGuiEvent,
    recordDeviceGuiHttpResponse,
    recordDeviceGuiWebSocketCompression,
    setDeviceGuiActiveWebSockets
} from './deviceGuiDiagnostics';
import {
    authorizeDeviceGuiSession,
    type DeviceGuiTarget,
    deviceGuiCookieValue,
    parseDeviceGuiCookie
} from './deviceGuiSession';
import {AdmissionGate} from './ws/admissionGate';

const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const MAX_UPGRADE_HEADER_BYTES = 32 * 1024;
const REVALIDATE_MS = 30_000;
interface ActiveGuiSocket {
    sessionId: string;
    deviceId?: number;
    externalId?: string;
    targetIp?: string;
    status?: number;
    error?: unknown;
    startedAt: number;
    closeOutcome: DeviceGuiOutcome;
    browserToDeviceBytes: number;
    deviceToBrowserBytes: number;
    reportedBrowserToDeviceBytes: number;
    reportedDeviceToBrowserBytes: number;
}

const activeGuiSockets = new Map<Duplex, ActiveGuiSocket>();
const guiUpgradeAdmissionGate = new AdmissionGate({
    label: 'DeviceGuiWebSocket',
    capPerSec: tuning.ws.admissionMaxPerSec
});
let acceptingGuiUpgrades = true;
let revocationSubscriberStarted = false;
let guiTrafficInterval: NodeJS.Timeout | null = null;

function flushGuiSocketBytes(state: ActiveGuiSocket): void {
    const browserDelta =
        state.browserToDeviceBytes - state.reportedBrowserToDeviceBytes;
    const deviceDelta =
        state.deviceToBrowserBytes - state.reportedDeviceToBrowserBytes;
    state.reportedBrowserToDeviceBytes = state.browserToDeviceBytes;
    state.reportedDeviceToBrowserBytes = state.deviceToBrowserBytes;
    recordDeviceGuiBytes({
        transport: 'websocket',
        direction: 'browser_to_device',
        bytes: browserDelta
    });
    recordDeviceGuiBytes({
        transport: 'websocket',
        direction: 'device_to_browser',
        bytes: deviceDelta
    });
}

function ensureGuiTrafficInterval(): void {
    if (guiTrafficInterval) return;
    guiTrafficInterval = setInterval(() => {
        for (const state of activeGuiSockets.values()) {
            flushGuiSocketBytes(state);
        }
    }, tuning.ws.heartbeatMs);
    guiTrafficInterval.unref();
}

function trackGuiSocket(socket: Duplex, state: ActiveGuiSocket): void {
    activeGuiSockets.set(socket, state);
    ensureGuiTrafficInterval();
    setDeviceGuiActiveWebSockets(activeGuiSockets.size);
}

function setGuiSocketOutcome(socket: Duplex, outcome: DeviceGuiOutcome): void {
    const state = activeGuiSockets.get(socket);
    if (state) state.closeOutcome = outcome;
}

function identifyGuiSocket(socket: Duplex, target: DeviceGuiTarget): void {
    const state = activeGuiSockets.get(socket);
    if (!state) return;
    state.sessionId = target.session.sessionId;
    state.deviceId = target.deviceId;
    state.externalId = target.externalId;
    state.targetIp = target.ips[0];
}

function addGuiSocketBytes(
    socket: Duplex,
    direction: 'browser_to_device' | 'device_to_browser',
    bytes: number
): void {
    const state = activeGuiSockets.get(socket);
    if (!state) return;
    if (direction === 'browser_to_device') {
        state.browserToDeviceBytes += bytes;
    } else {
        state.deviceToBrowserBytes += bytes;
    }
}

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

function frameHeaders(res: express.Response): void {
    res.removeHeader('X-Frame-Options');
    res.setHeader(
        'Content-Security-Policy',
        "sandbox allow-scripts allow-forms; frame-ancestors 'self'"
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
}

function requestHeaders(
    headers: http.IncomingHttpHeaders,
    deviceIp: string
): http.OutgoingHttpHeaders {
    const out: http.OutgoingHttpHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower)) continue;
        if (
            lower === 'host' ||
            lower === 'cookie' ||
            lower === 'authorization' ||
            lower === 'origin' ||
            lower === 'referer' ||
            lower.startsWith('x-forwarded-') ||
            lower.startsWith('x-fm-')
        ) {
            continue;
        }
        out[key] = value;
    }
    out.host = deviceIp;
    return out;
}

function responseHeaders(
    upstream: http.IncomingMessage,
    res: express.Response,
    proxyPrefix: string
): void {
    for (const [key, value] of Object.entries(upstream.headers)) {
        if (value === undefined) continue;
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower)) continue;
        if (lower === 'set-cookie') continue;
        if (lower === 'server-timing' || lower.startsWith('x-fm-')) continue;
        if (
            lower === 'content-security-policy' ||
            lower === 'x-frame-options' ||
            lower === 'service-worker-allowed' ||
            lower === 'clear-site-data'
        ) {
            continue;
        }
        if (lower === 'location') {
            try {
                const location = new URL(String(value), 'http://device');
                res.setHeader(
                    key,
                    `${proxyPrefix}${location.pathname.replace(/^\//, '')}${location.search}`
                );
            } catch {}
        } else {
            res.setHeader(key, value);
        }
    }
    frameHeaders(res);
}

function proxyHttpAttempt(input: {
    req: express.Request;
    res: express.Response;
    target: DeviceGuiTarget;
    ipIndex: number;
    port: number;
    proxyPrefix: string;
    upstreamPath: string;
    startedAt: number;
}): void {
    const deviceIp = input.target.ips[input.ipIndex];
    if (!deviceIp) {
        recordDeviceGuiEvent({
            stage: 'http',
            outcome: 'unreachable',
            level: 'warn',
            deviceId: input.target.deviceId,
            externalId: input.target.externalId,
            method: input.req.method,
            path: input.upstreamPath,
            durationMs: performance.now() - input.startedAt
        });
        if (!input.res.headersSent) {
            recordDeviceGuiHttpResponse(502);
            input.res.status(502).send('Device web server is unreachable');
        }
        return;
    }
    let receivedResponse = false;
    let requestTooLarge = false;
    let connected = false;
    let requestBytes = 0;
    let requestBytesRecorded = false;
    const recordRequestBytes = () => {
        if (requestBytesRecorded) return;
        requestBytesRecorded = true;
        recordDeviceGuiBytes({
            transport: 'http',
            direction: 'browser_to_device',
            bytes: requestBytes
        });
    };
    const hasBody =
        Number(input.req.get('content-length') ?? 0) > 0 ||
        input.req.headers['transfer-encoding'] !== undefined;
    const upstream = http.request(
        {
            hostname: deviceIp,
            port: input.port,
            method: input.req.method,
            path: input.upstreamPath,
            headers: requestHeaders(input.req.headers, deviceIp)
        },
        (response) => {
            receivedResponse = true;
            const status = response.statusCode ?? 502;
            recordDeviceGuiHttpResponse(status);
            input.res.status(status);
            responseHeaders(response, input.res, input.proxyPrefix);
            const trace = deviceGuiTraceId(input.target.session.sessionId);
            if (trace) input.res.setHeader('X-FM-Device-GUI-Trace', trace);
            input.res.setHeader(
                'Server-Timing',
                `device-gui;dur=${Math.round(performance.now() - input.startedAt)}`
            );
            let responseBytes = 0;
            let responseBytesRecorded = false;
            const recordResponseBytes = () => {
                if (responseBytesRecorded) return;
                responseBytesRecorded = true;
                recordDeviceGuiBytes({
                    transport: 'http',
                    direction: 'device_to_browser',
                    bytes: responseBytes
                });
            };
            response.on('data', (chunk: Buffer) => {
                responseBytes += chunk.length;
            });
            response.on('end', () => {
                recordRequestBytes();
                recordResponseBytes();
                recordDeviceGuiEvent({
                    stage: 'http',
                    outcome: 'success',
                    level:
                        input.upstreamPath === '/' ||
                        input.upstreamPath.startsWith('/index.')
                            ? 'info'
                            : 'silent',
                    sessionId: input.target.session.sessionId,
                    deviceId: input.target.deviceId,
                    externalId: input.target.externalId,
                    targetIp: deviceIp,
                    method: input.req.method,
                    path: input.upstreamPath,
                    status,
                    durationMs: performance.now() - input.startedAt,
                    browserToDeviceBytes: requestBytes,
                    deviceToBrowserBytes: responseBytes
                });
            });
            response.on('error', (error) => {
                recordRequestBytes();
                recordResponseBytes();
                recordDeviceGuiEvent({
                    stage: 'http',
                    outcome: deviceGuiNetworkOutcome(error),
                    level: 'warn',
                    sessionId: input.target.session.sessionId,
                    deviceId: input.target.deviceId,
                    externalId: input.target.externalId,
                    targetIp: deviceIp,
                    method: input.req.method,
                    path: input.upstreamPath,
                    durationMs: performance.now() - input.startedAt,
                    browserToDeviceBytes: requestBytes,
                    deviceToBrowserBytes: responseBytes,
                    error
                });
                if (!input.res.destroyed) input.res.destroy(error);
            });
            response.pipe(input.res);
        }
    );
    const connectTimer = setTimeout(() => {
        upstream.destroy(new Error('Device GUI connection timed out'));
    }, deviceGuiConfig.connectTimeoutMs);
    connectTimer.unref();
    const clearConnectTimer = () => clearTimeout(connectTimer);
    upstream.once('response', clearConnectTimer);
    upstream.once('error', clearConnectTimer);
    upstream.once('socket', (socket) => {
        const startBody = () => {
            clearConnectTimer();
            connected = true;
            upstream.setTimeout(deviceGuiConfig.requestTimeoutMs, () => {
                upstream.destroy(new Error('Device GUI request timed out'));
            });
            if (!hasBody) {
                upstream.end();
                return;
            }
            const limit = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                    requestBytes += chunk.length;
                    if (requestBytes > MAX_REQUEST_BYTES) {
                        requestTooLarge = true;
                        callback(new Error('Device GUI request is too large'));
                        return;
                    }
                    callback(null, chunk);
                },
                flush(callback) {
                    recordRequestBytes();
                    callback();
                }
            });
            limit.on('error', (error) => {
                input.req.unpipe(limit);
                input.req.resume();
                upstream.destroy(error);
            });
            input.req.pipe(limit).pipe(upstream);
        };
        if (socket.readyState === 'open') startBody();
        else socket.once('connect', startBody);
    });
    upstream.on('error', (error) => {
        recordRequestBytes();
        if (requestTooLarge && !input.res.headersSent) {
            recordDeviceGuiEvent({
                stage: 'http',
                outcome: 'request_too_large',
                level: 'warn',
                sessionId: input.target.session.sessionId,
                deviceId: input.target.deviceId,
                externalId: input.target.externalId,
                targetIp: deviceIp,
                method: input.req.method,
                path: input.upstreamPath,
                durationMs: performance.now() - input.startedAt,
                browserToDeviceBytes: requestBytes
            });
            recordDeviceGuiHttpResponse(413);
            input.res.status(413).send('Device GUI request is too large');
            return;
        }
        const canRetry =
            !connected ||
            (!hasBody && ['GET', 'HEAD', 'OPTIONS'].includes(input.req.method));
        if (!receivedResponse && !input.res.headersSent && canRetry) {
            recordDeviceGuiEvent({
                stage: 'http',
                outcome: deviceGuiNetworkOutcome(error),
                level: 'debug',
                sessionId: input.target.session.sessionId,
                deviceId: input.target.deviceId,
                externalId: input.target.externalId,
                targetIp: deviceIp,
                method: input.req.method,
                path: input.upstreamPath,
                durationMs: performance.now() - input.startedAt,
                error
            });
            proxyHttpAttempt({...input, ipIndex: input.ipIndex + 1});
            return;
        }
        if (!receivedResponse && !input.res.headersSent) {
            recordDeviceGuiEvent({
                stage: 'http',
                outcome: deviceGuiNetworkOutcome(error),
                level: 'warn',
                sessionId: input.target.session.sessionId,
                deviceId: input.target.deviceId,
                externalId: input.target.externalId,
                targetIp: deviceIp,
                method: input.req.method,
                path: input.upstreamPath,
                durationMs: performance.now() - input.startedAt,
                error
            });
            recordDeviceGuiHttpResponse(502);
            input.res.status(502).send('Device web server is unreachable');
            return;
        }
        if (!input.res.destroyed) input.res.destroy(error);
    });
    input.req.once('aborted', () => {
        recordRequestBytes();
        recordDeviceGuiEvent({
            stage: 'http',
            outcome: 'client_aborted',
            level: 'debug',
            sessionId: input.target.session.sessionId,
            deviceId: input.target.deviceId,
            externalId: input.target.externalId,
            targetIp: deviceIp,
            method: input.req.method,
            path: input.upstreamPath,
            durationMs: performance.now() - input.startedAt,
            browserToDeviceBytes: requestBytes
        });
        upstream.destroy();
    });
    input.res.once('close', () => {
        if (!input.res.writableEnded) upstream.destroy();
    });
    upstream.flushHeaders();
}

export function buildDeviceGuiRouter(options?: {
    authorize?: typeof authorizeDeviceGuiSession;
    port?: number;
}): express.Router {
    const router = express.Router();
    const authorize = options?.authorize ?? authorizeDeviceGuiSession;
    const requireDeviceGuiSession = async (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        const sessionId = String(req.params.sessionId ?? '');
        if (!/^[a-f0-9]{24}$/.test(sessionId)) {
            recordDeviceGuiEvent({
                stage: 'http',
                outcome: 'invalid_session',
                level: 'debug',
                path: req.path
            });
            recordDeviceGuiHttpResponse(404);
            res.status(404).send('Not found');
            return;
        }
        const contentLength = Number(req.get('content-length') ?? 0);
        if (
            !Number.isFinite(contentLength) ||
            contentLength < 0 ||
            contentLength > MAX_REQUEST_BYTES
        ) {
            recordDeviceGuiEvent({
                stage: 'http',
                outcome: 'request_too_large',
                level: 'warn',
                sessionId,
                method: req.method,
                path: req.path
            });
            recordDeviceGuiHttpResponse(413);
            res.status(413).send('Device GUI request is too large');
            return;
        }
        const cookie = parseDeviceGuiCookie(
            deviceGuiCookieValue(req.headers.cookie) ?? ''
        );
        const target =
            cookie?.sessionId === sessionId
                ? await authorize(sessionId, cookie.secret)
                : null;
        if (!target) {
            recordDeviceGuiEvent({
                stage: 'http',
                outcome: 'invalid_session',
                level: 'debug',
                sessionId,
                method: req.method,
                path: req.path
            });
            recordDeviceGuiHttpResponse(403);
            res.status(403).send('Device GUI session is invalid or expired');
            return;
        }
        res.locals.deviceGuiTarget = target;
        next();
    };
    router.all(
        '/api/device-gui/:sessionId/{*devicePath}',
        requireDeviceGuiSession,
        (req, res) => {
            const sessionId = String(req.params.sessionId);
            const incoming = new URL(req.originalUrl, 'http://localhost');
            const prefix = `/api/device-gui/${sessionId}`;
            const upstreamPath = `${incoming.pathname.slice(prefix.length) || '/'}${incoming.search}`;
            proxyAuthorizedDeviceGuiHttp(
                req,
                res,
                res.locals.deviceGuiTarget as DeviceGuiTarget,
                options?.port ?? 80,
                `/api/device-gui/${sessionId}/`,
                upstreamPath
            );
        }
    );
    return router;
}

export function proxyAuthorizedDeviceGuiHttp(
    req: express.Request,
    res: express.Response,
    target: DeviceGuiTarget,
    port = 80,
    proxyPrefix = '',
    upstreamPath = req.url || '/'
): void {
    proxyHttpAttempt({
        req,
        res,
        target,
        ipIndex: 0,
        port,
        proxyPrefix,
        upstreamPath,
        startedAt: performance.now()
    });
}

export function isDeviceGuiUpgrade(request: http.IncomingMessage): boolean {
    if (!deviceGuiConfig.enabled || !request.url) return false;
    try {
        return new URL(request.url, 'http://localhost').pathname === '/rpc';
    } catch {
        return false;
    }
}

function rejectUpgrade(socket: Duplex, status: string): void {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
}

function upgradeRequest(
    request: http.IncomingMessage,
    deviceIp: string
): string {
    const incoming = new URL(request.url ?? '/rpc', 'http://localhost');
    const lines = [
        `GET ${incoming.pathname}${incoming.search} HTTP/1.1`,
        `Host: ${deviceIp}`,
        `Origin: http://${deviceIp}`
    ];
    for (const [key, value] of Object.entries(request.headers)) {
        const lower = key.toLowerCase();
        if (
            lower === 'host' ||
            lower === 'cookie' ||
            lower === 'authorization' ||
            lower === 'origin' ||
            lower.startsWith('x-forwarded-') ||
            lower.startsWith('x-fm-')
        ) {
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) lines.push(`${key}: ${item}`);
        } else if (value !== undefined) {
            lines.push(`${key}: ${value}`);
        }
    }
    return `${lines.join('\r\n')}\r\n\r\n`;
}

function pipeUpgradeResponse(
    upstream: net.Socket,
    downstream: Duplex,
    onHandshake: (headers: string[]) => void,
    onBytes: (bytes: number) => void
): void {
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
        onBytes(chunk.length);
        buffered = Buffer.concat([buffered, chunk]);
        if (buffered.length > MAX_UPGRADE_HEADER_BYTES) {
            upstream.destroy(
                new Error('Device GUI upgrade headers are too large')
            );
            return;
        }
        const boundary = buffered.indexOf('\r\n\r\n');
        if (boundary < 0) return;

        const headerLines = buffered
            .subarray(0, boundary)
            .toString('latin1')
            .split('\r\n');
        onHandshake(headerLines);
        upstream.pause();
        upstream.off('data', onData);
        const rewritten: string[] = [];
        for (const line of headerLines) {
            const separator = line.indexOf(':');
            if (
                separator <= 0 ||
                line.slice(0, separator).toLowerCase() !== 'set-cookie'
            ) {
                rewritten.push(line);
            }
        }
        downstream.write(`${rewritten.join('\r\n')}\r\n\r\n`, 'latin1');
        const rest = buffered.subarray(boundary + 4);
        if (rest.length > 0) downstream.write(rest);
        upstream.on('data', (data: Buffer) => onBytes(data.length));
        upstream.pipe(downstream);
        upstream.resume();
    };
    upstream.on('data', onData);
}

function connectUpgrade(input: {
    request: http.IncomingMessage;
    socket: Duplex;
    head: Buffer;
    target: DeviceGuiTarget;
    ipIndex: number;
    port: number;
    startedAt: number;
    lastError?: unknown;
    lastOutcome?: DeviceGuiOutcome;
    revalidate?: () => Promise<boolean>;
}): void {
    const deviceIp = input.target.ips[input.ipIndex];
    if (!deviceIp) {
        setGuiSocketOutcome(input.socket, input.lastOutcome ?? 'unreachable');
        const state = activeGuiSockets.get(input.socket);
        if (state) state.error = input.lastError;
        rejectUpgrade(input.socket, '502 Bad Gateway');
        return;
    }
    let connected = false;
    let revalidate: NodeJS.Timeout | null = null;
    const upstream = net.connect(input.port, deviceIp, () => {
        connected = true;
        identifyGuiSocket(input.socket, input.target);
        const socketState = activeGuiSockets.get(input.socket);
        if (socketState) socketState.targetIp = deviceIp;
        const request = upgradeRequest(input.request, deviceIp);
        addGuiSocketBytes(
            input.socket,
            'browser_to_device',
            Buffer.byteLength(request)
        );
        upstream.write(request);
        if (input.head.length > 0) {
            addGuiSocketBytes(
                input.socket,
                'browser_to_device',
                input.head.length
            );
            upstream.write(input.head);
        }
        input.socket.on('data', (data: Buffer) =>
            addGuiSocketBytes(input.socket, 'browser_to_device', data.length)
        );
        input.socket.pipe(upstream);
        pipeUpgradeResponse(
            upstream,
            input.socket,
            (headers) => {
                const trace = deviceGuiTraceId(input.target.session.sessionId);
                if (trace) headers.push(`X-FM-Device-GUI-Trace: ${trace}`);
                const status = Number(
                    /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(headers[0] ?? '')?.[1]
                );
                const state = activeGuiSockets.get(input.socket);
                if (state) state.status = status;
                if (status !== 101) {
                    setGuiSocketOutcome(input.socket, 'upgrade_rejected');
                    return;
                }
                upstream.setTimeout(0);
                const extensions =
                    headers.find((line) =>
                        line
                            .toLowerCase()
                            .startsWith('sec-websocket-extensions:')
                    ) ?? '';
                const compression = extensions
                    .toLowerCase()
                    .includes('permessage-deflate');
                const offered = String(
                    input.request.headers['sec-websocket-extensions'] ?? ''
                )
                    .toLowerCase()
                    .includes('permessage-deflate');
                recordDeviceGuiWebSocketCompression(offered, compression);
                recordDeviceGuiEvent({
                    stage: 'websocket',
                    outcome: 'success',
                    level: 'info',
                    sessionId: input.target.session.sessionId,
                    deviceId: input.target.deviceId,
                    externalId: input.target.externalId,
                    targetIp: deviceIp,
                    durationMs: performance.now() - input.startedAt
                });
            },
            (bytes) =>
                addGuiSocketBytes(input.socket, 'device_to_browser', bytes)
        );
        if (input.revalidate) {
            revalidate = setInterval(() => {
                void input.revalidate?.().then(
                    (valid) => {
                        if (!valid) {
                            setGuiSocketOutcome(input.socket, 'revoked');
                            input.socket.destroy();
                        }
                    },
                    () => {
                        setGuiSocketOutcome(input.socket, 'internal_error');
                        input.socket.destroy();
                    }
                );
            }, REVALIDATE_MS);
            revalidate.unref();
        }
    });
    upstream.setTimeout(deviceGuiConfig.connectTimeoutMs);
    upstream.on('timeout', () => {
        upstream.destroy(new Error('Device GUI connection timed out'));
    });
    upstream.on('error', (error) => {
        if (!connected && !input.socket.destroyed) {
            recordDeviceGuiEvent({
                stage: 'websocket',
                outcome: deviceGuiNetworkOutcome(error),
                level: 'debug',
                sessionId: input.target.session.sessionId,
                deviceId: input.target.deviceId,
                externalId: input.target.externalId,
                targetIp: deviceIp,
                durationMs: performance.now() - input.startedAt,
                error
            });
            connectUpgrade({
                ...input,
                ipIndex: input.ipIndex + 1,
                lastError: error,
                lastOutcome: deviceGuiNetworkOutcome(error)
            });
            return;
        }
        const outcome = deviceGuiNetworkOutcome(error);
        setGuiSocketOutcome(input.socket, outcome);
        const state = activeGuiSockets.get(input.socket);
        if (state) state.error = error;
        if (!input.socket.destroyed) input.socket.destroy();
    });
    finished(input.socket, () => {
        if (revalidate) clearInterval(revalidate);
        if (!upstream.destroyed) upstream.destroy();
    });
}

export function proxyAuthorizedDeviceGuiUpgrade(input: {
    request: http.IncomingMessage;
    socket: Duplex;
    head: Buffer;
    target: DeviceGuiTarget;
    port?: number;
    revalidate?: () => Promise<boolean>;
}): void {
    connectUpgrade({
        ...input,
        port: input.port ?? 80,
        ipIndex: 0,
        startedAt: performance.now()
    });
}

export async function handleDeviceGuiUpgrade(
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
    authorize: typeof authorizeDeviceGuiSession = authorizeDeviceGuiSession,
    port = 80
): Promise<void> {
    if (!guiUpgradeAdmissionGate.tryAdmit()) {
        recordDeviceGuiEvent({
            stage: 'websocket',
            outcome: 'rate_limited',
            level: 'debug'
        });
        rejectUpgrade(socket, '429 Too Many Requests');
        return;
    }
    if (!acceptingGuiUpgrades) {
        recordDeviceGuiEvent({
            stage: 'websocket',
            outcome: 'revoked',
            level: 'warn'
        });
        rejectUpgrade(socket, '503 Service Unavailable');
        return;
    }
    trackGuiSocket(socket, {
        sessionId: '',
        startedAt: performance.now(),
        closeOutcome: 'closed',
        browserToDeviceBytes: 0,
        deviceToBrowserBytes: 0,
        reportedBrowserToDeviceBytes: 0,
        reportedDeviceToBrowserBytes: 0
    });
    finished(socket, () => {
        const state = activeGuiSockets.get(socket);
        activeGuiSockets.delete(socket);
        if (activeGuiSockets.size === 0 && guiTrafficInterval) {
            clearInterval(guiTrafficInterval);
            guiTrafficInterval = null;
        }
        setDeviceGuiActiveWebSockets(activeGuiSockets.size);
        if (!state?.sessionId) return;
        flushGuiSocketBytes(state);
        recordDeviceGuiEvent({
            stage: 'websocket',
            outcome: state.closeOutcome,
            level: state.closeOutcome === 'closed' ? 'info' : 'warn',
            sessionId: state.sessionId,
            deviceId: state.deviceId,
            externalId: state.externalId,
            targetIp: state.targetIp,
            status: state.status,
            durationMs: performance.now() - state.startedAt,
            browserToDeviceBytes: state.browserToDeviceBytes,
            deviceToBrowserBytes: state.deviceToBrowserBytes,
            error: state.error
        });
    });
    socket.on('error', (error) => {
        reportHandledPeerError('device-gui-upgrade', error);
        const outcome = deviceGuiNetworkOutcome(error);
        setGuiSocketOutcome(socket, outcome);
        const state = activeGuiSockets.get(socket);
        if (state) state.error = error;
        if (!state?.sessionId) {
            recordDeviceGuiEvent({
                stage: 'websocket',
                outcome,
                level: 'debug',
                durationMs: state
                    ? performance.now() - state.startedAt
                    : undefined,
                error
            });
        }
        if (!socket.destroyed) socket.destroy();
    });
    try {
        const cookie = parseDeviceGuiCookie(
            deviceGuiCookieValue(request.headers.cookie) ?? ''
        );
        if (!cookie) {
            setGuiSocketOutcome(socket, 'invalid_session');
            recordDeviceGuiEvent({
                stage: 'websocket',
                outcome: 'invalid_session',
                level: 'debug'
            });
            return rejectUpgrade(socket, '403 Forbidden');
        }
        const target = await authorize(cookie.sessionId, cookie.secret);
        if (!target) {
            setGuiSocketOutcome(socket, 'invalid_session');
            recordDeviceGuiEvent({
                stage: 'websocket',
                outcome: 'invalid_session',
                level: 'debug',
                sessionId: cookie.sessionId
            });
            return rejectUpgrade(socket, '403 Forbidden');
        }
        identifyGuiSocket(socket, target);
        if (!acceptingGuiUpgrades || socket.destroyed) return;
        proxyAuthorizedDeviceGuiUpgrade({
            request,
            socket,
            head,
            target,
            port,
            revalidate: async () =>
                Boolean(await authorize(cookie.sessionId, cookie.secret))
        });
    } catch (error) {
        setGuiSocketOutcome(socket, 'internal_error');
        const state = activeGuiSockets.get(socket);
        if (state) state.error = error;
        if (!state?.sessionId) {
            recordDeviceGuiEvent({
                stage: 'websocket',
                outcome: 'internal_error',
                level: 'error',
                error
            });
        }
        if (!socket.destroyed) rejectUpgrade(socket, '502 Bad Gateway');
    }
}

export function closeDeviceGuiConnections(): void {
    acceptingGuiUpgrades = false;
    for (const [socket, state] of activeGuiSockets) {
        state.closeOutcome = 'closed';
        socket.destroy();
    }
}

export function closeDeviceGuiSessionConnections(sessionId: string): void {
    for (const [socket, state] of activeGuiSockets) {
        if (state.sessionId !== sessionId) continue;
        state.closeOutcome = 'revoked';
        socket.destroy();
    }
}

export async function subscribeDeviceGuiRevocations(): Promise<void> {
    if (revocationSubscriberStarted || !deviceGuiConfig.enabled) return;
    await deviceGuiSessions.onRevoked(closeDeviceGuiSessionConnections);
    revocationSubscriberStarted = true;
}

export default buildDeviceGuiRouter();
