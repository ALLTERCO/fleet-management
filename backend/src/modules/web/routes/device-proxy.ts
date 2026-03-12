/**
 * Device Proxy Routes
 *
 * Provides device info and diagnostics endpoints for the web GUI.
 * The device GUI itself is accessed directly via LAN (browser → device IP).
 *
 * Security:
 * - All endpoints require authentication (Bearer token)
 * - User must have execute permission on the specific device
 * - X-Frame-Options set to SAMEORIGIN
 */

import * as http from 'node:http';
import express from 'express';
import log4js from 'log4js';
import * as DeviceCollector from '../../DeviceCollector';
import {UNAUTHORIZED_USER} from '../../user';
import {canExecuteOnDevice} from '../utils/devicePermissions';

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
router.get('/:shellyID/info', validateDeviceAccess(), async (req, res) => {
    const {shellyID} = req.params;
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
});

/**
 * Probe device HTTP reachability from FM backend.
 * Returns elapsed ms on success, or an error string on failure.
 */
function probeDeviceHttp(
    deviceIp: string
): Promise<{reachable: boolean; elapsed: number; error?: string}> {
    const start = Date.now();
    return new Promise((resolve) => {
        const req = http.request(
            {
                hostname: deviceIp,
                port: 80,
                path: '/',
                method: 'HEAD',
                timeout: 5000
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
                error: 'timeout (5s)'
            });
        });
        req.on('error', (err) => {
            resolve({
                reachable: false,
                elapsed: Date.now() - start,
                error: err.message
            });
        });
        req.end();
    });
}

/**
 * Check if an IP address is in a private/local range.
 */
function isPrivateIp(ip: string): boolean {
    return (
        ip.startsWith('10.') ||
        ip.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === 'localhost'
    );
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
 * Browser → device reachability is done client-side (frontend fetch probe).
 */
router.get(
    '/:shellyID/gui-debug',
    validateDeviceAccess({requireDevice: false}),
    async (req, res) => {
        const {shellyID} = req.params;
        const device = getFreshDevice(shellyID) || (req as any).device || null;

        // Device not in DeviceCollector — return a degraded diagnostics response
        if (!device) {
            logger.info(
                'Diagnostics for %s: device not in collector',
                shellyID
            );
            res.json({
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
                    fmHost: req.headers.host || null,
                    httpsWarning: null
                },
                advanced: null
            });
            return;
        }

        const deviceIp = device.status?.wifi?.sta_ip || device.status?.eth?.ip;
        const deviceJson = device.toJSON();
        const lastReportTs: number | null =
            deviceJson.meta?.lastReportTs || null;

        const report: Record<string, any> = {
            shellyID,
            deviceIp: deviceIp || null,
            timestamp: new Date().toISOString(),

            // ── 1. FM Host → Device Reachability ──
            fmReachability: null as Record<string, any> | null,

            // ── 2. Device Health (cached status, no extra RPCs) ──
            deviceHealth: {
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
            },

            // ── 3. Transport Health ──
            transportHealth: {
                online: device.online,
                presence: device.presence || null,
                transport: device.transport?.name || null,
                pendingRpcs: device.transport?.pendingRpcCount ?? 0,
                lastReportTs,
                lastReportAge: lastReportTs
                    ? Math.round((Date.now() - lastReportTs) / 1000)
                    : null,
                rpcCheck: null as Record<string, any> | null
            },

            // ── 4. Network Quality ──
            networkQuality: {
                wifi: device.status?.wifi
                    ? {
                          connected: device.status.wifi.status === 'got ip',
                          ssid: device.status.wifi.ssid || null,
                          rssi: device.status.wifi.rssi ?? null,
                          ip: device.status.wifi.sta_ip || null
                      }
                    : null,
                eth: device.status?.eth
                    ? {
                          ip: device.status.eth.ip || null
                      }
                    : null,
                cloud: device.status?.cloud?.connected ?? null
            },

            // ── GUI context (for frontend warnings) ──
            guiContext: {
                fmProtocol: req.protocol,
                fmHost: req.headers.host || null,
                httpsWarning:
                    req.protocol === 'https' ||
                    req.headers['x-forwarded-proto'] === 'https'
                        ? 'FM is served over HTTPS — browsers may block the iframe loading http://<device-ip>/ due to mixed content'
                        : null
            },

            // ── 5. Advanced (opt-in) ──
            advanced: null as Record<string, any> | null
        };

        // FM → device HTTP probe
        if (deviceIp) {
            if (isPrivateIp(deviceIp) && !isPrivateIp(req.hostname)) {
                report.fmReachability = {
                    reachable: null,
                    skipped: true,
                    reason: `Device IP ${deviceIp} is private — not reachable from public FM host`
                };
            } else {
                report.fmReachability = await probeDeviceHttp(deviceIp);
            }
        }

        // RPC sanity check (lightweight — only if online)
        if (device.online && device.transport) {
            const rpcStart = Date.now();
            try {
                const info = await device.sendRPC('Shelly.GetDeviceInfo', {});
                report.transportHealth.rpcCheck = {
                    ok: true,
                    elapsed: Date.now() - rpcStart,
                    id: info?.id
                };
            } catch (e: any) {
                report.transportHealth.rpcCheck = {
                    ok: false,
                    elapsed: Date.now() - rpcStart,
                    error: e.message
                };
            }
        }

        // Advanced probes (opt-in via ?advanced=true)
        if (
            req.query.advanced === 'true' &&
            device.online &&
            device.transport
        ) {
            const advStart = Date.now();
            try {
                const methods = await device.sendRPC('Shelly.ListMethods', {});
                report.advanced = {
                    listMethods: {
                        ok: true,
                        elapsed: Date.now() - advStart,
                        count: methods?.methods?.length || 0,
                        methods: methods?.methods || []
                    }
                };
            } catch (e: any) {
                report.advanced = {
                    listMethods: {
                        ok: false,
                        elapsed: Date.now() - advStart,
                        error: e.message
                    }
                };
            }
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
