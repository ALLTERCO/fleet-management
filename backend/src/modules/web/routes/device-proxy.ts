/**
 * Device Proxy Routes
 *
 * Provides secure proxy endpoints for accessing device web GUIs through Fleet Manager.
 * This allows users to interact with device web interfaces even when not on the same network.
 *
 * Security:
 * - All endpoints require authentication (Bearer token)
 * - User must have execute permission on the specific device
 * - Proxy is scoped to specific device IDs (no open proxy)
 * - X-Frame-Options set to SAMEORIGIN to prevent embedding on other origins
 */

import * as http from 'node:http';
import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import {promisify} from 'node:util';
import {gunzip} from 'node:zlib';
import express from 'express';
import log4js from 'log4js';
import WebSocket from 'ws';
import type {user_t} from '../../../types';
import * as DeviceCollector from '../../DeviceCollector';
import {UNAUTHORIZED_USER, getUserFromToken} from '../../user';
import {startProxy} from '../device-gui-proxy';
import {canExecuteOnDevice} from '../utils/devicePermissions';

const gunzipAsync = promisify(gunzip);
const logger = log4js.getLogger('device-proxy');
const router = express.Router();

/**
 * Get a fresh device reference from DeviceCollector.
 * The middleware captures a device reference at request time, but if the device
 * reconnects between middleware and RPC calls, the old transport is destroyed
 * and all RPCs fail with instant "Timeout". This helper re-fetches the device
 * to avoid stale references.
 */
function getFreshDevice(shellyID: string) {
    return DeviceCollector.getDevice(shellyID);
}

// Track authenticated GUI sessions (shellyID -> (sessionId -> timestamp))
// This allows sub-resources to load without re-authentication
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const guiSessions = new Map<string, Map<string, number>>();

// Clean up expired sessions every 5 minutes
setInterval(
    () => {
        const now = Date.now();
        for (const [shellyID, sessions] of guiSessions) {
            for (const [sessionId, createdAt] of sessions) {
                if (now - createdAt > SESSION_TTL_MS) {
                    sessions.delete(sessionId);
                }
            }
            if (sessions.size === 0) {
                guiSessions.delete(shellyID);
            }
        }
    },
    5 * 60 * 1000
);

/**
 * Middleware to validate authentication and device access
 */
async function validateDeviceAccess(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    const {shellyID} = req.params;

    // Check authentication
    if (!req.token || !req.user || req.user === UNAUTHORIZED_USER) {
        logger.warn(
            'Unauthorized access attempt to device proxy for %s',
            shellyID
        );
        res.status(401).json({error: 'Authentication required'});
        return;
    }

    // Check if device exists
    const device = DeviceCollector.getDevice(shellyID);
    if (!device) {
        logger.warn('Device not found: %s', shellyID);
        res.status(404).json({error: 'Device not found'});
        return;
    }

    // Check if user has permission to execute on this device
    if (!canExecuteOnDevice(req.user, shellyID)) {
        logger.warn(
            'User %s denied access to device %s',
            req.user.username,
            shellyID
        );
        res.status(403).json({error: 'Access denied to this device'});
        return;
    }

    // Store device in request for downstream handlers
    (req as any).device = device;

    // Set security headers to prevent framing on other origins
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");

    next();
}

/**
 * Middleware for GUI resources - allows sub-resources if main GUI was authenticated
 * This handles CSS, JS, images, etc. that are loaded by the Shelly GUI
 */
async function validateGuiAccess(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    const {shellyID} = req.params;
    const subPath = req.params[0] || '';

    logger.debug(
        'GUI access check: shellyID=%s, subPath=%s, hasToken=%s, user=%s, url=%s',
        shellyID,
        subPath || '(root)',
        !!req.token,
        req.user?.username || 'none',
        req.originalUrl
    );

    // Check if device exists
    const device = DeviceCollector.getDevice(shellyID);
    if (!device) {
        logger.warn('Device not found: %s', shellyID);
        res.status(404).json({error: 'Device not found'});
        return;
    }

    // Store device in request
    (req as any).device = device;

    // Set security headers
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");

    // If token is provided and valid, authenticate normally and create session
    if (req.token && req.user && req.user !== UNAUTHORIZED_USER) {
        if (canExecuteOnDevice(req.user, shellyID)) {
            // Create/update session for this device
            if (!guiSessions.has(shellyID)) {
                guiSessions.set(shellyID, new Map());
            }
            // Use a simple session ID based on user
            const sessionId = req.user.username;
            guiSessions.get(shellyID)!.set(sessionId, Date.now());
            (req as any).guiSession = sessionId;
            logger.debug(
                'GUI session created for %s user %s',
                shellyID,
                sessionId
            );
            next();
            return;
        }
    }

    // For sub-resources OR root with active session, allow access
    // This allows the GUI to reload/navigate within the iframe
    const referer = req.get('referer') || '';
    const hasValidReferer = referer.includes(
        `/api/device-proxy/${shellyID}/gui`
    );
    const hasActiveSession =
        guiSessions.has(shellyID) && guiSessions.get(shellyID)!.size > 0;

    if (hasValidReferer || hasActiveSession) {
        logger.debug(
            'Allowing GUI access for %s: %s (referer=%s, session=%s)',
            shellyID,
            subPath || '(root)',
            hasValidReferer,
            hasActiveSession
        );
        next();
        return;
    }

    // No valid auth
    logger.warn(
        'Unauthorized GUI access for %s, path: %s',
        shellyID,
        subPath || '(root)'
    );
    res.status(401).json({error: 'Authentication required'});
}

/**
 * GET /api/device-proxy/:shellyID/info
 *
 * Returns device information and the proxy URL format for the web GUI.
 * Used by frontend to construct the iframe URL.
 */
router.get('/:shellyID/info', validateDeviceAccess, async (req, res) => {
    const {shellyID} = req.params;
    const device = (req as any).device;

    // Get device IP from status
    const status = device.status;
    const deviceIp = status?.wifi?.sta_ip || status?.eth?.ip;
    const fwVersion = device.info?.ver || '';
    const supportsNativeShellyAddr = isFirmware180OrNewer(fwVersion);

    // Start per-device RPC transport bridge on port 8100-8104.
    // This handles only RPC calls (HTTP + WebSocket) — no content serving.
    let proxyPort: number | null = null;
    try {
        const proxy = await startProxy(shellyID);
        proxyPort = proxy.port;
    } catch (err: any) {
        logger.error(
            'Failed to start RPC bridge for %s: %s',
            shellyID,
            err.message
        );
    }

    logger.info(
        'Device proxy info: %s, ip=%s, online=%s, fw=%s, nativeAddr=%s, proxyPort=%s',
        shellyID,
        deviceIp,
        device.online,
        fwVersion,
        supportsNativeShellyAddr,
        proxyPort
    );

    // Use relative URLs to avoid protocol/host issues with reverse proxies
    const proxyRpcUrl = `/api/device-proxy/${shellyID}/rpc`;
    const fullProxyUrl = `/api/device-proxy/${shellyID}/gui`;

    res.json({
        shellyID,
        deviceIp: deviceIp || null,
        online: device.online,
        proxyRpcUrl,
        guiUrl: deviceIp ? `http://${deviceIp}/` : null,
        fullProxyUrl,
        fwVersion,
        supportsNativeShellyAddr,
        // Port of the per-device HTTP reverse proxy (for direct access)
        proxyPort
    });
});

/**
 * POST /api/device-proxy/:shellyID/rpc
 *
 * Proxies JSON-RPC calls to the device.
 * This is the endpoint that the embedded web GUI will use for RPC calls.
 *
 * Request body should be a JSON-RPC request:
 * { "id": 1, "method": "Shelly.GetStatus", "params": {} }
 */
router.post(
    '/:shellyID/rpc',
    express.json(),
    validateDeviceAccess,
    async (req, res) => {
        const {shellyID} = req.params;
        const device = (req as any).device;

        // Support both JSON-RPC format and direct method/params
        let method: string;
        let params: any;
        const rpcId: any = req.body.id ?? 1;

        if (req.body.method) {
            method = req.body.method;
            params = req.body.params || {};
        } else {
            res.status(400).json({
                jsonrpc: '2.0',
                id: rpcId,
                error: {
                    code: -32600,
                    message: 'Invalid request: method required'
                }
            });
            return;
        }

        try {
            logger.debug(
                'Proxying POST RPC to %s: %s %j',
                shellyID,
                method,
                params
            );

            const result = await device.sendRPC(method, params);

            // Return in JSON-RPC format
            res.json({
                jsonrpc: '2.0',
                id: rpcId,
                result
            });
        } catch (error: any) {
            logger.error('RPC proxy error for %s: %s', shellyID, error.message);

            // Return error in JSON-RPC format
            const errorResponse: any = {
                jsonrpc: '2.0',
                id: rpcId,
                error: {
                    code: error.code || -32603,
                    message: error.message || 'Internal error'
                }
            };

            if (error.data) {
                errorResponse.error.data = error.data;
            }

            res.status(200).json(errorResponse); // JSON-RPC errors still return 200
        }
    }
);

/**
 * GET /api/device-proxy/:shellyID/rpc/:method
 *
 * Proxies GET-style RPC calls to the device.
 * Shelly devices support RPC via GET with the format:
 * /rpc/Method?param1=value1&param2=value2
 *
 * Example: /rpc/Switch.Set?id=0&on=true
 */
router.get('/:shellyID/rpc/:method', validateDeviceAccess, async (req, res) => {
    const {shellyID, method} = req.params;
    const device = (req as any).device;

    // Remove token from params (it's for FM auth, not for device)
    const params: Record<string, any> = {...req.query};
    params.token = undefined;

    // Convert query params to appropriate types
    for (const key of Object.keys(params)) {
        const value = params[key];
        if (value === 'true') params[key] = true;
        else if (value === 'false') params[key] = false;
        else if (!Number.isNaN(Number(value)) && value !== '')
            params[key] = Number(value);
    }

    try {
        logger.debug('Proxying GET RPC to %s: %s %j', shellyID, method, params);

        const result = await device.sendRPC(method, params);

        // Return result directly (GET-style RPC returns result directly, not wrapped in JSON-RPC)
        res.json(result);
    } catch (error: any) {
        logger.error(
            'RPC proxy error for %s %s: %s',
            shellyID,
            method,
            error.message
        );

        res.status(500).json({
            error: error.message || 'Internal error',
            code: error.code
        });
    }
});

/**
 * GET /api/device-proxy/:shellyID/gui-debug
 *
 * Debug endpoint: probes the device to understand HTTP.GET capabilities
 * and the size of GUI assets. Returns a JSON report.
 */
router.get('/:shellyID/gui-debug', validateDeviceAccess, async (req, res) => {
    const {shellyID} = req.params;
    // Re-fetch device to avoid stale reference from middleware
    const device = getFreshDevice(shellyID) || (req as any).device;
    const deviceIp = device.status?.wifi?.sta_ip || device.status?.eth?.ip;
    // Use loopback for RPC-based HTTP probes — the device fetches from
    // its own web server, so 127.0.0.1 avoids network stack overhead.
    const ip = '127.0.0.1';
    const report: Record<string, any> = {
        shellyID,
        timestamp: new Date().toISOString(),
        // Device info
        deviceIp,
        fw: device.info?.ver || 'unknown',
        model: device.info?.model || 'unknown',
        app: device.info?.app || 'unknown',
        gen: device.info?.gen || 'unknown',
        mac: device.info?.mac || 'unknown',
        online: device.online,
        // Transport info
        transport: {
            exists: !!device.transport,
            type: device.transport?.name || null
        },
        // Presence info
        presence: device.presence || null,
        // Request context (helps debug proxy/TLS issues)
        request: {
            protocol: req.protocol,
            forwardedProto: req.headers['x-forwarded-proto'] || null,
            host: req.headers.host || null,
            forwardedFor: req.headers['x-forwarded-for'] || null
        },
        // Device status snapshot
        deviceStatus: {
            wifi: device.status?.wifi || null,
            eth: device.status?.eth || null,
            ble: device.status?.ble || null,
            cloud: device.status?.cloud || null,
            mqtt: device.status?.mqtt || null,
            sys: device.status?.sys || null
        },
        tests: {},
        rangeChunking: null as Record<string, any> | null
    };

    if (!device.online || !device.transport) {
        report.error = 'Device offline';
        res.json(report);
        return;
    }

    // Quick sanity check: single RPC before parallel probes
    // This helps diagnose whether the issue is queue-related or transport-level
    const sanityStart = Date.now();
    try {
        const sanity = await device.sendRPC('Shelly.GetDeviceInfo', {});
        report.sanityCheck = {
            ok: true,
            elapsed: Date.now() - sanityStart,
            id: sanity?.id
        };
    } catch (e: any) {
        report.sanityCheck = {
            ok: false,
            elapsed: Date.now() - sanityStart,
            error: e.message,
            errorCode: e.errorCode || e.code,
            errorStack: e.stack?.split('\n').slice(0, 3)
        };
    }

    // Helper: run an RPC and return a test result object
    async function probe(
        method: string,
        params: Record<string, any>,
        opts?: {bodyPreview?: boolean}
    ): Promise<Record<string, any>> {
        const start = Date.now();
        try {
            const result = await device.sendRPC(method, params);
            const r: Record<string, any> = {
                ok: true,
                elapsed: Date.now() - start,
                code: result?.code,
                message: result?.message || '',
                bodyLength: result?.body?.length || 0,
                bodyB64Length: result?.body_b64?.length || 0,
                headers: result?.headers || {}
            };
            if (opts?.bodyPreview) {
                r.bodyPreview = (result?.body || '').substring(0, 300);
            }
            // For ListMethods
            if (result?.methods) {
                r.count = result.methods.length;
                r.methods = result.methods;
                r.hasHttpGet = result.methods.includes('HTTP.GET');
                r.hasHttpRequest = result.methods.includes('HTTP.Request');
            }
            return r;
        } catch (e: any) {
            return {
                ok: false,
                elapsed: Date.now() - start,
                error: e.message,
                code: e.code
            };
        }
    }

    // Run lightweight probes only — heavy probes (full root GET, range
    // chunking dry-run) were removed because they crash the device by
    // exhausting heap memory. We only need: ListMethods, favicon, HEAD,
    // and one Range chunk to verify the device supports range requests.
    const [listMethods, faviconGet, httpRequestHead, httpRequestRange0] =
        await Promise.all([
            probe('Shelly.ListMethods', {}),
            probe('HTTP.GET', {
                url: `http://${ip}/favicon.ico`,
                timeout: 20
            }),
            probe('HTTP.Request', {
                method: 'HEAD',
                url: `http://${ip}/`,
                timeout: 20,
                headers: {'Accept-Encoding': 'identity'}
            }),
            probe(
                'HTTP.Request',
                {
                    method: 'GET',
                    url: `http://${ip}/`,
                    timeout: 20,
                    headers: {
                        Range: 'bytes=0-4095',
                        'Accept-Encoding': 'identity'
                    }
                },
                {bodyPreview: true}
            )
        ]);

    report.tests = {
        listMethods,
        faviconGet,
        httpRequestHead,
        httpRequestRange0
    };

    // Report cache status instead of doing a destructive dry-run
    const cached = rootPageCache.get(shellyID);
    report.rangeChunking = cached
        ? {
              ok: true,
              cached: true,
              elapsed: 0,
              reassembledBytes: cached.body.length,
              etag: cached.etag,
              cachedAt: new Date(cached.cachedAt).toISOString()
          }
        : {ok: false, cached: false, message: 'Not yet cached'};

    logger.info(
        'GUI debug report for %s: %s',
        shellyID,
        JSON.stringify(report)
    );
    res.json(report);
});

// ============================================================================
// DIRECT HTTP FETCH (FM → device, bypasses RPC)
// ============================================================================

/**
 * Fetch the root page directly from the device via HTTP.
 *
 * This is much faster and gentler on the device than Range chunking
 * (1 HTTP GET vs 60+ RPC calls). It works whenever the FM backend
 * can reach the device IP on port 80 (same LAN / VPN / routed network).
 *
 * Falls back to null if the device is unreachable so the caller can
 * try Range chunking instead.
 */
async function fetchRootPageDirect(
    deviceIp: string,
    shellyID: string
): Promise<{
    body: Buffer;
    contentType: string;
    headers: Record<string, string>;
} | null> {
    return new Promise((resolve) => {
        const req = http.request(
            {
                hostname: deviceIp,
                port: 80,
                path: '/',
                method: 'GET',
                timeout: 10000,
                headers: {
                    host: deviceIp,
                    'accept-encoding': 'identity'
                }
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const body = Buffer.concat(chunks);
                    const contentType =
                        res.headers['content-type'] ||
                        'text/html; charset=utf-8';
                    const headers: Record<string, string> = {};
                    for (const [key, value] of Object.entries(res.headers)) {
                        if (value != null) {
                            headers[key] = Array.isArray(value)
                                ? value.join(', ')
                                : value;
                        }
                    }
                    logger.info(
                        'Direct HTTP fetch [%s]: %d bytes from %s:80',
                        shellyID,
                        body.length,
                        deviceIp
                    );
                    resolve({body, contentType, headers});
                });
                res.on('error', () => resolve(null));
            }
        );

        req.on('timeout', () => {
            logger.info(
                'Direct HTTP fetch [%s]: timeout reaching %s:80',
                shellyID,
                deviceIp
            );
            req.destroy();
            resolve(null);
        });

        req.on('error', (err) => {
            logger.info(
                'Direct HTTP fetch [%s]: cannot reach %s:80 — %s',
                shellyID,
                deviceIp,
                err.message
            );
            resolve(null);
        });

        req.end();
    });
}

// ============================================================================
// RANGE CHUNKING FOR LARGE DEVICE RESPONSES
// ============================================================================

// 4KB chunks → ~5.5KB base64 → ~6KB RPC response JSON.
// Device WS send buffer appears limited to ~8KB on Gen3 (ESP32-C3).
// 8KB chunks produced ~11.5KB responses that never arrived at FM.
const CHUNK_SIZE = 4096;
// Sequential: one chunk at a time to avoid heap + WS buffer pressure.
const CONCURRENCY = 1;

// In-flight range chunking requests per device. If a second GUI request arrives
// while chunking is in progress, it waits for the first to finish and shares
// the result instead of hammering the device with another round of RPCs.
const inFlightChunking = new Map<
    string,
    Promise<{
        body: Buffer;
        contentType: string;
        headers: Record<string, string>;
    }>
>();

// Cache for chunked root pages. Keyed by shellyID, stores the raw chunked
// result (before HTML rewriting). Invalidated when device firmware changes
// (different ETag). Avoids hitting the device on every GUI open.
const rootPageCache = new Map<
    string,
    {
        etag: string;
        body: Buffer;
        contentType: string;
        headers: Record<string, string>;
        cachedAt: number;
    }
>();

/**
 * Fetch a URL from the device using HTTP Range chunking.
 *
 * The root HTML page of the Shelly device GUI is ~271KB (gzipped), which
 * exceeds the ~16KB firmware RPC response buffer. HTTP.GET returns
 * truncated/empty body for large responses.
 *
 * This function works around the limitation by:
 * 1. Sending a HEAD request to get Content-Length
 * 2. Splitting the response into 8KB Range chunks
 * 3. Fetching chunks in parallel rounds of CONCURRENCY (limited by device RAM)
 * 4. Reassembling and optionally decompressing the result
 */
async function fetchViaRangeChunking(
    device: any,
    url: string,
    shellyID: string
): Promise<{
    body: Buffer;
    contentType: string;
    headers: Record<string, string>;
}> {
    const startTime = Date.now();

    // Step 1: HEAD request to get Content-Length and Content-Type
    // Force identity encoding — Range requests on gzip-compressed content
    // don't work (server can't seek in a gzip stream), so we must request
    // uncompressed to enable proper byte-range chunking.
    const headResult = await device.sendRPC('HTTP.Request', {
        method: 'HEAD',
        url,
        timeout: 20,
        headers: {'Accept-Encoding': 'identity'}
    });

    if (!headResult || (headResult.code !== 200 && headResult.code !== 206)) {
        throw new Error(
            `HEAD request failed: HTTP ${headResult?.code ?? 'no response'}`
        );
    }

    const headHeaders: Record<string, string> = headResult.headers || {};
    const contentLength = Number.parseInt(
        headHeaders['Content-Length'] || headHeaders['content-length'] || '0',
        10
    );
    const contentType =
        headHeaders['Content-Type'] ||
        headHeaders['content-type'] ||
        'text/html; charset=utf-8';
    const contentEncoding =
        headHeaders['Content-Encoding'] ||
        headHeaders['content-encoding'] ||
        '';

    if (contentLength === 0) {
        throw new Error('HEAD returned Content-Length 0');
    }

    // Step 2: Calculate chunk ranges
    const totalChunks = Math.ceil(contentLength / CHUNK_SIZE);
    const ranges: Array<{start: number; end: number; index: number}> = [];
    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE - 1, contentLength - 1);
        ranges.push({start, end, index: i});
    }

    logger.info(
        'Range chunking [%s]: %d bytes, %d chunks of %d bytes',
        shellyID,
        contentLength,
        totalChunks,
        CHUNK_SIZE
    );

    // Step 2.5: Verify Range support with a test chunk
    const testStart = Date.now();
    const testResult = await device.sendRPC('HTTP.Request', {
        method: 'GET',
        url,
        timeout: 25,
        headers: {
            Range: `bytes=0-${CHUNK_SIZE - 1}`,
            'Accept-Encoding': 'identity'
        }
    });
    const testMs = Date.now() - testStart;

    if (!testResult || (testResult.code !== 206 && testResult.code !== 200)) {
        throw new Error(
            `Range test chunk failed: HTTP ${testResult?.code ?? 'no response'} (${testMs}ms)`
        );
    }

    // If server returned 200 instead of 206, Range is not supported
    if (testResult.code === 200) {
        logger.warn(
            'Range chunk [%s]: server returned 200 instead of 206 — Range not supported (%dms)',
            shellyID,
            testMs
        );
        // If the full body somehow fits in the response, use it
        let fullBody: Buffer | undefined;
        if (testResult.body_b64) {
            fullBody = Buffer.from(testResult.body_b64, 'base64');
        } else if (testResult.body) {
            fullBody = Buffer.from(testResult.body, 'utf-8');
        }
        if (fullBody && fullBody.length >= contentLength) {
            logger.info(
                'Range chunk [%s]: full body received in single response (%d bytes)',
                shellyID,
                fullBody.length
            );
            return {body: fullBody, contentType, headers: headHeaders};
        }
        throw new Error(
            `Device web server does not support Range requests (returned 200 with ${fullBody?.length || 0} bytes, expected ${contentLength})`
        );
    }

    // Range is supported (206) — decode the test chunk and proceed
    logger.info(
        'Range chunk [%s]: Range supported (206, %dms), proceeding with %d chunks',
        shellyID,
        testMs,
        totalChunks
    );

    // Step 3: Fetch chunks (first chunk already done)
    const buffers: Buffer[] = new Array(totalChunks);

    // Store test chunk result
    if (testResult.body_b64) {
        buffers[0] = Buffer.from(testResult.body_b64, 'base64');
    } else if (testResult.body) {
        buffers[0] = Buffer.from(testResult.body, 'utf-8');
    } else {
        buffers[0] = Buffer.alloc(0);
    }

    // Fetch remaining chunks (start from index 1)
    for (
        let roundStart = 1;
        roundStart < totalChunks;
        roundStart += CONCURRENCY
    ) {
        const roundEnd = Math.min(roundStart + CONCURRENCY, totalChunks);
        const roundRanges = ranges.slice(roundStart, roundEnd);

        const promises = roundRanges.map(async (range) => {
            const chunkStart = Date.now();
            logger.debug(
                'Range chunk [%s]: requesting %d/%d (bytes %d-%d)',
                shellyID,
                range.index + 1,
                totalChunks,
                range.start,
                range.end
            );

            const result = await device.sendRPC('HTTP.Request', {
                method: 'GET',
                url,
                timeout: 25,
                headers: {
                    Range: `bytes=${range.start}-${range.end}`,
                    'Accept-Encoding': 'identity'
                }
            });

            const chunkMs = Date.now() - chunkStart;

            if (!result || (result.code !== 206 && result.code !== 200)) {
                logger.error(
                    'Range chunk [%s]: %d/%d FAILED (%dms) HTTP %s',
                    shellyID,
                    range.index + 1,
                    totalChunks,
                    chunkMs,
                    result?.code ?? 'no response'
                );
                throw new Error(
                    `Range request failed for chunk ${range.index}: HTTP ${result?.code ?? 'no response'}`
                );
            }

            // Decode body: prefer body_b64 (base64), fall back to body (UTF-8)
            if (result.body_b64) {
                buffers[range.index] = Buffer.from(result.body_b64, 'base64');
            } else if (result.body) {
                buffers[range.index] = Buffer.from(result.body, 'utf-8');
            } else {
                buffers[range.index] = Buffer.alloc(0);
            }

            logger.debug(
                'Range chunk [%s]: %d/%d OK (%dms, %d bytes)',
                shellyID,
                range.index + 1,
                totalChunks,
                chunkMs,
                buffers[range.index].length
            );
        });

        await Promise.all(promises);
    }

    // Step 4: Reassemble
    let body = Buffer.concat(buffers);

    // Step 5: Decompress if gzip
    if (contentEncoding.toLowerCase().includes('gzip')) {
        logger.info(
            'Range chunking [%s]: decompressing gzip (%d bytes compressed)',
            shellyID,
            body.length
        );
        body = await gunzipAsync(body);
    }

    const elapsed = Date.now() - startTime;

    // Step 7: Log timing
    logger.info(
        'Range chunking [%s]: reassembled %d bytes in %dms (%d chunks)',
        shellyID,
        body.length,
        elapsed,
        totalChunks
    );

    return {body, contentType, headers: headHeaders};
}

/**
 * Fetch the root page: try direct HTTP first (fast, 1 request),
 * fall back to RPC Range chunking (slow, 60+ RPCs).
 * Caches the result with ETag for subsequent loads.
 */
async function fetchRootPage(
    device: any,
    deviceIp: string,
    shellyID: string,
    targetUrl: string
): Promise<{
    body: Buffer;
    contentType: string;
    headers: Record<string, string>;
}> {
    // Strategy 1: Direct HTTP (FM → device:80)
    const direct = await fetchRootPageDirect(deviceIp, shellyID);
    if (direct && direct.body.length > 0) {
        // Cache it
        const etag = direct.headers.etag || direct.headers.ETag || '';
        if (etag) {
            rootPageCache.set(shellyID, {
                etag,
                body: direct.body,
                contentType: direct.contentType,
                headers: direct.headers,
                cachedAt: Date.now()
            });
            logger.info(
                'Root page cached for %s via direct HTTP (ETag: %s, %d bytes)',
                shellyID,
                etag,
                direct.body.length
            );
        }
        return direct;
    }

    // Strategy 2: RPC Range chunking (slower, works when FM cannot reach device:80)
    logger.info(
        'Direct HTTP failed for %s, falling back to Range chunking',
        shellyID
    );
    return fetchAndCacheRootPage(device, targetUrl, shellyID);
}

/**
 * Fetch root page with deduplication and caching.
 * Wraps fetchViaRangeChunking to prevent duplicate device hits.
 */
async function fetchAndCacheRootPage(
    device: any,
    targetUrl: string,
    shellyID: string
): Promise<{
    body: Buffer;
    contentType: string;
    headers: Record<string, string>;
}> {
    // Deduplicate: if already in flight, wait for the existing request
    let chunkingPromise = inFlightChunking.get(shellyID);
    if (chunkingPromise) {
        logger.info(
            'Range chunking already in progress for %s, waiting',
            shellyID
        );
        return chunkingPromise;
    }

    chunkingPromise = fetchViaRangeChunking(device, targetUrl, shellyID);
    inFlightChunking.set(shellyID, chunkingPromise);

    try {
        const result = await chunkingPromise;
        // Store in cache
        const etag = result.headers.ETag || result.headers.etag || '';
        if (etag) {
            rootPageCache.set(shellyID, {
                etag,
                body: result.body,
                contentType: result.contentType,
                headers: result.headers,
                cachedAt: Date.now()
            });
            logger.info(
                'Root page cached for %s (ETag: %s, %d bytes)',
                shellyID,
                etag,
                result.body.length
            );
        }
        return result;
    } finally {
        inFlightChunking.delete(shellyID);
    }
}

/**
 * GET /api/device-proxy/:shellyID/gui
 * GET /api/device-proxy/:shellyID/gui/*
 *
 * Path-based fallback for the device web GUI proxy.
 * Pipes requests through to the per-device HTTP reverse proxy
 * (device-gui-proxy.ts) which forwards to the device's web server.
 *
 * This route exists for environments where direct port access (8100-8199)
 * is not available (e.g., behind traefik with only port 7011 exposed).
 */
router.get(
    ['/:shellyID/gui', '/:shellyID/gui/*'],
    validateGuiAccess,
    async (req, res) => {
        const {shellyID} = req.params;
        // Re-fetch device to avoid stale reference from middleware
        const device = getFreshDevice(shellyID) || (req as any).device;
        const subPath = req.params[0] || '';
        const deviceIp =
            device.status?.wifi?.sta_ip ||
            device.status?.eth?.ip ||
            '127.0.0.1';

        logger.info(
            'GUI proxy request: shellyID=%s, subPath=%s',
            shellyID,
            subPath || '(root)'
        );

        if (!device.online || !device.transport) {
            res.status(503).json({
                error: 'Device offline',
                message: 'Cannot proxy to device - device is not connected'
            });
            return;
        }

        // Determine if this is a root page request or a sub-resource
        const isRootPage =
            !subPath || subPath === '' || subPath === 'index.html';

        try {
            if (isRootPage) {
                // Root page: ~271KB gzipped, too large for a single RPC.
                // Strategy:
                //   1. Check in-memory cache (ETag validated)
                //   2. Try direct HTTP (FM → device:80, single fast request)
                //   3. Fall back to RPC Range chunking (60+ RPCs, slow, can overwhelm device)
                //
                // For RPC-based fetching, use 127.0.0.1 (loopback) instead
                // of the device's WiFi IP — avoids network stack overhead
                // and reduces memory pressure on the device.
                const targetUrl = `http://127.0.0.1/${subPath}`;

                let fetched: {
                    body: Buffer;
                    contentType: string;
                    headers: Record<string, string>;
                };
                const cached = rootPageCache.get(shellyID);
                if (cached) {
                    // Validate cache with a quick HEAD (single RPC)
                    try {
                        const headResult = await device.sendRPC(
                            'HTTP.Request',
                            {
                                method: 'HEAD',
                                url: targetUrl,
                                timeout: 20,
                                headers: {'Accept-Encoding': 'identity'}
                            }
                        );
                        const etag =
                            headResult?.headers?.ETag ||
                            headResult?.headers?.etag ||
                            '';
                        if (etag && etag === cached.etag) {
                            logger.info(
                                'Root page cache HIT for %s (ETag: %s, cached %ds ago)',
                                shellyID,
                                etag,
                                Math.round(
                                    (Date.now() - cached.cachedAt) / 1000
                                )
                            );
                            fetched = cached;
                        } else {
                            logger.info(
                                'Root page cache STALE for %s (cached ETag: %s, device ETag: %s)',
                                shellyID,
                                cached.etag,
                                etag
                            );
                            rootPageCache.delete(shellyID);
                            fetched = await fetchRootPage(
                                device,
                                deviceIp,
                                shellyID,
                                targetUrl
                            );
                        }
                    } catch {
                        // HEAD failed, use cache anyway
                        logger.info(
                            'HEAD failed for %s, using cached root page',
                            shellyID
                        );
                        fetched = cached;
                    }
                } else {
                    fetched = await fetchRootPage(
                        device,
                        deviceIp,
                        shellyID,
                        targetUrl
                    );
                }

                const contentType = 'text/html; charset=utf-8';
                let html = fetched.body.toString('utf-8');

                const proxyBaseUrl = `/api/device-proxy/${shellyID}/gui/`;
                const proxyRpcUrl = `/api/device-proxy/${shellyID}/rpc`;

                // Rewrite absolute paths in HTML attributes so resources
                // like <script src="/bundle.js"> resolve through our proxy
                // instead of FM's root (which would serve the FM SPA).
                html = html.replace(
                    /((?:src|href|action)\s*=\s*["'])\/(?!\/)/gi,
                    `$1${proxyBaseUrl}`
                );

                // Inject <base> tag for relative URLs.
                // Only inject JS overrides for pre-1.8.0 firmware (no shelly_addr).
                // FW 1.8.0+ uses native shelly_addr param for RPC routing.
                const baseTag = `<base href="${proxyBaseUrl}">`;
                const hasShellyAddr = req.query.shelly_addr != null;
                if (hasShellyAddr) {
                    html = injectIntoHtmlHead(html, baseTag);
                } else {
                    const injectedScript = buildPreFw18Script(
                        proxyRpcUrl,
                        shellyID,
                        deviceIp
                    );
                    html = injectIntoHtmlHead(html, baseTag + injectedScript);
                }

                logger.info(
                    'Device %s — serving HTML via Range chunking (%d bytes, rewritten)',
                    shellyID,
                    html.length
                );

                res.setHeader('Content-Type', contentType);
                res.setHeader('X-Frame-Options', 'SAMEORIGIN');
                res.setHeader(
                    'Content-Security-Policy',
                    "frame-ancestors 'self'"
                );
                res.send(html);
            } else {
                // Sub-resources (JS, CSS, favicon, etc.): use HTTP.GET — they
                // are small enough to fit in the firmware RPC response buffer.
                // Use loopback to avoid network stack overhead on the device.
                const targetUrl = `http://127.0.0.1/${subPath}`;
                logger.info(
                    'Fetching via RPC HTTP.GET: %s → %s',
                    shellyID,
                    targetUrl
                );

                const rpcResult = await device.sendRPC('HTTP.GET', {
                    url: targetUrl,
                    timeout: 25
                });

                if (!rpcResult || rpcResult.code == null) {
                    throw new Error('Invalid HTTP.GET response from device');
                }

                if (rpcResult.code !== 200) {
                    res.status(rpcResult.code).json({
                        error: `Device returned HTTP ${rpcResult.code}`,
                        message: rpcResult.message || ''
                    });
                    return;
                }

                // Determine content type from response headers or path
                const rpcHeaders = rpcResult.headers || {};
                let contentType =
                    rpcHeaders['Content-Type'] ||
                    rpcHeaders['content-type'] ||
                    guessContentType(subPath);

                const body: string = rpcResult.body || '';

                // For HTML content: rewrite absolute paths and inject proxy overrides
                if (
                    contentType.includes('text/html') ||
                    (!subPath && !contentType.includes('/'))
                ) {
                    contentType = 'text/html; charset=utf-8';
                    let html = body;

                    const proxyBaseUrl = `/api/device-proxy/${shellyID}/gui/`;
                    const proxyRpcUrl = `/api/device-proxy/${shellyID}/rpc`;

                    html = html.replace(
                        /((?:src|href|action)\s*=\s*["'])\/(?!\/)/gi,
                        `$1${proxyBaseUrl}`
                    );

                    const baseTag = `<base href="${proxyBaseUrl}">`;
                    const injectedScript = buildPreFw18Script(
                        proxyRpcUrl,
                        shellyID,
                        deviceIp
                    );
                    html = injectIntoHtmlHead(html, baseTag + injectedScript);

                    logger.info(
                        'Device %s — serving HTML via RPC (%d bytes, rewritten)',
                        shellyID,
                        html.length
                    );

                    res.setHeader('Content-Type', contentType);
                    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
                    res.setHeader(
                        'Content-Security-Policy',
                        "frame-ancestors 'self'"
                    );
                    res.send(html);
                } else {
                    // Non-HTML: return as-is (JS, CSS, images via base64, etc.)
                    logger.info(
                        'Device %s — serving %s via RPC (%d bytes)',
                        shellyID,
                        contentType,
                        body.length
                    );
                    res.setHeader('Content-Type', contentType);

                    // If the response has body_b64, it's binary content
                    if (rpcResult.body_b64) {
                        res.send(Buffer.from(rpcResult.body_b64, 'base64'));
                    } else {
                        res.send(body);
                    }
                }
            }
        } catch (error: any) {
            logger.error('GUI proxy error for %s: %s', shellyID, error.message);
            res.status(502).json({
                error: 'Failed to fetch from device',
                message: error.message
            });
        }
    }
);

/**
 * Guess content type from file path extension.
 */
function guessContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'html':
        case 'htm':
            return 'text/html; charset=utf-8';
        case 'js':
        case 'mjs':
            return 'application/javascript';
        case 'css':
            return 'text/css';
        case 'json':
            return 'application/json';
        case 'png':
            return 'image/png';
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'svg':
            return 'image/svg+xml';
        case 'woff':
            return 'font/woff';
        case 'woff2':
            return 'font/woff2';
        default:
            return 'application/octet-stream';
    }
}

// ============================================================================
// HTML INJECTION HELPER
// ============================================================================

/**
 * Inject content into the <head> of an HTML document.
 * Tries to inject after <head>, <html>, or <!DOCTYPE>, falling back to prepending.
 */
function injectIntoHtmlHead(html: string, content: string): string {
    const headMatch = html.match(/<head[^>]*>/i);
    const htmlMatch = html.match(/<html[^>]*>/i);
    const doctypeMatch = html.match(/<!DOCTYPE[^>]*>/i);

    if (headMatch) {
        const injectionPoint = headMatch.index! + headMatch[0].length;
        return (
            html.slice(0, injectionPoint) + content + html.slice(injectionPoint)
        );
    }
    if (htmlMatch) {
        const injectionPoint = htmlMatch.index! + htmlMatch[0].length;
        return `${html.slice(0, injectionPoint)}<head>${content}</head>${html.slice(injectionPoint)}`;
    }
    if (doctypeMatch) {
        const injectionPoint = doctypeMatch.index! + doctypeMatch[0].length;
        return `${html.slice(0, injectionPoint)}<head>${content}</head>${html.slice(injectionPoint)}`;
    }
    return `<!DOCTYPE html><head>${content}</head>${html}`;
}

// ============================================================================
// FIRMWARE VERSION DETECTION
// ============================================================================

/**
 * Check if firmware version is 1.8.0 or newer.
 * Firmware 1.8.0+ natively supports the shelly_addr URL parameter,
 * allowing the embedded web GUI to direct RPC calls to a proxy endpoint.
 */
function isFirmware180OrNewer(version: string): boolean {
    if (!version) return false;
    // Version format: "major.minor.patch" or "major.minor.patch-beta..."
    const parts = version.split('.');
    const major = Number.parseInt(parts[0], 10) || 0;
    const minor = Number.parseInt(parts[1], 10) || 0;
    return major > 1 || (major === 1 && minor >= 8);
}

// ============================================================================
// PRE-1.8.0 FIRMWARE JS INJECTION
// ============================================================================

/**
 * Build the injected JavaScript for pre-1.8.0 firmware devices.
 * Overrides fetch/XHR/WebSocket to redirect RPC calls through FM proxy.
 */
function buildPreFw18Script(
    proxyRpcUrl: string,
    shellyID: string,
    deviceIp?: string
): string {
    return `
<script>
// Fleet Manager Proxy - MUST RUN FIRST
console.log('[FM Proxy] ========== INITIALIZING ==========');
(function() {
    'use strict';

    var PROXY_RPC_URL = "${proxyRpcUrl}";
    var SHELLY_ID = "${shellyID}";
    var DEVICE_IP = "${deviceIp || ''}";

    var urlParams = new URLSearchParams(window.location.search);
    var FM_TOKEN = urlParams.get('token') || '';
    var SHELLY_ADDR = urlParams.get('shelly_addr') || '';

    console.log('[FM Proxy] Device:', SHELLY_ID);
    console.log('[FM Proxy] Device IP:', DEVICE_IP);
    console.log('[FM Proxy] Proxy RPC URL:', PROXY_RPC_URL);
    console.log('[FM Proxy] Token:', FM_TOKEN ? FM_TOKEN.substring(0, 20) + '...' : 'MISSING');

    window.__FM_PROXY__ = {
        rpcUrl: PROXY_RPC_URL,
        shellyId: SHELLY_ID,
        token: FM_TOKEN,
        shellyAddr: SHELLY_ADDR,
        deviceIp: DEVICE_IP
    };

    // Detect if a URL targets a private/local IP (10.x, 192.168.x, 172.16-31.x, or the known device IP)
    var PRIVATE_IP_RE = /^https?:\\/\\/(10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|127\\.|localhost)/i;
    function isDeviceUrl(urlStr) {
        if (DEVICE_IP && urlStr.indexOf(DEVICE_IP) !== -1) return true;
        return PRIVATE_IP_RE.test(urlStr);
    }

    function addTokenToUrl(urlStr) {
        if (!FM_TOKEN) return urlStr;
        var separator = urlStr.includes('?') ? '&' : '?';
        return urlStr + separator + 'token=' + encodeURIComponent(FM_TOKEN);
    }

    function rewriteRpcUrl(urlStr) {
        if (urlStr.includes('token=')) return null;
        if (urlStr.includes('/api/device-proxy/')) return addTokenToUrl(urlStr);
        // Catch any request to the device IP or a private IP with /rpc
        if (urlStr.match(/\\/rpc(\\/|\\?|$)/)) {
            var rpcMatch = urlStr.match(/\\/rpc\\/([^?]*)/);
            var method = rpcMatch ? rpcMatch[1] : '';
            var queryIndex = urlStr.indexOf('?');
            var existingQuery = queryIndex >= 0 ? urlStr.substring(queryIndex + 1) : '';
            var baseUrl = method ? PROXY_RPC_URL + '/' + method : PROXY_RPC_URL;
            var newQuery = 'token=' + encodeURIComponent(FM_TOKEN);
            if (existingQuery) newQuery += '&' + existingQuery;
            console.log('[FM Proxy] Rewriting RPC:', urlStr, '→', baseUrl + '?' + newQuery);
            return baseUrl + '?' + newQuery;
        }
        // Catch ANY request to device IP / private IP (non-RPC assets)
        if (isDeviceUrl(urlStr)) {
            try {
                var parsed = new URL(urlStr);
                var proxyPath = '/api/device-proxy/' + encodeURIComponent(SHELLY_ID) + '/gui' + parsed.pathname;
                var newUrl = proxyPath + (parsed.search || '');
                newUrl = addTokenToUrl(newUrl);
                console.log('[FM Proxy] Rewriting device URL:', urlStr, '→', newUrl);
                return newUrl;
            } catch(e) {}
        }
        return null;
    }

    // Override fetch
    var originalFetch = window.fetch;
    window.fetch = function(input, init) {
        var urlStr = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url ? input.url : String(input)));
        var newUrl = rewriteRpcUrl(urlStr);
        if (newUrl) return originalFetch.call(window, newUrl, init);
        return originalFetch.apply(window, arguments);
    };

    // Override XMLHttpRequest
    var originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
        var urlStr = typeof url === 'string' ? url : (url ? url.toString() : '');
        var newUrl = rewriteRpcUrl(urlStr);
        if (newUrl) return originalXHROpen.call(this, method, newUrl, async !== false, user, password);
        return originalXHROpen.apply(this, arguments);
    };

    // Override WebSocket with HTTP bridge for RPC
    var OriginalWebSocket = window.WebSocket;
    function FakeRpcWebSocket(url) {
        var self = this;
        this.url = url;
        this.readyState = OriginalWebSocket.CONNECTING;
        this.onopen = null;
        this.onclose = null;
        this.onmessage = null;
        this.onerror = null;
        this._pollInterval = null;
        this._lastStatus = null;
        this._clientSrc = null;

        var rpcHttpUrl = PROXY_RPC_URL + '?token=' + encodeURIComponent(FM_TOKEN);

        function sendToGui(data) {
            var dataStr = typeof data === 'string' ? data : JSON.stringify(data);
            if (self.onmessage) self.onmessage({ type: 'message', data: dataStr, target: self });
            self.dispatchEvent(new MessageEvent('message', { data: dataStr }));
        }

        function pollStatus() {
            if (self.readyState !== OriginalWebSocket.OPEN) return;
            originalFetch(rpcHttpUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: 0, method: 'Shelly.GetStatus' })
            })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(result) {
                if (result && result.result) {
                    var s = JSON.stringify(result.result);
                    if (s !== self._lastStatus) {
                        self._lastStatus = s;
                        sendToGui({
                            src: SHELLY_ID,
                            dst: self._clientSrc || 'user',
                            method: 'NotifyStatus',
                            params: Object.assign({ ts: Date.now() / 1000 }, result.result)
                        });
                    }
                }
            })
            .catch(function() {});
        }

        setTimeout(function() {
            self.readyState = OriginalWebSocket.OPEN;
            if (self.onopen) self.onopen({ type: 'open', target: self });
            self.dispatchEvent(new Event('open'));
            self._pollInterval = setInterval(pollStatus, 1000);
        }, 10);

        this.send = function(data) {
            if (self.readyState !== OriginalWebSocket.OPEN) return;
            var msg;
            try { msg = JSON.parse(data); } catch (e) { return; }
            if (msg.src) self._clientSrc = msg.src;
            originalFetch(rpcHttpUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: data
            })
            .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
            .then(function(result) { sendToGui(result); })
            .catch(function(error) {
                sendToGui({ id: msg.id, src: msg.dst || SHELLY_ID, dst: msg.src, error: { code: -1, message: error.message } });
            });
        };

        this.close = function(code, reason) {
            if (self._pollInterval) clearInterval(self._pollInterval);
            self.readyState = OriginalWebSocket.CLOSED;
            if (self.onclose) self.onclose({ type: 'close', code: code || 1000, reason: reason || '', target: self });
            self.dispatchEvent(new CloseEvent('close', { code: code || 1000, reason: reason || '' }));
        };

        this._listeners = {};
        this.addEventListener = function(type, listener) {
            if (!self._listeners[type]) self._listeners[type] = [];
            self._listeners[type].push(listener);
        };
        this.removeEventListener = function(type, listener) {
            if (!self._listeners[type]) return;
            var idx = self._listeners[type].indexOf(listener);
            if (idx >= 0) self._listeners[type].splice(idx, 1);
        };
        this.dispatchEvent = function(event) {
            (self._listeners[event.type] || []).forEach(function(l) { try { l.call(self, event); } catch(e) {} });
            return true;
        };
    }
    FakeRpcWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    FakeRpcWebSocket.OPEN = OriginalWebSocket.OPEN;
    FakeRpcWebSocket.CLOSING = OriginalWebSocket.CLOSING;
    FakeRpcWebSocket.CLOSED = OriginalWebSocket.CLOSED;

    window.WebSocket = function(url, protocols) {
        var urlStr = typeof url === 'string' ? url : (url ? url.toString() : '');
        if (urlStr.includes('/rpc') || urlStr.match(/ws:\\/\\/[^/]+\\/?$/) || isDeviceUrl(urlStr.replace(/^ws/, 'http'))) {
            console.log('[FM Proxy] Intercepting WebSocket to device:', urlStr);
            return new FakeRpcWebSocket(urlStr);
        }
        return new OriginalWebSocket(url, protocols);
    };
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    window.WebSocket.OPEN = OriginalWebSocket.OPEN;
    window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
    window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

    console.log('[FM Proxy] ========== INITIALIZATION COMPLETE ==========');
})();
</script>
`;
}

// ============================================================================
// WEBSOCKET RPC PROXY
// ============================================================================

/**
 * WebSocket server for device RPC proxy (noServer mode).
 * Bridges browser WebSocket connections with device outbound WebSocket transport.
 *
 * This enables the Shelly embedded web GUI (firmware 1.8.0+) to communicate
 * with the device via Fleet Manager even when not on the same network.
 *
 * Flow:
 *   Browser (iframe with Shelly GUI)
 *     ↕ WebSocket (shelly_addr points here)
 *   Fleet Manager (this proxy)
 *     ↕ device.sendRPC() via outbound WebSocket
 *   Shelly Device
 */
const wsProxy = new WebSocket.Server({noServer: true});

/**
 * Handle WebSocket upgrade for device RPC proxy.
 * Called from WebsocketController when the path matches /api/device-proxy/:shellyID/rpc
 */
export function handleDeviceProxyWsUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
) {
    wsProxy.handleUpgrade(request, socket, head, (ws) => {
        wsProxy.emit('connection', ws, request);
    });
}

wsProxy.on('connection', async (ws: WebSocket, request: IncomingMessage) => {
    // Parse URL to extract shellyID and token
    let shellyID: string;
    let token: string | undefined;

    try {
        const url = new URL(request.url || '', 'http://localhost');
        const pathMatch = url.pathname.match(
            /\/api\/device-proxy\/([^/]+)\/rpc/
        );
        if (!pathMatch) {
            ws.close(4000, 'Invalid path');
            return;
        }
        shellyID = decodeURIComponent(pathMatch[1]);
        token = url.searchParams.get('token') || undefined;
    } catch {
        ws.close(4000, 'Invalid URL');
        return;
    }

    // Authenticate - try token first, fall back to active GUI session
    if (!token) {
        const hasSession =
            guiSessions.has(shellyID) && guiSessions.get(shellyID)!.size > 0;
        if (!hasSession) {
            logger.warn(
                'WS proxy: no token and no active GUI session for %s',
                shellyID
            );
            ws.close(4001, 'Authentication required');
            return;
        }
        logger.info('WS proxy: using active GUI session for %s', shellyID);
    }

    let user: user_t | undefined;
    if (token) {
        try {
            user = await getUserFromToken(token);
        } catch {
            // Token validation failed
        }
        if (!user) {
            logger.warn('WS proxy: authentication failed for %s', shellyID);
            ws.close(4001, 'Authentication failed');
            return;
        }
        if (!canExecuteOnDevice(user, shellyID)) {
            logger.warn(
                'WS proxy: access denied for user %s to device %s',
                user.username,
                shellyID
            );
            ws.close(4003, 'Access denied');
            return;
        }
    }

    // Get device
    const device = DeviceCollector.getDevice(shellyID);
    if (!device) {
        logger.warn('WS proxy: device not found: %s', shellyID);
        ws.close(4004, 'Device not found');
        return;
    }

    if (!device.online || !device.transport) {
        logger.warn('WS proxy: device offline: %s', shellyID);
        ws.close(4005, 'Device offline');
        return;
    }

    logger.info(
        'WS proxy: connected for device %s (user: %s)',
        shellyID,
        user?.username || 'gui-session'
    );

    // Listen for device notifications and forward to browser.
    // Notifications are messages with a 'method' field (NotifyStatus, NotifyEvent, etc.)
    // that are not responses to our RPC calls.
    // Since we use device.sendRPC() with default silent=false, RPC responses
    // are NOT emitted as 'message' events — only unsolicited notifications are.
    const transportListener = (msg: any) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        // Forward notifications (messages with 'method' field)
        if (msg.method) {
            try {
                ws.send(JSON.stringify(msg));
            } catch (e) {
                logger.error(
                    'WS proxy: error forwarding notification to browser: %s',
                    e
                );
            }
        }
    };
    device.transport.eventemitter.on('message', transportListener);

    // Handle device transport closing (device goes offline)
    const transportCloseListener = () => {
        if (ws.readyState === WebSocket.OPEN) {
            logger.info(
                'WS proxy: device %s disconnected, closing browser WS',
                shellyID
            );
            ws.close(4005, 'Device disconnected');
        }
    };
    device.transport.eventemitter.on('close', transportCloseListener);

    // Handle messages from browser (RPC requests)
    ws.on('message', async (rawData: WebSocket.RawData) => {
        let msg: any;
        try {
            msg = JSON.parse(rawData.toString());
        } catch {
            logger.error(
                'WS proxy: failed to parse browser message for %s',
                shellyID
            );
            return;
        }

        if (!msg.method) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                    JSON.stringify({
                        id: msg.id,
                        error: {
                            code: -32600,
                            message: 'Invalid request: method required'
                        }
                    })
                );
            }
            return;
        }

        const browserMsgId = msg.id;
        const browserSrc = msg.src;

        logger.debug(
            'WS proxy: forwarding RPC %s (id=%s) to device %s',
            msg.method,
            browserMsgId,
            shellyID
        );

        // Check device is still available
        if (!device.online || !device.transport) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                    JSON.stringify({
                        id: browserMsgId,
                        src: shellyID,
                        dst: browserSrc,
                        error: {
                            code: -32603,
                            message: 'Device offline'
                        }
                    })
                );
            }
            return;
        }

        try {
            const result = await device.sendRPC(msg.method, msg.params);

            if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                    JSON.stringify({
                        id: browserMsgId,
                        src: shellyID,
                        dst: browserSrc,
                        result
                    })
                );
            }
        } catch (error: any) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                    JSON.stringify({
                        id: browserMsgId,
                        src: shellyID,
                        dst: browserSrc,
                        error: {
                            code: error.code || -32603,
                            message: error.message || 'Internal error'
                        }
                    })
                );
            }
        }
    });

    // Clean up on browser disconnect
    ws.on('close', () => {
        logger.info('WS proxy: browser disconnected for device %s', shellyID);
        device.transport?.eventemitter.off('message', transportListener);
        device.transport?.eventemitter.off('close', transportCloseListener);
    });

    ws.on('error', (error) => {
        logger.error(
            'WS proxy: browser WebSocket error for %s: %s',
            shellyID,
            error.message
        );
    });
});

export default router;
