// Serves the customer-facing API reference from the live FM instance.
//
//   GET /api/docs              -> Scalar single-file HTML (offline-shareable copy)
//   GET /api/docs/openapi.json -> raw OpenAPI 3.1 spec, with `servers` rewritten
//                                  to the request's host so tooling targets this
//                                  exact deployment.
//
// Both behind isLoggedIn: the spec lists every RPC surface including admin
// methods, so we don't expose it to unauthenticated scanners. Self-hosted
// operators wanting public docs can drop the middleware in their fork.

import * as fs from 'node:fs';
import * as path from 'node:path';
import express from 'express';
import log4js from 'log4js';
import {configRc, tuning} from '../../../config';
import {httpRouteLimit} from '../rateLimit';
import {isLoggedInOrRedirect} from '../utils/authMiddleware';

const docsRateLimit = httpRouteLimit({
    name: 'api-docs',
    capacityPerMin: tuning.http.rateLimitApiDocsPerMin
});

const logger = log4js.getLogger('web');
const router = express.Router();

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const HTML_PATH = path.join(REPO_ROOT, 'docs/generated/api.html');
const SPEC_PATH = path.join(REPO_ROOT, 'docs/generated/api.openapi.json');
const EMBEDDED_APPS_PATH = path.join(
    REPO_ROOT,
    'docs/generated/embedded-apps-api.json'
);

interface EmbeddedAppDoc {
    feature: 'grafana' | 'node-red';
    [extra: string]: unknown;
}

// Only document the add-on APIs the running deployment actually serves —
// the /grafana and /node-red proxy routes are mounted under the same flags.
function enabledEmbeddedFeatures(): Set<string> {
    const on = new Set<string>();
    if (configRc.graphs?.grafana) on.add('grafana');
    if (tuning.nodeRed.enabled) on.add('node-red');
    return on;
}

interface OpenApiSpec {
    servers?: Array<{url: string; description?: string}>;
    [extra: string]: unknown;
}

function buildServersForRequest(
    req: express.Request
): Array<{url: string; description: string}> {
    const host = req.get('host') ?? 'localhost';
    const wsScheme = req.secure ? 'wss' : 'ws';
    return [
        {
            url: `${wsScheme}://${host}/`,
            description: `This deployment (${host})`
        }
    ];
}

// Reload only on file mtime change — spec is multi-MB, no point re-parsing.
let specCache: {spec: OpenApiSpec; mtimeMs: number} | null = null;

function loadSpec(): OpenApiSpec | null {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(SPEC_PATH);
    } catch {
        return null;
    }
    if (specCache && specCache.mtimeMs === stat.mtimeMs) return specCache.spec;
    try {
        const spec = JSON.parse(
            fs.readFileSync(SPEC_PATH, 'utf8')
        ) as OpenApiSpec;
        specCache = {spec, mtimeMs: stat.mtimeMs};
        return spec;
    } catch (err) {
        logger.error('Failed to parse api.openapi.json: %s', err);
        return null;
    }
}

router.get('/openapi.json', isLoggedInOrRedirect, docsRateLimit, (req, res) => {
    const spec = loadSpec();
    if (!spec) {
        res.status(404).json({error: 'API spec not generated yet'});
        return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    // Spread so the cached object isn't mutated per request.
    res.json({...spec, servers: buildServersForRequest(req)});
});

// Scalar bundle is inline-script; needs CSP relaxed for this route only.
const SCALAR_CSP =
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "frame-ancestors 'self'";

router.get('/', isLoggedInOrRedirect, docsRateLimit, (_req, res) => {
    if (!fs.existsSync(HTML_PATH)) {
        res.status(404).json({error: 'API docs not built yet'});
        return;
    }
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('Content-Security-Policy', SCALAR_CSP);
    res.sendFile(HTML_PATH);
});

// Node-RED / Grafana proxy APIs — only the add-ons this deployment serves.
router.get(
    '/embedded-apps',
    isLoggedInOrRedirect,
    docsRateLimit,
    (_req, res) => {
        let apps: EmbeddedAppDoc[];
        try {
            const parsed = JSON.parse(
                fs.readFileSync(EMBEDDED_APPS_PATH, 'utf8')
            );
            apps = Array.isArray(parsed) ? parsed : [];
        } catch {
            res.status(404).json({error: 'Embedded-apps docs not built yet'});
            return;
        }
        const on = enabledEmbeddedFeatures();
        res.json(apps.filter((a) => on.has(a.feature)));
    }
);

export default router;
