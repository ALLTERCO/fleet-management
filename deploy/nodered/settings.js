const crypto = require('node:crypto');

const proxySecret =
    process.env.NODE_RED_PROXY_SECRET || process.env.FM_NODE_RED_PROXY_SECRET || '';
// One Node-RED serves one organization; the FM proxy stamps the caller's org.
const pinnedOrgId = (process.env.FM_NODE_RED_ORG_ID || '').trim();
const PROXY_SECRET_HEADER = 'x-fm-node-red-proxy-secret';
const ORG_HEADER = 'x-fm-organization-id';
// FM signs the acting user per request; Node-RED's audit log names that user.
const USER_TOKEN_HEADER = 'x-fm-node-red-user';
const USER_TOKEN_MAX_LENGTH = 4096;
// FM forwards outside webhooks here; the hook node checks its own secret.
const WEBHOOK_PATH_PREFIX = '/fm-hooks/';
const FUNCTION_TIMEOUT_SECONDS =
    Number.parseInt(process.env.NODE_RED_FUNCTION_TIMEOUT_SECONDS || '', 10) || 30;
const EDITOR_TITLE = 'Fleet Manager — Automations';

function sameSecret(given, expected) {
    const a = Buffer.from(String(given || ''));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function userTokenSignature(payload) {
    return crypto.createHmac('sha256', proxySecret).update(payload).digest();
}

function userTokenPayload(encoded) {
    try {
        return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

function signatureMatches(payload, encodedSignature) {
    const given = Buffer.from(encodedSignature, 'base64url');
    const expected = userTokenSignature(payload);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Token: base64url(JSON {u, n?, exp}) "." base64url(HMAC-SHA256(proxy secret)).
function verifiedEditorUser(token) {
    if (!proxySecret || typeof token !== 'string' || token.length > USER_TOKEN_MAX_LENGTH) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    if (!signatureMatches(parts[0], parts[1])) return null;
    const claims = userTokenPayload(parts[0]);
    if (!claims || typeof claims.u !== 'string' || !claims.u) return null;
    if (typeof claims.exp !== 'number' || claims.exp <= Date.now()) return null;
    // Every editor user already holds automation:update in FM; there is no read-only mode.
    return {username: claims.u, permissions: '*'};
}

// FM server-side calls carry no org header; only a different org is refused.
function isForeignOrganization(req) {
    if (!pinnedOrgId) return false;
    const org = req.get(ORG_HEADER);
    return org !== undefined && org !== pinnedOrgId;
}

function isWebhookRequest(req) {
    return req.path.startsWith(WEBHOOK_PATH_PREFIX);
}

function rejectionFor(req, {checkOrganization}) {
    if (!proxySecret) return {status: 503, error: 'Node-RED proxy secret is not configured'};
    if (!sameSecret(req.get(PROXY_SECRET_HEADER), proxySecret)) {
        return {status: 403, error: 'Fleet Manager proxy required'};
    }
    if (checkOrganization && isForeignOrganization(req)) {
        return {status: 403, error: 'Node-RED belongs to another organization'};
    }
    return undefined;
}

function guard(checkOrganizationFor) {
    return function requireFleetManagerProxy(req, res, next) {
        const rejection = rejectionFor(req, {checkOrganization: checkOrganizationFor(req)});
        if (rejection) {
            res.status(rejection.status).json({error: rejection.error});
            return;
        }
        next();
    };
}

const adminGuard = guard(() => true);
const nodeGuard = guard((req) => !isWebhookRequest(req));

module.exports = {
    uiPort: process.env.PORT || 1880,
    // Fixed name; the default is hostname-based and resets flows on each recreate.
    flowFile: 'flows.json',
    httpAdminRoot: process.env.NODE_RED_HTTP_ADMIN_ROOT || '/node-red/red',
    httpNodeRoot: process.env.NODE_RED_HTTP_NODE_ROOT || '/node-red/api',
    credentialSecret:
        process.env.NODE_RED_CREDENTIAL_SECRET ||
        process.env.FM_NODE_RED_CREDENTIAL_SECRET,
    httpAdminMiddleware: adminGuard,
    // No login page: FM has already signed the user in and vouches for them.
    adminAuth: {
        tokens: (token) => Promise.resolve(verifiedEditorUser(token)),
        tokenHeader: USER_TOKEN_HEADER
    },
    // httpNodeAuth guards every route under httpNodeRoot. httpNodeMiddleware
    // only reaches core http-in routes, not routes added by custom nodes.
    httpNodeAuth: nodeGuard,
    // Default store on disk under /data/context so context survives restarts.
    contextStorage: {
        default: {module: 'localfilesystem'},
        memory: {module: 'memory'}
    },
    functionExternalModules: false,
    functionTimeout: FUNCTION_TIMEOUT_SECONDS,
    globalFunctionTimeout: FUNCTION_TIMEOUT_SECONDS,
    externalModules: {
        autoInstall: false,
        palette: {
            allowInstall: false,
            allowUpdate: false,
            allowUpload: false
        },
        modules: {
            allowInstall: false
        }
    },
    // No calls home: deployments may be offline.
    telemetry: {
        enabled: false,
        updateNotification: false
    },
    editorTheme: {
        page: {title: EDITOR_TITLE},
        header: {title: EDITOR_TITLE},
        // Fleet Manager shows the user and owns logout; Node-RED's would only sign back in.
        userMenu: false,
        projects: {enabled: false}
    },
    logging: {
        console: {
            level: process.env.NODE_RED_LOG_LEVEL || 'info',
            metrics: false,
            // Editor and admin API actions land in the container log.
            audit: true
        }
    }
};
