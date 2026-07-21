/**
 * Device Proxy Routes
 *
 * Provides device info, diagnostics, and isolated GUI sessions.
 *
 * Security:
 * - All endpoints require authentication (Bearer token)
 * - User must have execute permission on the specific device
 * - X-Frame-Options set to SAMEORIGIN
 */

import * as http from 'node:http';
import express from 'express';
import log4js from 'log4js';
import {tuning} from '../../../config';
import {deviceGuiConfig} from '../../../config/deviceGui';
import * as DeviceCollector from '../../DeviceCollector';
import {deviceGuiSessions} from '../../redis/services';
import {UNAUTHORIZED_USER} from '../../user';
import {
    type DeviceGuiOutcome,
    recordDeviceGuiEvent
} from '../deviceGuiDiagnostics';
import {closeDeviceGuiSessionConnections} from '../deviceGuiOrigin';
import {
    createDeviceGuiLaunch,
    createDeviceGuiSessionId,
    DEVICE_GUI_COOKIE,
    DeviceGuiLaunchError,
    deviceGuiCookieOptions,
    deviceGuiCookieValue,
    getDeviceGuiDirectInfo
} from '../deviceGuiSession';
import {httpRouteLimit} from '../rateLimit';
import {isLoggedIn} from '../utils/authMiddleware';
import {deviceErrorToWireString} from '../utils/classifyDeviceError';
import {canExecuteOnDevice} from '../utils/devicePermissions';
import {isPrivateDeviceIp} from '../utils/ipValidation';
import {paramStr} from '../utils/params';
import {isSecureRequest} from '../utils/secureCookie';

const logger = log4js.getLogger('device-proxy');
const router = express.Router();

function deviceIdParam(req: express.Request): number | null {
    const deviceId = Number(paramStr(req.params.deviceId));
    return Number.isSafeInteger(deviceId) && deviceId > 0 ? deviceId : null;
}

function launchErrorOutcome(error: DeviceGuiLaunchError): DeviceGuiOutcome {
    if (error.code === 'not_configured') return 'disabled';
    if (error.code === 'not_found') return 'device_not_found';
    if (error.code === 'access_denied') return 'access_denied';
    if (error.code === 'no_private_ip') return 'no_private_ip';
    return error.outcome ?? 'identity_mismatch';
}

function sendDeviceGuiLaunchError(
    res: express.Response,
    error: unknown,
    context?: {deviceId?: number; startedAt?: number; sessionId?: string}
): void {
    if (!(error instanceof DeviceGuiLaunchError)) {
        recordDeviceGuiEvent({
            stage: 'launch',
            outcome: 'internal_error',
            level: 'error',
            sessionId: context?.sessionId,
            deviceId: context?.deviceId,
            durationMs:
                context?.startedAt === undefined
                    ? undefined
                    : performance.now() - context.startedAt,
            error
        });
        res.status(500).json({error: 'Device GUI request failed'});
        return;
    }
    recordDeviceGuiEvent({
        stage: 'launch',
        outcome: launchErrorOutcome(error),
        level: 'warn',
        sessionId: context?.sessionId,
        deviceId: context?.deviceId,
        durationMs:
            context?.startedAt === undefined
                ? undefined
                : performance.now() - context.startedAt,
        error
    });
    if (error.code === 'access_denied') {
        res.status(403).json({error: 'Access denied to this device'});
    } else if (error.code === 'not_found') {
        res.status(404).json({error: error.message});
    } else if (error.code === 'not_configured') {
        res.status(409).json({error: error.message});
    } else {
        res.status(502).json({error: error.message});
    }
}

router.get(
    '/devices/:deviceId/info',
    httpRouteLimit({
        name: 'device-gui-info',
        capacityPerMin: tuning.http.rateLimitDeviceProxyPerMin
    }),
    isLoggedIn,
    async (req, res) => {
        const deviceId = deviceIdParam(req);
        if (!deviceId) {
            res.status(400).json({error: 'Invalid device id'});
            return;
        }
        try {
            res.json(await getDeviceGuiDirectInfo({deviceId, user: req.user!}));
        } catch (error) {
            sendDeviceGuiLaunchError(res, error);
        }
    }
);

router.post(
    '/devices/:deviceId/gui-session',
    httpRouteLimit({
        name: 'device-gui-session',
        capacityPerMin: tuning.http.rateLimitDeviceProxyPerMin
    }),
    isLoggedIn,
    async (req, res) => {
        const startedAt = performance.now();
        if (!req.token || !req.user || req.user === UNAUTHORIZED_USER) {
            recordDeviceGuiEvent({
                stage: 'launch',
                outcome: 'auth_required',
                level: 'warn',
                durationMs: performance.now() - startedAt
            });
            res.status(401).json({error: 'Authentication required'});
            return;
        }
        if (!deviceGuiConfig.enabled) {
            recordDeviceGuiEvent({
                stage: 'launch',
                outcome: 'disabled',
                level: 'warn',
                durationMs: performance.now() - startedAt
            });
            res.status(409).json({error: 'Device GUI proxy is not configured'});
            return;
        }
        if (!isSecureRequest(req)) {
            recordDeviceGuiEvent({
                stage: 'launch',
                outcome: 'https_required',
                level: 'warn',
                durationMs: performance.now() - startedAt
            });
            res.status(409).json({error: 'Device GUI proxy requires HTTPS'});
            return;
        }
        const deviceId = deviceIdParam(req);
        if (!deviceId) {
            recordDeviceGuiEvent({
                stage: 'launch',
                outcome: 'invalid_device_id',
                level: 'warn',
                durationMs: performance.now() - startedAt
            });
            res.status(400).json({error: 'Invalid device id'});
            return;
        }
        const sessionId = createDeviceGuiSessionId();
        recordDeviceGuiEvent({
            stage: 'launch',
            outcome: 'requested',
            level: 'debug',
            sessionId,
            deviceId
        });
        try {
            const launch = await createDeviceGuiLaunch({
                deviceId,
                user: req.user,
                token: req.token,
                currentCookie: deviceGuiCookieValue(req.headers.cookie),
                sessionId
            });
            if (launch.replacedSessionId) {
                closeDeviceGuiSessionConnections(launch.replacedSessionId);
                await deviceGuiSessions.publishRevoked(
                    launch.replacedSessionId
                );
                recordDeviceGuiEvent({
                    stage: 'session',
                    outcome: 'replaced',
                    level: 'info',
                    sessionId: launch.replacedSessionId,
                    deviceId
                });
            }
            res.cookie(
                DEVICE_GUI_COOKIE,
                launch.cookie,
                deviceGuiCookieOptions()
            );
            res.setHeader('Cache-Control', 'no-store');
            recordDeviceGuiEvent({
                stage: 'launch',
                outcome: 'success',
                level: 'info',
                sessionId,
                deviceId,
                durationMs: performance.now() - startedAt
            });
            const {
                cookie: _cookie,
                replacedSessionId: _replaced,
                ...response
            } = launch;
            res.json(response);
        } catch (error) {
            sendDeviceGuiLaunchError(res, error, {
                deviceId,
                startedAt,
                sessionId
            });
        }
    }
);

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

/**
 * Middleware to validate authentication and device permissions.
 * Sets (req as any).device if the device exists in DeviceCollector.
 * When requireDevice is true (default), returns 404 if device not found.
 * When false, allows the request through with device = null.
 */
function validateDeviceAccess(options?: {requireDevice?: boolean}) {
    const requireDevice = options?.requireDevice ?? true;

    return async (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        const shellyID = paramStr(req.params.shellyID);

        // Check authentication
        if (!req.token || !req.user || req.user === UNAUTHORIZED_USER) {
            logger.warn(
                'Unauthorized access attempt to device proxy for %s',
                shellyID
            );
            res.status(401).json({error: 'Authentication required'});
            return;
        }

        // Check if user has permission to execute on this device
        if (!(await canExecuteOnDevice(req.user, shellyID))) {
            logger.warn(
                'User %s denied access to device %s',
                req.user.username,
                shellyID
            );
            res.status(403).json({error: 'Access denied to this device'});
            return;
        }

        // Check if device exists
        const device = DeviceCollector.getDevice(shellyID);
        if (!device && requireDevice) {
            logger.warn('Device not found: %s', shellyID);
            res.status(404).json({error: 'Device not found'});
            return;
        }

        // Store device in request for downstream handlers (may be null)
        (req as any).device = device || null;

        // Set security headers to prevent framing on other origins
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");

        next();
    };
}

/**
 * GET /api/device-proxy/:shellyID/info
 *
 * Returns device information for the web GUI modal.
 * The browser opens the device GUI directly via LAN (http://<deviceIp>/).
 */
router.get(
    '/:shellyID/info',
    httpRouteLimit({
        name: 'device-proxy-info',
        capacityPerMin: tuning.http.rateLimitDeviceProxyPerMin
    }),
    validateDeviceAccess(),
    async (req, res) => {
        const shellyID = paramStr(req.params.shellyID);
        const device = (req as any).device;

        // Get device IP from status
        const status = device.status;
        const deviceIp = status?.wifi?.sta_ip || status?.eth?.ip;
        const fwVersion = device.info?.ver || '';

        logger.info(
            'Device proxy info: %s, ip=%s, online=%s, fw=%s',
            shellyID,
            deviceIp,
            device.online,
            fwVersion
        );

        // Direct LAN access only — no RPC bridge proxy started.
        // The browser connects to the device IP directly, avoiding
        // RPC queue saturation that caused device disconnects.
        res.json({
            shellyID,
            deviceIp: deviceIp || null,
            online: device.online,
            guiUrl: deviceIp ? `http://${deviceIp}/` : null,
            fwVersion
        });
    }
);

/**
 * Proxy a live JPEG snapshot from the device's `GET /camera/<id>/snapshot`.
 * FM reaches the device over HTTP only when they share a network and the
 * device's HTTP auth is off — FM holds no device HTTP credentials. Callers
 * must SSRF-guard the IP before calling.
 */
function streamDeviceSnapshot(
    deviceIp: string,
    componentId: string,
    res: express.Response
): Promise<void> {
    const timeoutMs = tuning.device.cameraSnapshotTimeoutMs;
    return new Promise((resolve) => {
        const upstream = http.request(
            {
                hostname: deviceIp,
                port: 80,
                path: `/camera/${componentId}/snapshot`,
                method: 'GET',
                timeout: timeoutMs
            },
            (dev) => {
                if (dev.statusCode === 401) {
                    dev.resume();
                    res.status(502).json({
                        error: 'Camera requires HTTP auth; snapshot proxy unavailable'
                    });
                    resolve();
                    return;
                }
                if (dev.statusCode !== 200) {
                    dev.resume();
                    res.status(502).json({
                        error: `Camera snapshot unavailable (device HTTP ${dev.statusCode})`
                    });
                    resolve();
                    return;
                }
                res.setHeader(
                    'Content-Type',
                    dev.headers['content-type'] || 'image/jpeg'
                );
                res.setHeader('Cache-Control', 'no-store');
                dev.pipe(res);
                dev.on('end', () => resolve());
            }
        );
        upstream.on('timeout', () => {
            upstream.destroy();
            if (!res.headersSent) {
                res.status(504).json({error: 'Camera snapshot timed out'});
            }
            resolve();
        });
        upstream.on('error', (err) => {
            upstream.destroy();
            if (!res.headersSent) {
                res.status(502).json({
                    error: `Camera snapshot failed: ${deviceErrorToWireString(err)}`
                });
            }
            resolve();
        });
        upstream.end();
    });
}

/**
 * GET /api/device-proxy/:shellyID/camera/:componentId/snapshot
 *
 * Live JPEG snapshot, proxied from the device's own snapshot endpoint. This is
 * the correct source for a still — `Camera.CaptureImage` returns a cloud/SD
 * media_id, not displayable bytes. Works when FM can reach the device on the
 * LAN; NAT'd/cloud deployments fall back to the cloud media path (Phase 2).
 */
router.get(
    '/:shellyID/camera/:componentId/snapshot',
    httpRouteLimit({
        name: 'device-proxy-camera-snapshot',
        capacityPerMin: tuning.http.rateLimitDeviceProxyPerMin
    }),
    validateDeviceAccess(),
    async (req, res) => {
        const componentId = paramStr(req.params.componentId);
        if (!/^\d+$/.test(componentId)) {
            res.status(400).json({error: 'Invalid camera component id'});
            return;
        }
        const device = (req as any).device;
        const deviceIp = device.status?.wifi?.sta_ip || device.status?.eth?.ip;
        if (!deviceIp || !isPrivateDeviceIp(deviceIp)) {
            // Only proxy to LAN-reachable devices — a device-reported public IP
            // would let a compromised device aim FM's requests anywhere (SSRF).
            res.status(502).json({
                error: 'Camera snapshot requires a LAN-reachable device'
            });
            return;
        }
        await streamDeviceSnapshot(deviceIp, componentId, res);
    }
);

/**
 * POST /api/device-proxy/:shellyID/camera/streamer/stop
 *
 * Relays Streamer.StopStream to free a camera stream slot on page unload, when
 * an in-page WS RPC cannot be sent. Body: { session_id }.
 */
router.post(
    '/:shellyID/camera/streamer/stop',
    express.json(),
    httpRouteLimit({
        name: 'device-proxy-camera-streamer-stop',
        capacityPerMin: tuning.http.rateLimitDeviceProxyPerMin
    }),
    validateDeviceAccess(),
    async (req, res) => {
        const sessionId =
            typeof req.body?.session_id === 'string' ? req.body.session_id : '';
        if (!/^[\w-]{1,64}$/.test(sessionId)) {
            res.status(400).json({error: 'Missing or invalid session_id'});
            return;
        }
        const device = getFreshDevice(paramStr(req.params.shellyID));
        if (!device) {
            res.status(404).json({error: 'Device not found'});
            return;
        }
        try {
            await device.sendRPC('Streamer.StopStream', {
                session_id: sessionId
            });
            res.status(204).end();
        } catch (err) {
            res.status(502).json({
                error: `StopStream failed: ${deviceErrorToWireString(err)}`
            });
        }
    }
);

/**
 * Probe device HTTP reachability from FM backend.
 * Returns elapsed ms on success, or a classified enum error on failure
 * (wire format: "<code>" or "<code> — <safe-detail>").
 */
function probeDeviceHttp(
    deviceIp: string
): Promise<{reachable: boolean; elapsed: number; error?: string}> {
    const start = Date.now();
    const timeoutMs = tuning.device.probeTimeoutMs;
    return new Promise((resolve) => {
        const req = http.request(
            {
                hostname: deviceIp,
                port: 80,
                path: '/',
                method: 'HEAD',
                timeout: timeoutMs
            },
            (res) => {
                // Consume response to free socket
                res.resume();
                resolve({reachable: true, elapsed: Date.now() - start});
            }
        );
        req.on('timeout', () => {
            req.destroy();
            resolve({
                reachable: false,
                elapsed: Date.now() - start,
                error: `timeout — ${Math.round(timeoutMs / 1000)}s`
            });
        });
        req.on('error', (err) => {
            req.destroy();
            resolve({
                reachable: false,
                elapsed: Date.now() - start,
                error: deviceErrorToWireString(err)
            });
        });
        req.end();
    });
}

/**
 * Collect temperature readings from device status components.
 * Returns an array of {id, tC} for each temperature sensor.
 */
function collectTemperatures(
    status: Record<string, any> | undefined
): Array<{id: string; tC: number}> {
    if (!status) return [];
    const temps: Array<{id: string; tC: number}> = [];
    for (const key of Object.keys(status)) {
        if (key.startsWith('temperature:') && status[key]?.tC != null) {
            temps.push({id: key, tC: status[key].tC});
        }
    }
    return temps;
}

function buildDeviceHealth(device: any) {
    return {
        model: device.info?.model || null,
        app: device.info?.app || null,
        gen: device.info?.gen || null,
        fw: device.info?.ver || null,
        mac: device.info?.mac || null,
        uptime: device.status?.sys?.uptime ?? null,
        ramFree: device.status?.sys?.ram_free ?? null,
        ramSize: device.status?.sys?.ram_size ?? null,
        fsFree: device.status?.sys?.fs_free ?? null,
        fsSize: device.status?.sys?.fs_size ?? null,
        temperatures: collectTemperatures(device.status)
    };
}

function buildTransportHealth(device: any, lastReportTs: number | null) {
    return {
        online: device.online,
        presence: device.presence || null,
        transport: device.transport?.name || null,
        pendingRpcs: device.transport?.pendingRpcCount ?? 0,
        lastReportTs,
        lastReportAge: lastReportTs
            ? Math.round((Date.now() - lastReportTs) / 1000)
            : null,
        rpcCheck: null as Record<string, any> | null
    };
}

function buildNetworkQuality(device: any) {
    return {
        wifi: device.status?.wifi
            ? {
                  connected: device.status.wifi.status === 'got ip',
                  ssid: device.status.wifi.ssid || null,
                  rssi: device.status.wifi.rssi ?? null,
                  ip: device.status.wifi.sta_ip || null
              }
            : null,
        eth: device.status?.eth ? {ip: device.status.eth.ip || null} : null,
        cloud: device.status?.cloud?.connected ?? null
    };
}

function buildGuiContext(req: express.Request) {
    return {
        fmProtocol: req.protocol,
        fmHost: req.headers.host || null
    };
}

async function buildFmReachability(
    deviceIp: string
): Promise<Record<string, any>> {
    if (!isPrivateDeviceIp(deviceIp)) {
        // The IP is device-reported. Probing anything outside the LAN
        // would let a compromised device aim FM's requests at arbitrary
        // hosts (SSRF).
        return {
            reachable: false,
            skipped: true,
            reason: `Device IP ${deviceIp} is not a probeable LAN address`
        };
    }
    return probeDeviceHttp(deviceIp);
}

async function probeRpcSanity(device: any): Promise<Record<string, any>> {
    const rpcStart = Date.now();
    try {
        const info = await device.sendRPC('Shelly.GetDeviceInfo', {});
        return {ok: true, elapsed: Date.now() - rpcStart, id: info?.id};
    } catch (e: any) {
        return {
            ok: false,
            elapsed: Date.now() - rpcStart,
            error: deviceErrorToWireString(e)
        };
    }
}

async function probeAdvanced(device: any): Promise<Record<string, any>> {
    const advStart = Date.now();
    try {
        const methods = await device.sendRPC('Shelly.ListMethods', {});
        return {
            listMethods: {
                ok: true,
                elapsed: Date.now() - advStart,
                count: methods?.methods?.length || 0,
                methods: methods?.methods || []
            }
        };
    } catch (e: any) {
        return {
            listMethods: {
                ok: false,
                elapsed: Date.now() - advStart,
                error: deviceErrorToWireString(e)
            }
        };
    }
}

function buildDeviceNotFoundReport(
    shellyID: string,
    req: express.Request
): Record<string, any> {
    return {
        shellyID,
        deviceIp: null,
        timestamp: new Date().toISOString(),
        deviceNotFound: true,
        fmReachability: null,
        deviceHealth: null,
        transportHealth: {
            online: false,
            presence: null,
            transport: null,
            pendingRpcs: 0,
            lastReportTs: null,
            lastReportAge: null,
            rpcCheck: null
        },
        networkQuality: null,
        guiContext: {
            fmProtocol: req.protocol,
            fmHost: req.headers.host || null
        },
        advanced: null
    };
}

/**
 * GET /api/device-proxy/:shellyID/gui-debug
 *
 * Diagnostics endpoint — 5 sections:
 * 1. fmReachability  — FM host → device HTTP probe
 * 2. deviceHealth    — model, fw, uptime, memory, temperature
 * 3. transportHealth — WS status, pending RPCs, last report age, RPC check
 * 4. networkQuality  — WiFi RSSI/SSID/IP, Ethernet, Cloud
 * 5. advanced        — ListMethods (opt-in via ?advanced=true)
 *
 * Browser → device reachability is only relevant to the direct fallback.
 */
router.get(
    '/:shellyID/gui-debug',
    httpRouteLimit({
        name: 'device-proxy-gui-debug',
        capacityPerMin: tuning.http.rateLimitDeviceProxyPerMin
    }),
    validateDeviceAccess({requireDevice: false}),
    async (req, res) => {
        const shellyID = paramStr(req.params.shellyID);
        const device = getFreshDevice(shellyID) || (req as any).device || null;

        if (!device) {
            logger.info(
                'Diagnostics for %s: device not in collector',
                shellyID
            );
            res.json(buildDeviceNotFoundReport(shellyID, req));
            return;
        }

        const deviceIp = device.status?.wifi?.sta_ip || device.status?.eth?.ip;
        const lastReportTs: number | null =
            device.toJSON().meta?.lastReportTs || null;

        const report: Record<string, any> = {
            shellyID,
            deviceIp: deviceIp || null,
            timestamp: new Date().toISOString(),
            fmReachability: null as Record<string, any> | null,
            deviceHealth: buildDeviceHealth(device),
            transportHealth: buildTransportHealth(device, lastReportTs),
            networkQuality: buildNetworkQuality(device),
            guiContext: buildGuiContext(req),
            advanced: null as Record<string, any> | null
        };

        if (deviceIp) {
            report.fmReachability = await buildFmReachability(deviceIp);
        }

        if (device.online && device.transport) {
            report.transportHealth.rpcCheck = await probeRpcSanity(device);
        }

        if (
            req.query.advanced === 'true' &&
            device.online &&
            device.transport
        ) {
            report.advanced = await probeAdvanced(device);
        }

        logger.info(
            'Diagnostics for %s: online=%s, ip=%s',
            shellyID,
            device.online,
            deviceIp
        );
        res.json(report);
    }
);

export default router;
