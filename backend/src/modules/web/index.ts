import fs from 'node:fs';
import type http from 'node:http';
import https from 'node:https';
import * as path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import log4js from 'log4js';
import passport from 'passport';
import {ZitadelIntrospectionStrategy} from 'passport-zitadel';
import {configRc, DEV_MODE, isZitadelConfigured, tuning} from '../../config';
import type {WebComponentConfig} from '../../model/component/WebComponent';
import {
    WEB_DEFAULT_HTTPS_CRT,
    WEB_DEFAULT_HTTPS_KEY,
    WEB_DEFAULT_PORT,
    WEB_DEFAULT_PORT_SSL
} from '../../model/component/webConfigValidation';
import * as Commander from '../../modules/Commander';
import {
    getDbWrites,
    getDebugReport,
    getFullHealth,
    getLiveHealth,
    getLogLevels,
    getReadyHealth,
    getStreamsHealth,
    getVersionInfo,
    readAppVersion,
    resetObservability,
    setDbWrites,
    setLogLevel,
    setObservability
} from '../../modules/systemControls';
import {httpStatusFor} from '../../rpc/errors';
import RpcError from '../../rpc/RpcError';
import type {JsonRpcIncoming} from '../../rpc/types';
import type {Sendable, user_t} from '../../types';
import {
    canPerformComponentOperationAsync,
    isComponentPermissionAllowed
} from '../authz/evaluator';
import {buildCoverage} from '../componentCoverage';
import {
    isSanitizedManifestExportEnabled,
    readSanitizedDeployManifest
} from '../controlPlaneContract';
import {getAll as getAllDevices} from '../DeviceCollector';
import {
    cleanupExpiredTemporaryFirmwareFiles,
    firmwareLibraryPath,
    temporaryFirmwareFiles,
    temporaryFirmwareUploadsPath
} from '../firmwareLibrary';
import * as Observability from '../Observability';
import {
    readClientDeviceUsageSnapshot,
    toClientDeviceUsageApiResponse
} from '../observability/clientDeviceUsage';
import {getUserFromToken, UNAUTHORIZED_USER} from '../user';
import {accessLogOptions} from './accessLog';
import {selectHttpAuthToken} from './authToken';
import {buildIntrospectionOptions} from './oidcAuth';
import {enforceRateLimit, httpRouteLimit} from './rateLimit';
// import auth from './routes/auth';
import apiDocs from './routes/apiDocs';
import assetUpload from './routes/assetUpload';
import auditDownload from './routes/auditDownload';
import authSession from './routes/authSession';
import deviceProxy from './routes/device-proxy';
import emailAssets from './routes/emailAssets';
import firmwareUpload from './routes/firmwareUpload';
import floorPlanUpload from './routes/floorPlanUpload';
import grafana from './routes/grafana';
import {buildDefaultRouter as buildGrafanaAlertWebhookRouter} from './routes/grafanaAlertWebhook';
import media from './routes/media';
import nodeRedProxy, {
    NODE_RED_AUTH_COOKIE,
    nodeRedSessionPreflight,
    registerNodeRedUpgradeProxy,
    requireNodeRedPermission
} from './routes/nodeRedProxy';
import oauthEmail from './routes/oauthEmail';
import providerReceipts from './routes/providerReceipts';
import tariffLivePush from './routes/tariffLivePush';
import {registerUploadAssetRoutes} from './routes/uploadAssets';
import zitadelActions from './routes/zitadelActions';
import {scopedTokenAuthMiddleware} from './scopedTokenAuth';
import {isNonSpaPath, isReservedBackendPath} from './spaFallback';
import {
    isLoggedIn,
    isNotDefaultUser,
    requireGrafanaPermission,
    requireObsAuth,
    requiresAdmin,
    requiresPlatformAdmin
} from './utils/authMiddleware';
import {paramStr} from './utils/params';
import {senderFromUser} from './utils/senderFromRequest';
import {
    auditLogsPath,
    backgroundsPath,
    emReportsPath,
    profilePicturesPath,
    reportImagesPath
} from './utils/uploadPaths';
import {viteDevHttpProxy} from './viteDevProxy';
import type AbstractWebsocketHandler from './ws/handlers/AbstractWebsocketHandler';
import ClientWebsocketHandler from './ws/handlers/ClientWebsocketHandler';
import ShellyWebsocketHandler, {
    getInitStats
} from './ws/handlers/ShellyWebsocketHandler';
import MessageHandler from './ws/MessageHandler';
import WebsocketController from './ws/WebsocketController';

const logger = log4js.getLogger('web');

// HTTP request tracking for Prometheus
const httpRequestCounts = new Map<string, number>();
const httpStatusCounts = new Map<number, number>();
let httpActiveRequests = 0;

function isNodeRedRequest(req: express.Request): boolean {
    return req.path === '/node-red' || req.path.startsWith('/node-red/');
}

function jsonBodyParser() {
    const parser = express.json({
        // rawBody only needed by HMAC-verified webhook callbacks.
        verify: (req, _res, buf) => {
            if (
                req.url?.startsWith('/api/zitadel/actions/') ||
                req.url?.startsWith('/api/notifications/provider-receipts/')
            ) {
                (req as unknown as {rawBody?: Buffer}).rawBody = buf;
            }
        }
    });

    return (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        // Node-RED deploys flows as JSON through the reverse proxy. Leave
        // those requests unparsed so large flow bodies stream to Node-RED
        // instead of hitting Express' default JSON body cap.
        if (isNodeRedRequest(req)) {
            next();
            return;
        }
        parser(req, res, next);
    };
}

export function getHttpStats() {
    return {
        requestCounts: httpRequestCounts,
        statusCounts: httpStatusCounts,
        activeRequests: httpActiveRequests
    };
}

// Path-derived access requirement for an /uploads/* tree. notFoundReason
// short-circuits to 404 (malformed path); orgId asserts tenant binding.
interface UploadAccess {
    component: 'devices' | 'groups' | 'locations';
    resourceId: string | number;
    orgId?: string;
    notFoundReason?: string;
}
type UploadAccessExtractor = (req: express.Request) => UploadAccess;

// Generic gate: 404 on malformed path, 403 on org mismatch or denied
// component:read, otherwise next(). Replaces the inline async-IIFE
// pattern that used to live once per upload tree.
function uploadAccessGate(
    extractor: UploadAccessExtractor
): express.RequestHandler {
    return (req, res, next) => {
        const access = extractor(req);
        if (access.notFoundReason) {
            res.status(404).json({error: access.notFoundReason});
            return;
        }
        if (access.orgId && req.user?.organizationId !== access.orgId) {
            res.status(403).json({error: 'permission denied'});
            return;
        }
        void (async () => {
            const sender = await senderFromUser(req.user!, {sourceIp: req.ip});
            const decision = await canPerformComponentOperationAsync(
                sender,
                access.component,
                'read',
                access.resourceId
            );
            if (!isComponentPermissionAllowed(decision)) {
                res.status(403).json({error: 'permission denied'});
                return;
            }
            next();
        })().catch(next);
    };
}

export function extractFloorPlanAccess(req: express.Request): UploadAccess {
    const raw = req.path.split('/').filter(Boolean)[0] ?? '';
    const locationId = Number.parseInt(raw, 10);
    if (!Number.isInteger(locationId) || locationId < 1) {
        return {
            component: 'locations',
            resourceId: 0,
            notFoundReason: 'Floor plan not found'
        };
    }
    return {component: 'locations', resourceId: locationId};
}

// SVG hardening: per-response CSP disables script + plugin so an uploaded
// malicious SVG cannot run JS in the FM origin if a user navigates the URL
// directly. PNG/JPEG/WEBP inherit Content-Type-driven inert rendering.
function svgInlineHardeningMiddleware(): express.RequestHandler {
    return (req, res, next) => {
        if (req.path.toLowerCase().endsWith('.svg')) {
            res.setHeader(
                'Content-Security-Policy',
                "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; sandbox"
            );
            res.setHeader('X-Content-Type-Options', 'nosniff');
        }
        next();
    };
}

// Orchestrator: each helper installs one well-named concern in the chain.
// grafana + node-red are full apps proxied into sandboxed, auth-gated iframes;
// FM's SPA CSP (script-src 'self') would block their inline bootstrap scripts.
// They ship their own security posture, so FM's helmet must not cover them.
export function isProxiedAppPath(path: string): boolean {
    return (
        path === '/grafana' ||
        path.startsWith('/grafana/') ||
        path === '/node-red' ||
        path.startsWith('/node-red/')
    );
}

function registerMiddleware(app: express.Express) {
    app.use(httpRequestCountingMiddleware());
    app.set('trust proxy', 1);
    const helmetMw = helmet(buildHelmetConfig());
    app.use((req, res, next) =>
        isProxiedAppPath(req.path) ? next() : helmetMw(req, res, next)
    );
    if (DEV_MODE) app.use(cors());
    app.use([
        log4js.connectLogger(logger, accessLogOptions()),
        jsonBodyParser(),
        cookieParser()
    ]);
    app.use(httpTokenAndUserMiddleware());
}

// Counts requests + status codes for Prometheus. Mutates module-level maps.
function httpRequestCountingMiddleware(): express.RequestHandler {
    return (req, res, next) => {
        httpActiveRequests++;
        const route = req.path.split('/').slice(0, 3).join('/') || '/';
        if (httpRequestCounts.has(route) || httpRequestCounts.size < 500) {
            httpRequestCounts.set(
                route,
                (httpRequestCounts.get(route) ?? 0) + 1
            );
        }
        res.on('finish', () => {
            httpActiveRequests--;
            const bucket = Math.floor(res.statusCode / 100) * 100; // 200/300/400/500
            httpStatusCounts.set(
                bucket,
                (httpStatusCounts.get(bucket) ?? 0) + 1
            );
        });
        next();
    };
}

// HSTS off — HTTP-on-LAN deploys. Per-route overrides (SVG sandbox,
// device-proxy frame-ancestors) still win — they set the header AFTER helmet.
function buildHelmetConfig(): Parameters<typeof helmet>[0] {
    const zitadelOrigin = zitadelOriginOrEmpty(
        configRc.oidc?.backend?.authority
    );
    const zitadelSrc = zitadelOrigin ? [zitadelOrigin] : [];
    return {
        strictTransportSecurity: false,
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                'default-src': ["'self'"],
                'script-src': ["'self'"],
                // unsafe-inline for styles: Vue :style → inline style=""
                'style-src': ["'self'", "'unsafe-inline'"],
                'img-src': ["'self'", 'data:', 'blob:', 'https:'],
                'font-src': ["'self'", 'data:'],
                'connect-src': ["'self'", 'ws:', 'wss:', ...zitadelSrc],
                'frame-src': ["'self'", ...zitadelSrc],
                'frame-ancestors': ["'self'"],
                'base-uri': ["'self'"],
                'object-src': ["'none'"],
                'form-action': ["'self'", ...zitadelSrc]
            }
        }
    };
}

export function zitadelOriginOrEmpty(authority: string | undefined): string {
    if (!authority) return '';
    try {
        return new URL(authority).origin;
    } catch {
        return '';
    }
}

// Extracts token + resolves user; assigns req.token + req.user for downstream.
function httpTokenAndUserMiddleware(): express.RequestHandler {
    return async (req, _res, next) => {
        const token = selectHttpAuthToken(req, NODE_RED_AUTH_COOKIE);
        if (token.length > 1) {
            req.token = token;
            try {
                const user = await getUserFromToken(token);
                req.user = user ?? UNAUTHORIZED_USER;
                logger.debug(
                    'HTTP auth: user=%s, group=%s, permissions=%j',
                    req.user.username,
                    req.user.group,
                    req.user.permissions
                );
            } catch (error) {
                logger.warn('Failed to get user from token: %s', error);
                req.user = UNAUTHORIZED_USER;
            }
        } else {
            req.token = '';
            req.user = UNAUTHORIZED_USER;
            logger.debug(
                'HTTP auth: no token, using UNAUTHORIZED_USER — %s %s',
                req.method,
                req.path
            );
        }
        next();
    };
}

const messageHandler = new MessageHandler();

async function handleWebRpc(
    res: express.Response,
    user: user_t,
    method: string,
    params: any
) {
    if (!enforceWebRpcRateLimit(res, user, method)) return;
    const msg: JsonRpcIncoming = {
        id: 0,
        src: 'FLEET_MANAGER',
        method,
        params
    };
    await messageHandler.handleInternalCommands(webRpcSendable(res), msg, user);
}

// True when the request may proceed; false when a 429 / error envelope was
// already written. Keeps the rate-limit error path out of the orchestrator.
function enforceWebRpcRateLimit(
    res: express.Response,
    user: user_t,
    method: string
): boolean {
    try {
        enforceRateLimit(
            user?.username ?? '',
            method,
            user?.organizationId ?? null
        );
        return true;
    } catch (err) {
        if (err instanceof RpcError) {
            const payload = err.getErrorObject();
            res.status(httpStatusFor(payload.code))
                .json({error: payload})
                .end();
            return false;
        }
        throw err;
    }
}

// Adapts a MessageHandler.send() callback to the response object — maps
// domain errors to HTTP status codes and strips the WS envelope fields
// (src/dst/jsonrpc/id) that are meaningless over HTTP.
function webRpcSendable(res: express.Response): Sendable {
    return {
        send(data) {
            const parsed = JSON.parse(data);
            if (parsed?.error) {
                const status = httpStatusFor(parsed.error.code);
                res.status(status).json({error: parsed.error}).end();
                return;
            }
            res.json(parsed?.result ?? parsed).end();
        }
    };
}

/** RPC methods allowed without authentication in DEV_MODE (local JWT login flow) */
const DEV_MODE_RPC_METHODS = new Set(['User.Authenticate', 'User.Refresh']);

const APP_VERSION: string = readAppVersion();

// Named middleware so the route-inventory picks it up; auth depends on
// the body (DEV_MODE bypass for User.Authenticate/Refresh).
function rpcBodyAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    const method = req.body?.method;
    if (
        DEV_MODE &&
        typeof method === 'string' &&
        DEV_MODE_RPC_METHODS.has(method)
    ) {
        if (!req.user) req.user = UNAUTHORIZED_USER;
        return next();
    }
    return isLoggedIn(req, res, next);
}

function registerRpcHandlers(app: express.Express) {
    const pathMethodHandler = (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        handleWebRpc(
            res,
            req.user!,
            paramStr(req.params.method),
            req.body
        ).catch(next);
    };
    const bodyHandler = (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        const {method, params} = req.body;
        if (typeof method !== 'string') {
            res.status(400).json(RpcError.InvalidRequest().getRpcError());
            return;
        }
        handleWebRpc(res, req.user!, method, params).catch(next);
    };

    // GET /rpc/:method removed (CR-41): query-string params + cookie auth
    // = CSRF surface against mutating methods. Stub returns 405 with
    // Allow: POST so any caller still on GET gets a clear migration signal
    // instead of Express's silent 404.
    app.get('/rpc/:method', (_req, res) => {
        res.status(405)
            .set('Allow', 'POST')
            .json(
                RpcError.InvalidRequest(
                    'GET /rpc/:method is no longer supported — use POST.'
                ).getRpcError()
            );
    });

    // JSON-RPC HTTP transport. `/rpc` is the canonical mount point.
    // scopedTokenAuthMiddleware swaps req.user when a Bearer scoped token
    // consumes for the targeted method; runs before the standard gates so
    // isLoggedIn/rpcBodyAuth see the synthetic user.
    app.post(
        '/rpc/:method',
        scopedTokenAuthMiddleware,
        isLoggedIn,
        pathMethodHandler
    );
    app.post('/rpc', scopedTokenAuthMiddleware, rpcBodyAuth, bodyHandler);
}

// Catch-all error middleware — RpcError → envelope, generic → 500 no stack.
function registerErrorMiddleware(app: express.Express) {
    app.use(
        (
            err: unknown,
            _req: express.Request,
            res: express.Response,
            _next: express.NextFunction
        ) => {
            if (res.headersSent) return;
            if (err instanceof RpcError) {
                const payload = err.getErrorObject();
                res.status(httpStatusFor(payload.code))
                    .json({error: payload})
                    .end();
                return;
            }
            logger.error('Unhandled HTTP error', err);
            res.status(500)
                .json({error: {code: -32000, message: 'Internal error'}})
                .end();
        }
    );
}

// Upload paths live in utils/uploadPaths so they are shared with route modules.
// Firmware library domain lives in `modules/firmwareLibrary` so
// FirmwareComponent RPC methods + the HTTP upload/download routes share one
// source of truth for paths, the temporary-token map, and sanitizers.

// Public and mixed-auth routes. These are registered after token parsing so
// routes guarded by isLoggedIn/requiresAdmin work correctly.
function registerStaticRoutes(app: express.Express) {
    for (const dir of [
        backgroundsPath,
        profilePicturesPath,
        reportImagesPath,
        emReportsPath,
        auditLogsPath,
        temporaryFirmwareUploadsPath,
        firmwareLibraryPath
    ]) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
    }

    // Public minimal /health for Docker probe; rich payload at /health/full.
    app.get('/health', (_req, res) => {
        res.json({online: true, version: APP_VERSION});
    });

    app.get('/health/live', (_req, res) => {
        res.json(getLiveHealth());
    });

    app.get(
        '/health/ready',
        httpRouteLimit({name: 'health-ready', capacityPerMin: 120}),
        async (_req, res) => {
            const health = await getReadyHealth();
            res.status(health.ready ? 200 : 503).json(health);
        }
    );

    app.get(
        '/version',
        httpRouteLimit({name: 'version', capacityPerMin: 120}),
        (_req, res) => {
            res.json(getVersionInfo());
        }
    );

    if (isSanitizedManifestExportEnabled()) {
        app.get(
            '/api/control-plane/deploy-manifest',
            httpRouteLimit({
                name: 'control-plane-deploy-manifest',
                capacityPerMin: 30
            }),
            requiresAdmin,
            (_req, res) => {
                const payload = readSanitizedDeployManifest();
                res.status(payload.status === 'invalid' ? 500 : 200).json(
                    payload
                );
            }
        );
    }

    if (tuning.controlPlaneContract.deviceUsageApi) {
        app.get(
            '/api/control-plane/device-usage',
            httpRouteLimit({
                name: 'control-plane-device-usage',
                capacityPerMin: 30
            }),
            requiresAdmin,
            async (_req, res) => {
                const snapshot = await readClientDeviceUsageSnapshot();
                res.json(
                    toClientDeviceUsageApiResponse(
                        snapshot,
                        tuning.controlPlaneContract.environmentId
                    )
                );
            }
        );
    }

    // NOTE: POST /health/observability, POST /health/observability/reset, and
    // POST /health/log-level are registered in registerRouters() with provider support auth.

    // Config-flag GETs — trivial booleans, no auth.
    app.get('/health/db-writes', (_req, res) => {
        res.json(getDbWrites());
    });

    app.get('/health/redis', (_req, res) => {
        res.json({redisDisabled: tuning.redis.disabled});
    });

    app.get('/health/log-levels', (_req, res) => {
        res.json(getLogLevels());
    });

    // Prometheus exposition — external scraper interface. Bearer-token gated
    // via FM_OBS_AUTH_TOKEN, or a logged-in session. Metric history for FM's
    // own UI lives at System.Health.GetHistory RPC (no HTTP duplication).
    // Per-client cap protects the rendering path from a misconfigured scraper
    // that hits us every second.
    app.get(
        '/metrics',
        httpRouteLimit({
            name: 'metrics',
            capacityPerMin: tuning.http.rateLimitMetricsPerMin
        }),
        requireObsAuth,
        async (_req, res) => {
            res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            res.send(await Observability.getPrometheusMetrics());
        }
    );

    // POST /health/log-level is registered in registerRouters() with provider support auth.

    const uploadStaticOpts = {maxAge: '1d', etag: true, lastModified: true};
    registerUploadAssetRoutes(app);
    // Auth-gated upload trees. Asset library binaries are served only
    // through /api/assets/:id (org check + asset row lookup).

    // Floor-plan images. Path: /<locationId>/<sha>.<ext> — no org segment
    // because location:read implies tenant binding.
    app.use(
        '/uploads/floor-plans',
        isLoggedIn,
        uploadAccessGate(extractFloorPlanAccess),
        svgInlineHardeningMiddleware(),
        express.static(
            path.join(__dirname, '../../../uploads/floor-plans'),
            uploadStaticOpts
        )
    );

    // Plugin static assets are limited to <plugin>/public. Never expose
    // backend source, package.json, node_modules, uploads, or config files.
    const pluginsPath = path.resolve(__dirname, '../../../plugins');
    app.use('/plugins/:plugin/public', (req, res, next) => {
        const plugin = req.params.plugin;
        // No '.' anywhere — kills '.', '..', dotfiles in one rule.
        if (!/^[a-zA-Z0-9_-]+$/.test(plugin)) {
            res.status(400).json({error: 'Invalid plugin asset path'});
            return;
        }
        const publicPath = path.resolve(pluginsPath, plugin, 'public');
        if (!publicPath.startsWith(`${pluginsPath}${path.sep}`)) {
            res.status(400).json({error: 'Invalid plugin asset path'});
            return;
        }
        express.static(publicPath, uploadStaticOpts)(req, res, next);
    });

    // Deliberately unauthenticated: Shelly devices fetch firmware directly and
    // cannot present Fleet Manager auth cookies or headers. Access is limited
    // by a short-lived random token, a per-client rate cap, and no-store
    // cache headers.
    app.get(
        '/media/firmware-file/:token',
        httpRouteLimit({
            name: 'firmware-file-download',
            capacityPerMin: tuning.http.rateLimitFirmwareDownloadPerMin
        }),
        (req, res) => {
            cleanupExpiredTemporaryFirmwareFiles();

            const file = temporaryFirmwareFiles.get(paramStr(req.params.token));
            if (!file) {
                res.status(404).json({
                    error: 'Firmware file not found or expired'
                });
                return;
            }

            res.setHeader('Cache-Control', 'no-store');
            const safeFileName = (file.fileName || 'firmware.bin').replace(
                /[^a-zA-Z0-9._-]/g,
                '_'
            );
            res.setHeader(
                'Content-Disposition',
                `inline; filename="${safeFileName}"`
            );
            res.sendFile(file.filePath, (error) => {
                if (error && !res.headersSent) {
                    res.status(404).json({
                        error: 'Firmware file not found or expired'
                    });
                }
            });
        }
    );
}
function registerRouters(app: express.Express) {
    // /api/switch (deprecated GET-based device toggle) removed —
    // callers must use /rpc/switch.Toggle. The legacy endpoint was
    // CSRF-able via cookie auth and only kept under a Sunset header.
    app.use('/api', tariffLivePush);
    app.use('/api/notifications', providerReceipts);
    // Grafana alert webhook is shared-secret authed — must mount BEFORE the
    // `/api` isLoggedIn gate below, or it 403s before checking its secret.
    if (configRc.graphs?.grafana) {
        app.use('/api/grafana', buildGrafanaAlertWebhookRouter());
    }
    app.use('/api/notifications', isLoggedIn, emailAssets);
    app.use('/api/uploads', isLoggedIn, floorPlanUpload);
    app.use('/api', isLoggedIn, assetUpload);
    // OAuth callback is intentionally unauthenticated — the state
    // token in the query string is the CSRF + identity proof.
    app.use('/api/oauth', oauthEmail);
    app.use('/api/zitadel/actions', zitadelActions);
    if (configRc.graphs?.grafana) {
        app.use('/grafana', isLoggedIn, requireGrafanaPermission, grafana);
    }
    // Node-RED routes only mount when the feature is enabled; absent the
    // flag, /node-red/* falls through to the catch-all 404.
    if (tuning.nodeRed.enabled) {
        app.options('/node-red/session', nodeRedSessionPreflight);
        app.use(
            '/node-red',
            isLoggedIn,
            isNotDefaultUser,
            requireNodeRedPermission,
            nodeRedProxy
        );
    }
    app.use('/api/auth/session', authSession);
    app.use('/api/device-proxy', deviceProxy);
    app.use('/api/docs', apiDocs);
    app.use('/api', auditDownload);
    app.use('/media', media);
    app.use('/media', firmwareUpload);

    registerHealthAdminRoutes(app);
    // Wall Display expects a Home Assistant-like auth flow response.
    // Returns a minimal schema so the device proceeds with WS connection.
    app.post(
        '/auth/login_flow',
        httpRouteLimit({
            name: 'login-flow',
            capacityPerMin: tuning.http.rateLimitLoginFlowPerMin
        }),
        (_req, res) => {
            res.json({
                flow_id: 'fleet-manager',
                data_schema: ['username', 'password']
            });
        }
    );
}

function registerHealthAdminRoutes(app: express.Express) {
    // Admin-only — rich payload off /health to avoid public fingerprinting.
    app.get('/health/full', requiresAdmin, async (_req, res) => {
        res.json(await getFullHealth());
    });

    // Debug report — requires login since it may contain error details
    app.get('/health/debug-report', isLoggedIn, (_req, res) => {
        res.json(getDebugReport());
    });

    // Per-subsystem state for the Redis Streams + Pub/Sub campaign. Reports
    // what's wired, what's healthy, and what the kill switch is doing.
    app.get('/health/streams', isLoggedIn, async (_req, res) => {
        try {
            res.json(await getStreamsHealth());
        } catch (err) {
            res.status(500).json({error: String(err)});
        }
    });

    // DB writes toggle — instance-wide; provider support only.
    app.post(
        '/health/db-writes',
        requiresPlatformAdmin,
        express.json(),
        (req, res) => {
            try {
                res.json(setDbWrites(req.body?.disabled));
            } catch (err) {
                res.status(400).json({
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }
    );

    // No POST /health/redis — Redis adapter is chosen at boot
    // (FM_REDIS_DISABLED); runtime mutability is intentionally not
    // supported. Restart with a different env to switch.

    // Observability level toggle — instance-wide; provider support only.
    app.post(
        '/health/observability',
        requiresPlatformAdmin,
        express.json(),
        (req, res) => {
            try {
                res.json(setObservability(req.body ?? {}));
            } catch (err) {
                res.status(400).json({
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }
    );

    // Reset observability timings & counters — instance-wide.
    app.post(
        '/health/observability/reset',
        requiresPlatformAdmin,
        (_req, res) => {
            res.json(resetObservability());
        }
    );

    // Runtime log level control — instance-wide.
    app.post(
        '/health/log-level',
        requiresPlatformAdmin,
        express.json(),
        (req, res) => {
            try {
                res.json(
                    setLogLevel({
                        category: req.body?.category,
                        level: req.body?.level
                    })
                );
            } catch (err) {
                res.status(400).json({
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }
    );

    // Component-types firmware exposes that FM has no renderer for yet.
    app.get('/health/components/coverage', requiresAdmin, (_req, res) => {
        safeBuildCoverageResponse(res);
    });
}

function safeBuildCoverageResponse(res: express.Response): void {
    try {
        res.json(buildCoverage(getAllDevices()));
    } catch (err) {
        logger.error('coverage_route_failed', err);
        res.status(500).json({
            error: {code: -32000, message: 'Internal error'}
        });
    }
}

function registerZitadelAuth(app: express.Express) {
    if (!isZitadelConfigured()) {
        if (DEV_MODE) {
            logger.info('DEV MODE: Zitadel not configured - local auth only');
        } else {
            logger.error(
                'Zitadel OIDC is not configured - authentication will not work'
            );
        }
        return;
    }

    logger.debug('Configuring Zitadel authentication');
    const introspectionOptions = buildIntrospectionOptions(
        configRc.oidc!.backend
    );
    logger.info(
        'Zitadel introspection auth method: %s',
        introspectionOptions.authorization.type
    );
    passport.use(new ZitadelIntrospectionStrategy(introspectionOptions));
    app.use(passport.initialize());

    if (DEV_MODE) {
        logger.info('DEV MODE: Both Zitadel and local auth are available');
    }
}

function registerFrontEnd(app: express.Express) {
    if (DEV_MODE) {
        // Dev: serve the UI live from the Vite dev server (HMR). Backend API
        // paths fall through to their own routes; everything else goes to Vite.
        app.use((req, res, next) => {
            if (isReservedBackendPath(req.path)) return next();
            viteDevHttpProxy(req, res);
        });
        logger.info('frontend served via Vite dev proxy (HMR)');
        return;
    }
    if (configRc.components?.web?.relativeClientPath) {
        const clientPath = path.join(
            __dirname,
            configRc.components.web.relativeClientPath
        );

        const indexPath = path.join(clientPath, 'index.html');

        // Operator FM SPA at /admin/ — present only in dual-bundle runtime-bm
        // images. Same Express, same backend, same Postgres; just a second
        // frontend bundle so end-customers see the template on / and the
        // installer/admin can reach the real FM SPA (Waiting Room, device
        // approval, accounts) at /admin/ in a new tab.
        //
        // Must register BEFORE the / static + SPA-fallback so /admin/*
        // requests don't fall through to the template index.html.
        const adminClientPath = path.join(clientPath, '..', 'dist-admin');
        const adminIndexPath = path.join(adminClientPath, 'index.html');
        const hasAdminBundle = fs.existsSync(adminClientPath);
        if (hasAdminBundle) {
            app.use(
                '/admin/assets',
                express.static(path.join(adminClientPath, 'assets'), {
                    maxAge: '1y',
                    immutable: true,
                    etag: false
                })
            );
            app.use('/admin', express.static(adminClientPath));
            logger.info('admin frontend static path %s', adminClientPath);

            // SPA fallback scoped to /admin/* — must come BEFORE the global
            // /*splat below or that one wins and serves the template.
            app.get('/admin/*splat', (req, res, next) => {
                if (/\.\w+$/.test(req.path)) {
                    return next();
                }
                if (fs.existsSync(adminIndexPath)) {
                    res.sendFile(adminIndexPath);
                } else {
                    next();
                }
            });
        }

        // Vite hashed assets (js/css) — immutable, cache forever
        app.use(
            '/assets',
            express.static(path.join(clientPath, 'assets'), {
                maxAge: '1y',
                immutable: true,
                etag: false
            })
        );
        // Unknown device models 200-fallback to generic logo (no 404 log spam).
        const genericLogoPath = path.join(
            clientPath,
            'images/branding/shelly_logo_black.jpg'
        );
        app.use(
            '/images/devices',
            express.static(path.join(clientPath, 'images/devices'), {
                maxAge: '1d',
                etag: true,
                lastModified: true
            }),
            (req, res, next) => {
                if (!/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(req.path)) {
                    return next();
                }
                res.setHeader('Cache-Control', 'public, max-age=86400');
                res.setHeader('X-Image-Fallback', '1');
                res.sendFile(genericLogoPath);
            }
        );
        // Branding + predefined images — misses are real bugs, no fallback.
        app.use(
            '/images',
            express.static(path.join(clientPath, 'images'), {
                maxAge: '1d',
                etag: true,
                lastModified: true
            })
        );
        // index.html + sw.js + manifest: never heuristic-cached. /assets
        // is already immutable above.
        app.use(
            '/',
            express.static(clientPath, {
                setHeaders: (res, filePath) => {
                    if (
                        filePath.endsWith('.html') ||
                        filePath.endsWith('sw.js') ||
                        filePath.endsWith('.webmanifest')
                    ) {
                        res.setHeader('Cache-Control', 'no-cache');
                    }
                }
            })
        );
        logger.info('frontend static path %s', clientPath);

        // SPA fallback - serve index.html for all unmatched routes
        // This must be registered after all other routes
        app.get('/*splat', (req, res, next) => {
            // API / system / static paths must never get the SPA template.
            if (isNonSpaPath(req.path)) {
                return next();
            }

            if (fs.existsSync(indexPath)) {
                res.setHeader('Cache-Control', 'no-cache');
                res.sendFile(indexPath);
            } else {
                next();
            }
        });
    }
}

let httpServer: http.Server | undefined;
let httpsServer: https.Server | undefined;
// Tracked for graceful shutdown — closing these releases bound ports
// so SIGTERM doesn't leak listeners.
let wsHandlers: AbstractWebsocketHandler[] = [];

// Fatal-exit on startup port-bind failure so nodemon / docker restart cleanly
// instead of leaving a half-booted zombie holding other ports.
function attachFatalBindErrorHandler(
    srv: http.Server | https.Server,
    port: number
): void {
    srv.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
            logger.fatal(
                'web server bind failed on port %d: %s',
                port,
                err.message
            );
            process.exit(1);
        }
    });
}

export async function stop(timeoutMs = 10_000): Promise<void> {
    const closes: Promise<void>[] = [];
    const closeServer = (srv: http.Server | https.Server | undefined) => {
        if (!srv) return;
        closes.push(
            new Promise((resolve) => {
                const forceKill = setTimeout(() => {
                    // close() hasn't returned within timeoutMs — force-drop
                    // every live connection so the port releases and close()
                    // can complete. Node 18.2+.
                    if (typeof srv.closeAllConnections === 'function') {
                        srv.closeAllConnections();
                    }
                    resolve();
                }, timeoutMs);
                srv.close(() => {
                    clearTimeout(forceKill);
                    resolve();
                });
            })
        );
    };
    closeServer(httpServer);
    closeServer(httpsServer);
    await Promise.all(closes);
    httpServer = undefined;
    httpsServer = undefined;

    // Release ws.Server listening sockets that http close alone leaves
    // bound. Best-effort.
    await Promise.all(
        wsHandlers.map((h) =>
            h.close().catch((err) => {
                logger.warn('ws handler close failed: %s', err);
            })
        )
    );
    wsHandlers = [];
}

export async function start() {
    const app = express();

    // First middleware so it wraps every response, including static assets.
    if (tuning.http.compressionEnabled) {
        app.use(
            compression({
                threshold: tuning.http.compressionMinBytes,
                level: tuning.http.compressionLevel
            })
        );
    }

    // Frontend assets can stay ahead of auth/token parsing.
    registerFrontEnd(app);

    registerMiddleware(app);
    registerStaticRoutes(app);
    registerRouters(app);
    registerRpcHandlers(app);
    registerZitadelAuth(app);
    registerErrorMiddleware(app);

    // Web.GetConfig fallback keeps /health reachable when boot RPC fails.
    let config: Required<WebComponentConfig>;
    try {
        config = await Commander.execInternal('Web.GetConfig');
    } catch (err) {
        logger.error('Web.GetConfig execInternal failed during boot:', err);
        config = {
            host: '',
            port: WEB_DEFAULT_PORT,
            port_ssl: WEB_DEFAULT_PORT_SSL,
            https_crt: WEB_DEFAULT_HTTPS_CRT,
            https_key: WEB_DEFAULT_HTTPS_KEY,
            jwt_token: ''
        };
    }

    // register web controllers — reuse the module-scope `messageHandler`
    // instance so the HTTP (`handleWebRpc`) and WS (`ClientWebsocketHandler`)
    // paths share state and counters.
    const shellyHandler = new ShellyWebsocketHandler();
    const clientHandler = new ClientWebsocketHandler(messageHandler);
    wsHandlers = [shellyHandler, clientHandler];

    // Register observability module for device init stats. Build-slow stats ride
    // along so the same panel shows the queue AND which devices built slowly.
    Observability.registerModule('deviceInit', {
        stats: () => ({
            ...getInitStats(),
            ...Observability.getSlowBuildStats()
        }),
        topology: {
            role: 'transform',
            cluster: 'ingest',
            zone: 'device_admission',
            upstreams: ['devices', 'waitingRoom'],
            downstreams: ['registry'],
            label: 'Init Queue',
            description: 'Device initialization slots',
            route: '/monitoring/device-ingest'
        }
    });
    Observability.registerHttpStats(getHttpStats);

    let _wsController: WebsocketController;
    let _wssController: WebsocketController;

    // start webservers

    // start unsecure
    if (config.port > -1) {
        httpServer = app.listen(config.port, () => {
            logger.info('web started on port:[%i]', config.port);
        });
        attachFatalBindErrorHandler(httpServer, config.port);
        registerNodeRedUpgradeProxy(httpServer);

        httpServer.setTimeout(tuning.http.httpSocketTimeoutMs);

        _wsController = new WebsocketController(
            httpServer,
            shellyHandler,
            clientHandler
        );
    }

    // start secure
    if (config.port_ssl > -1) {
        const httpsOptions = {
            key: config.https_key,
            cert: config.https_crt
        };
        httpsServer = https
            .createServer(httpsOptions, app)
            .listen(config.port_ssl, () => {
                logger.info('secure web started on port:[%i]', config.port_ssl);
            });
        attachFatalBindErrorHandler(httpsServer, config.port_ssl);
        registerNodeRedUpgradeProxy(httpsServer);

        httpsServer.setTimeout(tuning.http.httpSocketTimeoutMs);
        _wssController = new WebsocketController(
            httpsServer,
            shellyHandler,
            clientHandler
        );
    }

    if (tuning.nodeRed.enabled) {
        logger.info(
            'Node-RED standalone proxy enabled: %s',
            tuning.nodeRed.proxyTarget
        );
    } else {
        logger.info(
            'Node-RED disabled; deploy with --with nodered to start the standalone addon'
        );
    }
}
