import fs from 'node:fs';
import fsAsync from 'node:fs/promises';
import https from 'node:https';
import * as path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import log4js from 'log4js';
import multer from 'multer';
import RED from 'node-red';
import passport from 'passport';
import {ZitadelIntrospectionStrategy} from 'passport-zitadel';
import sharp from 'sharp';
import {DEV_MODE, configRc, isZitadelConfigured} from '../../config';
import {NODE_RED_SETTINGS, setup as setupNodeRed} from '../../config/node-red';
import type {WebComponentConfig} from '../../model/component/WebComponent';
import * as Commander from '../../modules/Commander';
import RpcError from '../../rpc/RpcError';
import type {JsonRpcIncomming} from '../../rpc/types';
import type {Sendable, user_t} from '../../types';
import * as Observability from '../Observability';
import {UNAUTHORIZED_USER, getUserFromToken} from '../user';
// import auth from './routes/auth';
import api from './routes/api';
import deviceProxy from './routes/device-proxy';
import grafana from './routes/grafana';
import MessageHandler from './ws/MessageHandler';
import WebsocketController from './ws/WebsocketController';
import ClientWebsocketHandler from './ws/handlers/ClientWebsocketHandler';
import LocalWebsocketHandler from './ws/handlers/LocalWebsocketHandler';
import ShellyWebsocketHandler, {
    getInitStats
} from './ws/handlers/ShellyWebsocketHandler';

const logger = log4js.getLogger('web');

const KNOWN_LOG_CATEGORIES = [
    'default',
    'web',
    'shelly-ws',
    'postgres',
    'message-parser',
    'DeviceCollector',
    'Commander',
    'audit',
    'Observability',
    'FirmwareScheduler',
    'local-scanner',
    'registry',
    'Plugin Loader',
    'device-proxy',
    'message-handler',
    'config',
    'AbstractDevice',
    'device',
    'GroupComponent',
    'BackupComponent',
    'FirmwareComponent',
    'user',
    'WaitingRoom',
    'client-ws',
    'local-ws',
    'ws-server',
    'ws-upgrade',
    'api',
    'grafana-proxy',
    'ShellyComponents',
    'shelly-events',
    'event-model',
    'frontend-builder',
    'plugin-loader'
];

// Middleware helpers

function isLoggedIn(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (req.token === undefined) {
        res.status(401).end();
        return;
    }

    if (req.user === undefined) {
        res.status(403).end();
        return;
    }

    next();
}

function isNotDefaultUser(
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

function requiresAdmin(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (
        !req.user ||
        req.user.username === UNAUTHORIZED_USER.username ||
        (req.user.group !== 'admin' && !req.user.permissions.includes('*'))
    ) {
        res.status(403).end();
        return;
    }
    next();
}

// HTTP request tracking for Prometheus
const httpRequestCounts = new Map<string, number>();
const httpStatusCounts = new Map<number, number>();
let httpActiveRequests = 0;

export function getHttpStats() {
    return {
        requestCounts: httpRequestCounts,
        statusCounts: httpStatusCounts,
        activeRequests: httpActiveRequests
    };
}

function registerMiddleware(app: express.Express) {
    // Request counting middleware (first in chain for accuracy)
    app.use((req, res, next) => {
        httpActiveRequests++;
        const route = req.path.split('/').slice(0, 3).join('/') || '/';
        httpRequestCounts.set(route, (httpRequestCounts.get(route) ?? 0) + 1);
        res.on('finish', () => {
            httpActiveRequests--;
            const bucket = Math.floor(res.statusCode / 100) * 100; // 200, 300, 400, 500
            httpStatusCounts.set(
                bucket,
                (httpStatusCounts.get(bucket) ?? 0) + 1
            );
        });
        next();
    });
    app.use((req, res, next) => {
        // Website you wish to allow to connect
        res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');

        // Request methods you wish to allow
        res.setHeader(
            'Access-Control-Allow-Methods',
            'GET, POST, OPTIONS, PUT, PATCH, DELETE'
        );

        // Request headers you wish to allow
        res.setHeader(
            'Access-Control-Allow-Headers',
            'X-Requested-With,content-type'
        );

        // Pass to next layer of middleware
        next();
    });
    app.use(cors());
    app.use([
        log4js.connectLogger(logger, {
            level: 'auto',
            format: ':status :method :url',
            nolog: ['/health', '/metrics']
        }),
        express.json(),
        cookieParser()
    ]);
    // assign token in req object
    app.use(async (req, res, next) => {
        let token = '';
        if (typeof req.headers.authorization === 'string') {
            // Look at Request Headers
            const authHeader = req.headers.authorization;
            if (authHeader.includes(' ')) {
                token = authHeader.split(' ').at(-1)!;
            }
        } else if (typeof req.query.token === 'string') {
            // Look for Query Params
            token = req.query.token;
        } else if (req.cookies.token) {
            // Look in Cookies
            token = req.cookies.token;
        }

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
    });
}

const messageHandler = new MessageHandler();

async function handleWebRpc(
    res: express.Response,
    user: user_t,
    method: string,
    params: any
) {
    const sendable: Sendable = {
        send(data) {
            const parsed = JSON.parse(data);
            res.json(parsed?.result ?? parsed).end();
        }
    };

    // bad type casting
    const msg: JsonRpcIncomming = {
        id: null as any,
        src: undefined as any,
        method,
        params
    };
    messageHandler.handleInternalCommands(sendable, msg, user);
}

function registerRpcHandlers(app: express.Express) {
    app.get('/rpc/:method', isLoggedIn, (req, res) => {
        handleWebRpc(res, req.user!, req.params.method, req.query);
    });
    app.post('/rpc/:method', isLoggedIn, (req, res) => {
        handleWebRpc(res, req.user!, req.params.method, req.body);
    });
    app.post('/rpc', isLoggedIn, (req, res) => {
        const {method, params} = req.body;
        if (typeof method !== 'string') {
            res.status(400).json(RpcError.InvalidRequest().getRpcError());
            return;
        }
        handleWebRpc(res, req.user!, method, params);
    });
}

// Shared upload paths (used by both static serving and API routes)
const backgroundsPath = path.join(__dirname, '../../../uploads/backgrounds');
const profilePicturesPath = path.join(
    __dirname,
    '../../../uploads/profilePics'
);
const reportImagesPath = path.join(__dirname, '../../../uploads/reportImages');
const emReportsPath = path.join(__dirname, '../../../uploads/reports');
const auditLogsPath = path.join(__dirname, '../../../uploads/audit-logs');

// Public routes — registered before auth middleware.
function registerStaticRoutes(app: express.Express) {
    for (const dir of [
        backgroundsPath,
        profilePicturesPath,
        reportImagesPath,
        emReportsPath,
        auditLogsPath
    ]) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
    }

    // Health endpoint (used by Docker healthcheck, no auth needed)
    const appVersion = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    ).version;
    app.get('/health', (req, res) => {
        const metrics = Observability.getMetrics();
        res.json(
            metrics
                ? {
                      online: true,
                      version: appVersion,
                      obsLevel: Observability.getLevel(),
                      metrics
                  }
                : {
                      online: true,
                      version: appVersion,
                      obsLevel: Observability.getLevel()
                  }
        );
    });

    // NOTE: POST /health/observability, POST /health/observability/reset, and
    // POST /health/log-level are registered in registerRouters() with admin auth.

    // DB writes diagnostic toggle — GET is public (read-only), POST requires admin (in registerRouters)
    app.get('/health/db-writes', (req, res) => {
        res.json({dbWritesDisabled: Observability.isDbWritesDisabled()});
    });

    // Export debug report (full observability dump)
    app.get('/health/debug-report', (req, res) => {
        const report = Observability.getDebugReport();
        res.json(report);
    });

    // Metric history for sparklines (returns last 1 hour of snapshots)
    app.get('/health/history', (req, res) => {
        const history = Observability.getMetricHistory();
        res.json({history});
    });

    // Frontend telemetry ingestion — receives batched interaction counts
    app.post('/api/telemetry/events', express.json(), (req, res) => {
        const {counts, clicks} = req.body ?? {};
        if (counts && typeof counts === 'object') {
            for (const [key, val] of Object.entries(counts)) {
                if (typeof val === 'number' && val > 0) {
                    Observability.incrementCounter(`ui_${key}`, val);
                }
            }
        }
        if (typeof clicks === 'number' && clicks > 0) {
            Observability.incrementCounter('ui_clicks_total', clicks);
        }
        res.json({ok: true});
    });

    // Prometheus exposition endpoint
    app.get('/metrics', (req, res) => {
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(Observability.getPrometheusMetrics());
    });

    // Runtime log level control — uses module-scoped KNOWN_LOG_CATEGORIES

    app.get('/health/log-levels', (req, res) => {
        const levels: Record<string, string> = {};
        for (const cat of KNOWN_LOG_CATEGORIES) {
            const catLogger = log4js.getLogger(cat);
            levels[cat] = catLogger.level.toString();
        }
        res.json({levels});
    });

    // POST /health/log-level is registered in registerRouters() with admin auth.

    app.use('/uploads/reportImages', express.static(reportImagesPath));
    app.use('/uploads/backgrounds', express.static(backgroundsPath));
    app.use(
        '/uploads/profilePics',
        express.static(profilePicturesPath),
        (req, res) => {
            // Serve default profile picture for missing users
            res.sendFile(path.join(profilePicturesPath, 'default.png'));
        }
    );

    // Serve plugin static assets
    const pluginsPath = path.join(__dirname, '../../../plugins');
    app.use('/plugins', express.static(pluginsPath));
}

function registerRouters(app: express.Express) {
    // app.use('/auth', auth);
    app.use('/api', api);
    if (configRc.graphs?.grafana) {
        app.use('/grafana', grafana);
    }

    // --- Admin-only diagnostic controls (registered after auth middleware) ---

    // DB writes toggle
    app.post('/health/db-writes', requiresAdmin, express.json(), (req, res) => {
        const {disabled} = req.body ?? {};
        if (typeof disabled !== 'boolean') {
            res.status(400).json({error: 'Provide disabled (boolean)'});
            return;
        }
        Observability.setDbWritesDisabled(disabled);
        res.json({dbWritesDisabled: Observability.isDbWritesDisabled()});
    });

    // Observability level toggle
    app.post(
        '/health/observability',
        requiresAdmin,
        express.json(),
        (req, res) => {
            const {level, enabled} = req.body ?? {};
            if (level !== undefined) {
                if (![0, 1, 2, 3].includes(level)) {
                    res.status(400).json({
                        error: 'level must be 0, 1, 2, or 3'
                    });
                    return;
                }
                Observability.setLevel(level);
            } else if (typeof enabled === 'boolean') {
                // Backward compat
                if (enabled) Observability.setLevel(2);
                else Observability.setLevel(0);
            } else {
                res.status(400).json({
                    error: 'Provide level (0-3) or enabled (boolean)'
                });
                return;
            }
            res.json({
                observability: Observability.isEnabled(),
                level: Observability.getLevel()
            });
        }
    );

    // Reset observability timings & counters
    app.post('/health/observability/reset', requiresAdmin, (req, res) => {
        Observability.resetTimings();
        res.json({reset: true});
    });

    // Runtime log level control
    app.post('/health/log-level', requiresAdmin, express.json(), (req, res) => {
        const {category, level: lvl} = req.body ?? {};
        if (!category || !lvl) {
            res.status(400).json({error: 'Provide category and level'});
            return;
        }
        const validLevels = [
            'OFF',
            'FATAL',
            'ERROR',
            'WARN',
            'INFO',
            'DEBUG',
            'TRACE',
            'ALL',
            'MARK'
        ];
        if (!validLevels.includes(String(lvl).toUpperCase())) {
            res.status(400).json({
                error: `Invalid level. Valid: ${validLevels.join(', ')}`
            });
            return;
        }
        const catLogger = log4js.getLogger(category);
        catLogger.level = lvl;
        res.json({category, level: catLogger.level.toString()});
    });

    // Device proxy routes (for embedded web GUI)
    app.use('/api/device-proxy', deviceProxy);

    const upload = multer({dest: 'uploads/'});

    // Audit log CSV download
    app.get('/api/audit-log/download/:filename', isLoggedIn, (req, res) => {
        const {filename} = req.params;
        // Security: only allow .csv files with expected pattern
        if (!/^audit-log-\d+\.csv$/.test(filename)) {
            res.status(400).send('Invalid filename');
            return;
        }
        const fullPath = path.join(auditLogsPath, filename);
        fs.access(fullPath, fs.constants.R_OK, (err) => {
            if (err) {
                res.status(404).send('File not found');
                return;
            }
            res.download(fullPath, filename);
        });
    });

    app.get('/api/reports/download/:filename', isLoggedIn, (req, res) => {
        const {filename} = req.params;
        if (!/^[a-zA-Z0-9\-_.]+\.csv$/.test(filename)) {
            res.status(400).send('Invalid filename');
            return;
        }
        const fullPath = path.join(emReportsPath, filename);
        fs.access(fullPath, fs.constants.R_OK, (err) => {
            if (err) {
                res.status(404).send('File not found');
                return;
            }
            res.download(fullPath, filename);
        });
    });

    app.get('/media/getAllBackgrounds', (req, res) => {
        fs.readdir(backgroundsPath, (err, files) => {
            if (err)
                return res
                    .status(500)
                    .json({error: 'Failed to read directory'});

            const thumbnails = files.filter((file) => file.includes('_thumb'));
            const originals = files.filter((file) => !file.includes('_thumb'));

            return res.json({thumbnails, originals});
        });
    });

    app.post(
        '/media/uploadBackgroud',
        upload.single('image'),
        async (req, res) => {
            const file = req.file;
            if (!file) {
                return res.status(400).json({error: 'No file uploaded'});
            }
            const originalPath = path.join(backgroundsPath, file.originalname);
            const thumbPath = path.join(
                backgroundsPath,
                file.originalname.replace(/\.(jpg|jpeg|png)$/i, '_thumb.$1')
            );

            try {
                // Move original file to backgrounds directory
                fs.renameSync(file.path, originalPath);

                // Create a thumbnail
                await sharp(originalPath)
                    .resize({width: 150, height: 150, fit: 'cover'})
                    .toFile(thumbPath);

                return res.json({
                    success: true,
                    message: 'Image uploaded successfully'
                });
            } catch (err) {
                logger.error('Background upload failed: %s', err);
                return res.status(500).json({error: 'Failed to process image'});
            }
        }
    );
    app.post(
        '/media/uploadProfilePic',
        upload.single('image'),
        async (req, res) => {
            const {username} = req.body;
            const file = req.file;

            if (!file) {
                return res.status(400).json({error: 'No file uploaded'});
            }

            // Set the target filenames
            const baseFilename = `${username}.png`;
            const originalPath = path.join(profilePicturesPath, baseFilename);

            try {
                // Move the uploaded file to the desired location, replacing the existing file
                fs.renameSync(file.path, originalPath);

                return res.json({
                    success: true,
                    message: 'Image uploaded and replaced successfully'
                });
            } catch (err) {
                logger.error('Profile pic upload failed: %s', err);
                return res.status(500).json({error: 'Failed to process image'});
            }
        }
    );
    app.post('/media/deleteBackground', async (req, res) => {
        const {fileName} = req.body;
        const originalPath = path.join(backgroundsPath, fileName);
        const thumbPath = path.join(
            backgroundsPath,
            fileName.replace(/\.(jpg|jpeg|png)$/i, '_thumb.$1')
        );

        try {
            await fsAsync.stat(originalPath);
            await fsAsync.unlink(originalPath);
            await fsAsync.stat(thumbPath);
            await fsAsync.unlink(thumbPath);

            return res.json({
                success: true,
                message: 'Image deleted successfully'
            });
        } catch (err) {
            logger.error('Background delete failed: %s', err);
            return res.status(500).json({error: 'Failed to delete image'});
        }
    });

    app.get('/media/deleteBackground', (req, res) => {
        return res.status(405).json({error: 'Method not allowed'});
    });

    app.get(
        '/media/getAllReportImages',
        (req: express.Request, res: express.Response): void => {
            fs.readdir(reportImagesPath, (err, files) => {
                if (err) {
                    res.status(500).json({
                        error: 'Failed to read reportImages directory'
                    });
                    return;
                }
                const thumbnails = files.filter((f) => f.includes('_thumb'));
                const originals = files.filter((f) => !f.includes('_thumb'));
                res.json({thumbnails, originals});
                return;
            });
            return;
        }
    );

    const uploadReportImage = multer({dest: 'uploads/temp/'});
    app.post(
        '/media/uploadReportImage',
        uploadReportImage.single('image'),
        async (req: express.Request, res: express.Response): Promise<void> => {
            const file = req.file;
            const {reportName} = req.body; // expects form-field "reportName"
            if (!file || !reportName) {
                res.status(400).json({
                    error: 'Missing image file or reportName'
                });
                return;
            }

            const ext = path.extname(file.originalname);
            const timestamp = Date.now();
            const wrapped = `report_${reportName}_${timestamp}`;
            const originalName = `${wrapped}${ext}`;
            const thumbName = `${wrapped}_thumb${ext}`;

            const destOriginal = path.join(reportImagesPath, originalName);
            const destThumb = path.join(reportImagesPath, thumbName);

            try {
                fs.renameSync(file.path, destOriginal);
                await sharp(destOriginal)
                    .resize(150, 150, {fit: 'cover'})
                    .toFile(destThumb);

                res.json({
                    success: true,
                    original: originalName,
                    thumbnail: thumbName
                });
                return;
            } catch (err) {
                logger.error('Report image upload failed: %s', err);
                res.status(500).json({error: 'Failed to process report image'});
                return;
            }
        }
    );

    // Handle home assistant like authentication (trick Shelly Wall Display)
    app.post('/auth/login_flow', (req, res) => {
        res.json({
            flow_id: 'something',
            data_schema: ['username', 'haha_password']
        });
    });
    // #endregion
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
    passport.use(new ZitadelIntrospectionStrategy(configRc.oidc!.backend));
    app.use(passport.initialize());

    if (DEV_MODE) {
        logger.info('DEV MODE: Both Zitadel and local auth are available');
    }
}

function registerFrontEnd(app: express.Express) {
    if (configRc.components?.web?.relativeClientPath) {
        const clientPath = path.join(
            __dirname,
            configRc.components.web.relativeClientPath
        );

        const indexPath = path.join(clientPath, 'index.html');

        app.use('/', express.static(clientPath));
        logger.info('frontend static path %s', clientPath);

        // SPA fallback - serve index.html for all unmatched routes
        // This must be registered after all other routes
        app.get('*', (req, res, next) => {
            // Skip API routes and websocket upgrades
            if (
                req.path.startsWith('/rpc') ||
                req.path.startsWith('/node-red') ||
                req.path.startsWith('/grafana') ||
                req.path.startsWith('/api') ||
                req.path.startsWith('/health') ||
                req.path.startsWith('/metrics') ||
                req.path.startsWith('/media') ||
                req.path.startsWith('/uploads') ||
                req.path.startsWith('/auth/login_flow')
            ) {
                return next();
            }

            // Check if index.html exists
            if (fs.existsSync(indexPath)) {
                res.sendFile(indexPath);
            } else {
                next();
            }
        });
    }
}

export async function start() {
    const app = express();

    // Serve static assets BEFORE auth middleware —
    // browsers don't send tokens for JS/CSS/image requests.
    registerFrontEnd(app);
    registerStaticRoutes(app);

    registerMiddleware(app);
    registerRouters(app);
    registerRpcHandlers(app);
    registerZitadelAuth(app);

    // load web config
    const config: Required<WebComponentConfig> =
        await Commander.execInternal('Web.GetConfig');

    // setup node red
    setupNodeRed();

    // register web controllers
    const messageHandler = new MessageHandler();

    const shellyHandler = new ShellyWebsocketHandler();
    const clientHandler = new ClientWebsocketHandler(messageHandler);
    const localHandler = new LocalWebsocketHandler(messageHandler, config);

    // Register observability module for device init stats
    Observability.registerModule('deviceInit', getInitStats);

    let wsController: WebsocketController;
    let wssController: WebsocketController;

    // start webservers

    // start unsecure
    if (config.port > -1) {
        const serverHttp = app.listen(config.port, () => {
            logger.info('web started on port:[%i]', config.port);
        });

        RED.init(serverHttp, NODE_RED_SETTINGS);
        serverHttp.setTimeout(120000);

        wsController = new WebsocketController(
            serverHttp,
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
        const serverHttps = https
            .createServer(httpsOptions, app)
            .listen(config.port_ssl, () => {
                logger.info('secure web started on port:[%i]', config.port_ssl);
            });

        RED.init(serverHttps, NODE_RED_SETTINGS);
        serverHttps.setTimeout(120000);
        wssController = new WebsocketController(
            serverHttps,
            shellyHandler,
            clientHandler
        );
    }

    // start node red
    app.use(
        NODE_RED_SETTINGS.httpNodeRoot,
        [isLoggedIn, isNotDefaultUser],
        RED.httpNode
    );
    app.use(
        NODE_RED_SETTINGS.httpAdminRoot,
        [isLoggedIn, isNotDefaultUser],
        RED.httpAdmin
    );
    RED.start();
}
