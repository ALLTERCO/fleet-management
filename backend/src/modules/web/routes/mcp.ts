// MCP over HTTP so agents can connect to a running instance.
//
//   POST /mcp  -> one JSON-RPC message per request (stateless), answered
//                 with a JSON-RPC response; notifications get 202.
//   GET  /mcp  -> 405; this server has no event stream to offer.
//
// Docs/lookup tools always available; live-read tools run real RPCs as
// the authenticated user (permission decorators enforce access). Behind
// isLoggedIn (401 JSON, no redirect: callers are agents, not browsers).

import express from 'express';
import {tuning} from '../../../config';
import {envStr} from '../../../config/envReader';
import type {user_t} from '../../../types';
import {logMcpTool} from '../../AuditLogger';
import {
    errorResponse,
    handleRequest,
    isAuditableTool,
    isWriteTool,
    type McpMessage
} from '../../ai/fleetDocsMcp';
import {runRpcAsUser} from '../../ai/liveRpcExecutor';
import {McpError} from '../../ai/mcpErrors';
import {
    attributedMcpClient,
    clientAllowed,
    consumeRateBudget,
    hasMcpAudience,
    type McpLevel,
    mcpLevelFromAudience
} from '../../ai/mcpGovernance';
import {getEffectiveMcpPolicy} from '../../ai/mcpTenantPolicy';
import {httpRouteLimit} from '../rateLimit';
import {isLoggedIn, userIsAdmin} from '../utils/authMiddleware';

const mcpRateLimit = httpRouteLimit({
    name: 'mcp',
    capacityPerMin: tuning.http.rateLimitApiDocsPerMin
});

export const MCP_HTTP_PROTOCOL_VERSIONS = new Set([
    '2025-03-26',
    '2025-06-18',
    '2025-11-25'
]);

function normalizedOrigin(value: string): string | null {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

export function mcpOriginAllowed(
    origin: string | undefined,
    publicBaseUrl: string,
    requestOrigin: string
): boolean {
    if (!origin) return true;
    const expected = normalizedOrigin(publicBaseUrl || requestOrigin);
    return expected !== null && normalizedOrigin(origin) === expected;
}

export function validateMcpTransport(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
): void {
    const host = req.get('host') ?? '';
    const requestOrigin = `${req.protocol}://${host}`;
    if (
        !mcpOriginAllowed(
            req.get('origin') ?? undefined,
            envStr('FM_PUBLIC_BASE_URL', ''),
            requestOrigin
        )
    ) {
        res.status(403).json({error: 'MCP Origin is not allowed'});
        return;
    }
    const version = req.get('mcp-protocol-version');
    if (version && !MCP_HTTP_PROTOCOL_VERSIONS.has(version)) {
        res.status(400).json({error: 'Unsupported MCP-Protocol-Version'});
        return;
    }
    next();
}

// Who may use MCP: an admin (a full admin session or key), OR a scoped key
// explicitly scoped for MCP (audience carries an `mcp` scope). A non-admin
// unscoped token is refused. Pure decision; isAdmin injected for testability.
export function mcpPrincipalAllowed(
    user: user_t | undefined,
    isAdmin: boolean
): boolean {
    if (!user) return false;
    if (hasMcpAudience(user.credentialAudience)) {
        return mcpLevelFromAudience(user.credentialAudience) !== null;
    }
    if (isAdmin) return true;
    return false;
}

// The effective level comes from the key: a scoped key carries its own level;
// an admin with no mcp scope gets full. RBAC still gates what actually
// succeeds, so the level never grants more than the user's own permissions.
export function effectiveMcpLevel(user: user_t | undefined): McpLevel {
    const scoped = mcpLevelFromAudience(user?.credentialAudience);
    if (scoped) return scoped;
    return hasMcpAudience(user?.credentialAudience) ? 'read' : 'full';
}

export function requireMcpAccess(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (!mcpPrincipalAllowed(req.user, userIsAdmin(req.user))) {
        res.status(403).json({
            error: 'MCP access requires an admin or a key scoped for MCP'
        });
        return;
    }
    next();
}

// Every RPC runs as this user, so the component permission layer decides
// what actually succeeds.
function executorFor(user: user_t | undefined) {
    if (!user) return undefined;
    return (method: string, params: Record<string, unknown>) =>
        runRpcAsUser(user, method, params);
}

// Successful stateful tool calls are audited in the core (with an id);
// here we log denials so refused actions are on the record too. Client
// rejections are audited even though they never reach a tool.
function auditDenial(
    req: express.Request,
    message: McpMessage,
    errorMessage: string,
    clientId?: string
) {
    const tool = String(message.params?.name ?? '');
    const isToolCall = message.method === 'tools/call';
    if (isToolCall && !isAuditableTool(tool) && !clientId) return;
    if (!req.user && !clientId) return;
    void logMcpTool({
        username: req.user?.username,
        organizationId: req.user?.organizationId ?? null,
        credentialId: req.user?.credentialId,
        clientId,
        tool: isToolCall ? tool : (clientId ?? 'mcp'),
        method: String(message.params?.arguments?.method ?? '') || undefined,
        success: false,
        errorMessage
    });
}

// Per-user read/write budget for a stateful tool call, before dispatch.
function enforceToolBudget(req: express.Request, message: McpMessage) {
    if (message.method !== 'tools/call') return;
    const tool = String(message.params?.name ?? '');
    if (!isAuditableTool(tool) || !req.user) return;
    consumeRateBudget(req.user.username, isWriteTool(tool) ? 'write' : 'read');
}

export async function serveMcpPost(
    req: express.Request,
    res: express.Response
) {
    const message = req.body as McpMessage;
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
        // One message per request. Batch arrays are refused so every call
        // carries one auth+budget decision (2025-06-18 dropped batching too).
        res.status(400).json(
            errorResponse(
                null,
                new Error(
                    'Expected one JSON-RPC message; batch arrays are not supported'
                )
            )
        );
        return;
    }
    const claimedClientId = req.get('x-mcp-client') ?? undefined;
    const clientId = attributedMcpClient(
        claimedClientId,
        req.user?.credentialAudience
    );
    if (!clientAllowed(claimedClientId, req.user?.credentialAudience)) {
        const err = new McpError(
            'client_not_allowed',
            'MCP client is not allowed or is not bound to this key',
            {retryable: false}
        );
        auditDenial(req, message, err.message, clientId);
        res.status(403).json(errorResponse(message.id ?? null, err));
        return;
    }
    // Per-org on/off switch for an authenticated principal. A null org fails
    // closed — getEffectiveMcpPolicy treats no-org as disabled, so a signed-in
    // principal without an organization can never reach a tool. A request with
    // no user at all is gated upstream by isLoggedIn and can only see docs tools
    // here, so it needs no per-org decision. The capability LEVEL comes from the
    // key (or full for an admin), not the org.
    let level: McpLevel | undefined;
    if (req.user) {
        const policy = await getEffectiveMcpPolicy(req.user.organizationId);
        if (!policy.enabled) {
            const err = new McpError(
                'mcp_disabled',
                'MCP is disabled for this organization',
                {retryable: false}
            );
            auditDenial(req, message, err.message, clientId);
            res.status(403).json(errorResponse(message.id ?? null, err));
            return;
        }
        level = effectiveMcpLevel(req.user);
    }
    // Per-user rate budget is a governance gate like the others: a rejection is
    // a 403 with the client attributed on the denial, not a dispatched call.
    try {
        enforceToolBudget(req, message);
    } catch (err) {
        if (!(err instanceof McpError)) throw err;
        auditDenial(req, message, err.message, clientId);
        res.status(403).json(errorResponse(message.id ?? null, err));
        return;
    }
    try {
        const reply = await handleRequest(message, {
            execute: executorFor(req.user),
            level,
            caller: req.user
                ? {
                      username: req.user.username,
                      organizationId: req.user.organizationId ?? null
                  }
                : undefined,
            audit: req.user
                ? (entry) =>
                      logMcpTool({
                          username: req.user?.username,
                          organizationId: req.user?.organizationId ?? null,
                          credentialId: req.user?.credentialId,
                          clientId,
                          ...entry
                      })
                : undefined
        });
        if (!reply) {
            res.status(202).end();
            return;
        }
        res.json(reply);
    } catch (error) {
        auditDenial(
            req,
            message,
            error instanceof Error ? error.message : String(error)
        );
        res.json(errorResponse(message.id ?? null, error));
    }
}

const router = express.Router();
router.use(validateMcpTransport);
router.post(
    '/',
    isLoggedIn,
    requireMcpAccess,
    mcpRateLimit,
    express.json(),
    serveMcpPost
);
router.get('/', isLoggedIn, mcpRateLimit, (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({error: 'POST one JSON-RPC message to this URL'});
});

export default router;
