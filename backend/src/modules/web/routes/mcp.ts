// MCP over HTTP so agents can connect to a running instance.
//
//   POST /mcp  -> one JSON-RPC message per request, answered with a JSON-RPC
//                 response (or an SSE stream); notifications get 202.
//   GET  /mcp  -> authenticated SSE for a durable subscription session.
//
// Two eras share this endpoint and one tool core. A request naming 2026-07-28
// in its _meta is served statelessly: no session, approvals come back as an
// input_required result, and change notifications flow on the stream of a
// subscriptions/listen request. Every other request is served by the session
// revisions (2025-11-25 and earlier) exactly as before.
//
// Docs/lookup tools always available; live-read tools run real RPCs as
// the authenticated user (permission decorators enforce access). Behind
// requireMcpBearer (401 with an OAuth challenge: callers are agents).

import {createHash, randomUUID} from 'node:crypto';
import express from 'express';
import log4js from 'log4js';
import {tuning} from '../../../config';
import {fmPublicBaseUrl} from '../../../config/zitadel';
import type {user_t} from '../../../types';
import {logMcpTool} from '../../AuditLogger';
import type {OperateElicit} from '../../ai/agentOperate';
import {operateRead} from '../../ai/agentOperate';
import {readJournalPage} from '../../ai/eventJournal';
import {
    classifyMcpMessage,
    errorResponse,
    handleRequest,
    isAuditableTool,
    isKnownTool,
    type McpMessage,
    type McpMessageKind,
    protocolEraOf,
    readRequestProtocol,
    requestIdOf,
    STREAMABLE_HTTP_PROTOCOL_VERSIONS,
    TOOL_ERROR_META,
    toolBudgetKind
} from '../../ai/fleetDocsMcp';
import {runRpcAsUser} from '../../ai/liveRpcExecutor';
import {
    readTraceContext,
    type TraceContext,
    withCallContext
} from '../../ai/mcpCorrelation';
import {
    buildElicitationRequest,
    readElicitationAnswer
} from '../../ai/mcpElicit';
import {McpError} from '../../ai/mcpErrors';
import {
    type EventFollowEnd,
    type EventReader,
    followEventSubscriptions
} from '../../ai/mcpEventFollow';
import {
    createMcpEventResources,
    isMcpEventUri,
    type McpEventResourcePort,
    parseMcpEventUri
} from '../../ai/mcpEventResources';
import {
    attributedMcpClient,
    clientAllowed,
    consumeRateBudget,
    type McpLevel,
    mcpIssuedCredentialLevel
} from '../../ai/mcpGovernance';
import {
    type ApprovalCall,
    approvalElicitor,
    readApprovalRetry,
    retryCarriesIssuedState
} from '../../ai/mcpInputRequests';
import {
    assertMirroredHeaders,
    declaresFormElicitation,
    META_SUBSCRIPTION_ID,
    type ProtocolEra,
    type RequestProtocol,
    unsupportedProtocolVersion
} from '../../ai/mcpProtocolEra';
import {type McpRoleSelection, mcpRoleFromAudience} from '../../ai/mcpRoles';
import {
    type ElicitationOwner,
    elicitationBroker,
    type TrackedCall
} from '../../ai/mcpSessions';
import {TASK_METHODS} from '../../ai/mcpTasks';
import {getEffectiveMcpPolicy} from '../../ai/mcpTenantPolicy';
import {
    canExecuteOperation,
    findOperationRecoveryJob,
    finishOperationExecution,
    getOperation,
    getOperationRecovery,
    linkOperationRecoveryJob,
    recordDefinitiveOperationFailure,
    recordOperationOutcomeUnknown,
    recordOperationSuccess,
    registerOperationRecovery,
    reserveOperation,
    startOperation
} from '../../ai/operationStore';
import {
    type McpSpan,
    recordMcpDenial,
    recordMcpToolCall,
    startMcpSpan
} from '../../Observability';
import {MCP_EVENT_STREAM_LIMITS} from '../../redis/mcpEventStreams';
import type {McpStreamPrincipal} from '../../redis/ports';
import {mcpEventStreams} from '../../redis/services';
import {getUserFromToken, UNAUTHORIZED_USER} from '../../user';
import {httpRouteLimit} from '../rateLimit';
import {mcpProtectedResource} from './mcpResourceMetadata';

const logger = log4js.getLogger('mcp');
let activeEventStreams = 0;
// Each open event stream and how to end it when the server stops.
const eventStreamClosers = new Map<express.Response, () => void>();
const eventStreamDrains = new Set<Promise<void>>();
const eventStreamRouteWork = new Set<Promise<void>>();
// Newest stream per session wins; a reconnect ends the one it replaces here.
const sessionReaders = new Map<string, express.Response>();
type EventResourceFactory = (
    caller: Parameters<typeof createMcpEventResources>[0],
    authorizedRead: Parameters<typeof createMcpEventResources>[1]
) => ReturnType<typeof createMcpEventResources>;
const defaultEventResourceFactory: EventResourceFactory = (
    caller,
    authorizedRead
) =>
    createMcpEventResources(caller, authorizedRead, {
        readPage: readJournalPage
    });
let eventResourceFactory = defaultEventResourceFactory;
let refreshMcpUser = getUserFromToken;
let runRpc = runRpcAsUser;

export function setMcpEventResourceFactoryForTest(
    factory: EventResourceFactory
): void {
    eventResourceFactory = factory;
}

export function resetMcpEventResourceFactoryForTest(): void {
    eventResourceFactory = defaultEventResourceFactory;
    refreshMcpUser = getUserFromToken;
}

export function setMcpUserRefreshForTest(
    refresh: typeof getUserFromToken
): void {
    refreshMcpUser = refresh;
}

/** Test seam: the RPC every tool runs; undefined restores the real one. */
export function setMcpRpcExecutorForTest(run?: typeof runRpcAsUser): void {
    runRpc = run ?? runRpcAsUser;
}

export async function drainMcpEventStreams(): Promise<void> {
    for (const [response, close] of eventStreamClosers) {
        if (!response.writableEnded) close();
    }
    eventStreamClosers.clear();
    await Promise.allSettled([...eventStreamRouteWork, ...eventStreamDrains]);
}

function endSupersededReader(sessionId: string): void {
    const previous = sessionReaders.get(sessionId);
    if (previous && !previous.writableEnded) previous.end();
}

const mcpRateLimit = httpRouteLimit({
    name: 'mcp',
    capacityPerMin: tuning.http.rateLimitApiDocsPerMin
});

export const MCP_HTTP_PROTOCOL_VERSIONS = new Set(
    STREAMABLE_HTTP_PROTOCOL_VERSIONS
);

function normalizedOrigin(value: string): string | null {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

/**
 * DNS-rebinding guard. A browser always sends Origin; MCP clients that are not
 * browsers send none and still need a key. A present Origin must match the
 * configured public URL. The Host header is never the reference: a rebound
 * name arrives with a matching Host, so comparing to it accepts the attack.
 */
export function mcpOriginAllowed(
    origin: string | undefined,
    publicBaseUrl: string
): boolean {
    if (!origin) return true;
    const expected = normalizedOrigin(publicBaseUrl);
    return expected !== null && normalizedOrigin(origin) === expected;
}

export function validateMcpTransport(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
): void {
    if (
        !mcpOriginAllowed(
            req.get('origin') ?? undefined,
            fmPublicBaseUrl() ?? ''
        )
    ) {
        res.status(403).json(
            errorResponse(
                undefined,
                new McpError('permission_denied', 'MCP Origin is not allowed')
            )
        );
        return;
    }
    const version = req.get('mcp-protocol-version');
    if (version && !MCP_HTTP_PROTOCOL_VERSIONS.has(version)) {
        res.status(400).json(
            errorResponse(undefined, unsupportedVersionHeader(version))
        );
        return;
    }
    next();
}

// A revision we know but do not serve over HTTP keeps the session-era answer.
// One we have never heard of gets 2026-07-28's error, which a client speaking
// both eras reads as "retry with a listed version", not "fall back".
function unsupportedVersionHeader(version: string): McpError {
    if (protocolEraOf(version)) {
        return new McpError(
            'invalid_request',
            'Unsupported MCP-Protocol-Version'
        );
    }
    return unsupportedProtocolVersion(
        version,
        STREAMABLE_HTTP_PROTOCOL_VERSIONS
    );
}

function namesStatelessRevision(version: string | undefined): boolean {
    return version !== undefined && protocolEraOf(version) === 'stateless';
}

/**
 * 2026-07-28 has neither the GET stream nor a session to DELETE; a client
 * on it listens with subscriptions/listen. Session clients are unaffected.
 */
function refuseStatelessStreamMethods(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
): void {
    if (!namesStatelessRevision(req.get('mcp-protocol-version'))) {
        next();
        return;
    }
    res.setHeader('Allow', 'POST');
    res.status(405).json(
        errorResponse(
            undefined,
            new McpError(
                'invalid_request',
                'This revision has no GET stream or session; POST subscriptions/listen instead'
            )
        )
    );
}

// Only a credential issued for this server may use it (MCP authorization,
// token handling); the owner's role never stands in for the audience.
export function mcpPrincipalAllowed(user: user_t | undefined): boolean {
    return mcpIssuedCredentialLevel(user) !== null;
}

/**
 * Which slice this key works in. Same place the level comes from, because both
 * are properties of the credential and neither may change mid-session.
 */
export function effectiveMcpRole(user: user_t | undefined): McpRoleSelection {
    return mcpRoleFromAudience(user?.credentialAudience);
}

// A browser login keeps one identity per person and MCP app across token
// refreshes, so its streams, prompts and receipts survive a new access token.
export function mcpCredentialIdentity(
    user:
        | Pick<user_t, 'credentialId' | 'credentialClientId' | 'userId'>
        | undefined,
    authenticatedToken: string | undefined
): string | undefined {
    if (!user) return undefined;
    if (user.credentialId) return user.credentialId;
    if (!user.userId) return undefined;
    if (user.credentialClientId) {
        return `oauth-client:${user.credentialClientId}:${user.userId}`;
    }
    if (!authenticatedToken) return undefined;
    return `session-sha256:${createHash('sha256').update(authenticatedToken).digest('hex')}`;
}

const BEARER_HEADER = /^Bearer\s+\S+$/i;

/**
 * /mcp takes its token from the Authorization header only (no cookie) and
 * answers the way MCP clients discover sign-in (RFC 6750, RFC 9728): no token
 * gets a bare challenge naming the resource metadata; a token Fleet does not
 * accept gets invalid_token; an identity provider that could not answer gets
 * 503, never a prompt to sign in again.
 */
export function requireMcpBearer(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
): void {
    if (!BEARER_HEADER.test(req.get('authorization') ?? '')) {
        challengeForToken(res);
        return;
    }
    if (req.authFailure === 'unavailable') {
        answerIdentityUnavailable(res);
        return;
    }
    if (!req.user || req.user.username === UNAUTHORIZED_USER.username) {
        refuseInvalidToken(res, 'The access token is not valid here');
        return;
    }
    next();
}

/** The WWW-Authenticate value for /mcp, with an error only when one applies. */
export function mcpBearerChallenge(errorDescription?: string): string {
    const resource = mcpProtectedResource();
    const parts = errorDescription
        ? ['error="invalid_token"', `error_description="${errorDescription}"`]
        : [];
    if (resource) {
        parts.push(
            `resource_metadata="${resource.metadataUrl}"`,
            `scope="${resource.scopes.join(' ')}"`
        );
    }
    return parts.length > 0 ? `Bearer ${parts.join(', ')}` : 'Bearer';
}

function challengeForToken(res: express.Response): void {
    res.setHeader('WWW-Authenticate', mcpBearerChallenge());
    res.status(401).json(
        errorResponse(
            undefined,
            new McpError(
                'not_authenticated',
                'Sign in to use this MCP server',
                {
                    retryable: false
                }
            )
        )
    );
}

function refuseInvalidToken(res: express.Response, description: string): void {
    res.setHeader('WWW-Authenticate', mcpBearerChallenge(description));
    res.status(401).json(
        errorResponse(
            undefined,
            new McpError('not_authenticated', description, {retryable: false})
        )
    );
}

function answerIdentityUnavailable(res: express.Response): void {
    res.setHeader('Retry-After', String(tuning.mcp.authRetryAfterSec));
    res.status(503).json(
        errorResponse(
            undefined,
            new McpError(
                'operation_unavailable',
                'The sign-in service could not check the token; try again',
                {retryable: true}
            )
        )
    );
}

export function requireMcpAccess(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (!mcpPrincipalAllowed(req.user)) {
        // A valid but non-MCP credential probing this endpoint produced no
        // audit row at all, so a stolen key being tried against /mcp was
        // invisible. requireMcpBearer runs before this, so req.user is populated
        // and the attempt is attributable. Placed here rather than in the
        // transport check, which runs before the rate limiter: an
        // unauthenticated flood there would evict real events from the
        // bounded audit queue.
        logMcpTool({
            username: req.user?.username,
            organizationId: req.user?.organizationId ?? null,
            credentialId: mcpCredentialIdentity(req.user, req.token),
            tool: 'mcp_access',
            success: false,
            errorMessage: 'credential is not issued for MCP'
        });
        refuseNonMcpCredential(res);
        return;
    }
    next();
}

// A token issued for another audience is an invalid token here, which OAuth
// answers with 401 and an invalid_token challenge (RFC 6750 section 3.1).
function refuseNonMcpCredential(res: express.Response): void {
    res.setHeader(
        'WWW-Authenticate',
        mcpBearerChallenge('The credential is not issued for this MCP server')
    );
    res.status(401).json(
        errorResponse(
            undefined,
            new McpError(
                'not_authenticated',
                'Use a key created for MCP; session and general API tokens are not accepted here',
                {retryable: false}
            )
        )
    );
}

// Every RPC runs as this user, so the component permission layer decides
// what actually succeeds.
function userExecutor(user: user_t) {
    return (method: string, params: Record<string, unknown>) =>
        runRpc(user, method, params);
}

function executorFor(user: user_t | undefined) {
    return user ? userExecutor(user) : undefined;
}

function tokenExpiresAtMs(token: string | undefined): number | undefined {
    if (!token) return undefined;
    try {
        const payload = JSON.parse(
            Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')
        ) as {exp?: unknown};
        return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
    } catch {
        return undefined;
    }
}

function principalFor(
    user: user_t | undefined,
    token: string | undefined
): McpStreamPrincipal | undefined {
    const credentialId = mcpCredentialIdentity(user, token);
    if (!user || !credentialId) return undefined;
    return {
        username: user.username,
        userId: user.userId,
        organizationId: user.organizationId ?? null,
        credentialId,
        credentialExpiresAtMs:
            user.credentialExpiresAtMs ?? tokenExpiresAtMs(token)
    };
}

function streamPrincipal(req: express.Request): McpStreamPrincipal | undefined {
    return principalFor(req.user, req.token);
}

// The principal a tool call runs as, which also owns its prompts.
function callerFor(user: user_t, token: string | undefined): ElicitationOwner {
    return {
        username: user.username,
        userId: user.userId,
        credentialId: mcpCredentialIdentity(user, token),
        organizationId: user.organizationId ?? null
    };
}

function principalsMatch(
    left: McpStreamPrincipal,
    right: McpStreamPrincipal
): boolean {
    return (
        left.username === right.username &&
        left.userId === right.userId &&
        left.organizationId === right.organizationId &&
        left.credentialId === right.credentialId
    );
}

// The governed event reads for this credential, at this level, right now.
function eventReaderFor(
    user: user_t,
    principal: McpStreamPrincipal,
    level: McpLevel
) {
    const execute = userExecutor(user);
    const caller = {
        username: user.username,
        userId: user.userId,
        credentialId: principal.credentialId,
        organizationId: principal.organizationId
    };
    return eventResourceFactory(caller, (request) =>
        operateRead(
            {
                execute,
                caller,
                level,
                role: effectiveMcpRole(user),
                audit: async () => null
            },
            request
        )
    );
}

// Where a subscription starts: after the cursor the URI carries, so a client
// resuming from its last read misses nothing, else after the first page.
async function baselineCursor(
    reader: Pick<EventReader, 'poll'>,
    uri: string
): Promise<string> {
    return parseMcpEventUri(uri).cursor ?? (await reader.poll(uri)).cursor;
}

function eventResourcesFor(
    req: express.Request,
    level: McpLevel,
    sessionId: string
): McpEventResourcePort | undefined {
    const principal = streamPrincipal(req);
    if (!principal || !req.user) return undefined;
    const helper = eventReaderFor(req.user, principal, level);
    return {
        read: helper.read,
        async subscribe(uri: string) {
            const parsed = parseMcpEventUri(uri);
            if (uri !== parsed.canonicalUri) {
                throw new McpError(
                    'invalid_params',
                    `Subscribe to the canonical URI ${parsed.canonicalUri}`
                );
            }
            await helper.validate(uri);
            await mcpEventStreams.subscribe(sessionId, principal, {
                uri,
                cursor: await baselineCursor(helper, uri)
            });
        },
        async unsubscribe(uri: string) {
            await mcpEventStreams.unsubscribe(sessionId, principal, uri);
        }
    };
}

// A stateless request reads event history with no session; built per read,
// so a credential that cannot read events fails only that read.
function statelessEventResources(
    req: express.Request,
    level: McpLevel
): McpEventResourcePort | undefined {
    const principal = streamPrincipal(req);
    const user = req.user;
    if (!principal || !user) return undefined;
    return {
        read: (uri) => eventReaderFor(user, principal, level).read(uri)
    };
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
        credentialId: mcpCredentialIdentity(req.user, req.token),
        clientId,
        tool: isToolCall ? tool : (clientId ?? 'mcp'),
        method: String(message.params?.arguments?.method ?? '') || undefined,
        success: false,
        errorMessage
    });
}

// Requests that read the event history, which is tenant data like fm_read.
const EVENT_READ_METHODS = new Set(['resources/read', 'resources/subscribe']);

type BudgetKind = 'read' | 'write';

/** Which per-user budget a request spends; undefined for docs and protocol. */
function requestBudgetKind(message: McpMessage): BudgetKind | undefined {
    if (message.method === 'tools/call') {
        const tool = String(message.params?.name ?? '');
        return isAuditableTool(tool)
            ? toolBudgetKind(tool, message.params?.arguments)
            : undefined;
    }
    // A listen stream and a task poll each read tenant state once per request.
    if (
        message.method === 'subscriptions/listen' ||
        TASK_METHODS.has(message.method ?? '')
    )
        return 'read';
    return EVENT_READ_METHODS.has(message.method ?? '') &&
        isMcpEventUri(String(message.params?.uri ?? ''))
        ? 'read'
        : undefined;
}

/**
 * A stateless retry answering an approval spends a read, not the write again:
 * the attempt that asked already spent the write unit, and the state it
 * earned is single use, so each write is billed once.
 */
function statelessBudgetKind(
    req: express.Request,
    message: McpMessage,
    protocol: Extract<RequestProtocol, {era: 'stateless'}>
): BudgetKind | undefined {
    const kind = requestBudgetKind(message);
    if (kind !== 'write' || !req.user) return kind;
    return retryCarriesIssuedState(
        approvalCallOf(req.user, req.token, message, protocol),
        message.params?.requestState
    )
        ? 'read'
        : kind;
}

// Per-user read/write budget for a request that touches tenant data.
async function enforceRequestBudget(
    req: express.Request,
    kind: BudgetKind | undefined
) {
    if (!kind || !req.user) return;
    // The stable id, so no email address ends up in a shared store key.
    await consumeRateBudget(req.user.userId ?? req.user.username, kind);
}

// Routes a client's elicitation answer to the tool call waiting on it, on
// whichever instance holds that call. The waiting call owns the reply, so this
// POST only acknowledges.
async function serveElicitationAnswer(
    req: express.Request,
    res: express.Response,
    message: McpMessage
): Promise<void> {
    if (!req.user) {
        res.status(401).json({error: 'Unauthorized'});
        return;
    }
    let settled: boolean;
    try {
        settled = await elicitationBroker().settle(
            req.get('mcp-session-id') ?? undefined,
            callerFor(req.user, req.token),
            String(message.id),
            message.result ?? {action: 'cancel'}
        );
    } catch (error) {
        logger.warn(
            'MCP elicitation answer not routed: %s',
            error instanceof Error ? error.message : String(error)
        );
        res.status(503).json(
            errorResponse(
                message.id ?? null,
                new McpError(
                    'operation_unavailable',
                    'The answer could not be delivered; send it again',
                    {retryable: true}
                )
            )
        );
        return;
    }
    // A late or unknown answer cannot be accepted (400). A 404 would tell the
    // client its session ended, which it has not.
    if (!settled) {
        res.status(400).json(
            errorResponse(
                undefined,
                new McpError(
                    'invalid_params',
                    'No elicitation is waiting for this id on this session',
                    {retryable: false}
                )
            )
        );
        return;
    }
    res.status(202).end();
}

// Cancellation is fire and forget: always 202, and an unknown or finished
// request is ignored, as the spec allows.
async function serveCancellation(
    req: express.Request,
    res: express.Response,
    message: McpMessage
): Promise<void> {
    const requestId = message.params?.requestId;
    const sessionId = req.get('mcp-session-id');
    if (
        req.user &&
        sessionId &&
        (typeof requestId === 'string' || typeof requestId === 'number')
    ) {
        const reason =
            typeof message.params?.reason === 'string'
                ? message.params.reason.slice(0, 200)
                : 'no reason given';
        await cancelRunningRequest(sessionId, callerFor(req.user, req.token), {
            requestId,
            reason
        });
    }
    res.status(202).end();
}

async function cancelRunningRequest(
    sessionId: string,
    owner: ElicitationOwner,
    request: {requestId: string | number; reason: string}
): Promise<void> {
    try {
        const stopped = await elicitationBroker().cancelCall(
            sessionId,
            owner,
            request.requestId,
            request.reason
        );
        logger.info(
            'MCP client cancelled request %s (%s): %s',
            JSON.stringify(request.requestId),
            stopped ? 'stopped' : 'not running',
            request.reason
        );
    } catch (error) {
        logger.warn(
            'MCP cancellation not routed: %s',
            error instanceof Error ? error.message : String(error)
        );
    }
}

// The client advertises what it can do at initialize; only a declared
// `elicitation` capability lets the server prompt a human on this connection.
function clientDeclaredElicitation(message: McpMessage): boolean {
    const capabilities = (
        message.params as {capabilities?: Record<string, unknown>} | undefined
    )?.capabilities;
    return (
        typeof capabilities === 'object' &&
        capabilities !== null &&
        'elicitation' in capabilities
    );
}

/**
 * Gives up on a tool call that will not finish.
 *
 * A device that is registered but unresponsive pends for over a minute, and a
 * wide report read paginates without an overall bound. The client then hits
 * its own cutoff, the socket dies, and no JSON-RPC error is ever sent — so the
 * operator sees "MCP is broken" rather than "that device is offline".
 *
 * The timeout does not cancel the work: it stops waiting for it. Reported as
 * non-retryable so an agent does not fire a duplicate write at a call that may
 * still be in flight.
 */
async function withToolDeadline<T>(fn: () => Promise<T>): Promise<T> {
    const ms = tuning.mcp.toolTimeoutSec * 1000;
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            fn(),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new McpError(
                                'timeout',
                                `Tool call exceeded ${tuning.mcp.toolTimeoutSec}s. It may still be running; do not retry a write.`,
                                {retryable: false}
                            )
                        ),
                    ms
                );
                timer.unref?.();
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Tells a waiting client the call is still alive.
 *
 * Without this a slow tool looks identical to a hung one: the client sits on a
 * silent socket until its own cutoff fires. MCP's answer is
 * notifications/progress, which the client asks for by putting a
 * `_meta.progressToken` on the request.
 *
 * Two conditions, both required. The token, because a client that did not ask
 * cannot correlate the notification. And `text/event-stream` in Accept,
 * because sending one means switching this response to SSE — doing that to a
 * JSON-only client breaks the reply it was waiting for.
 */
function startProgress(
    req: express.Request,
    res: express.Response,
    message: McpMessage,
    intervalMs = 5_000
): () => void {
    const token = (
        message.params?._meta as {progressToken?: string | number} | undefined
    )?.progressToken;
    if (token === undefined || !req.accepts('text/event-stream')) {
        return () => {};
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
        if (res.writableEnded || res.destroyed) return;
        if (!res.headersSent) openElicitationStream(res);
        writeSseMessage(res, {
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {
                progressToken: token,
                // No total: the work is not countable, and MCP treats a
                // progress with no total as "still going" rather than
                // pretending to know how far along it is.
                progress: Math.round((Date.now() - startedAt) / 1000),
                message: 'still working'
            }
        });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}

// Hands the operate layer a way to ask the human. The first call flips this
// response to SSE; every call writes one `elicitation/create` and waits for the
// matching answer to arrive on its own POST.
function buildElicitor(
    res: express.Response,
    session: {
        sessionId: string;
        owner: ElicitationOwner;
        protocolVersion: string | undefined;
        signal: AbortSignal | undefined;
    }
): OperateElicit {
    const {sessionId, owner, protocolVersion, signal} = session;
    return async (request) => {
        const requestId = `elicit-${randomUUID()}`;
        if (!res.headersSent) openElicitationStream(res);
        // Registered before it is sent, so the answer cannot outrun its wait.
        const pending = await elicitationBroker().openElicitation(
            sessionId,
            owner,
            requestId
        );
        if (!pending) return readElicitationAnswer({action: 'cancel'});
        // A hung-up client can never answer. Give up at once instead of
        // holding the call open for the whole elicitation timeout.
        const abandon = () =>
            void elicitationBroker().cancel(sessionId, owner, requestId);
        res.once('close', abandon);
        if (res.destroyed) abandon();
        // The call that asked was cancelled: withdraw the prompt as well.
        const withdraw = () => {
            writeSseMessage(res, {
                jsonrpc: '2.0',
                method: 'notifications/cancelled',
                params: {
                    requestId,
                    reason: 'The request that asked was cancelled'
                }
            });
            abandon();
        };
        signal?.addEventListener('abort', withdraw, {once: true});
        if (signal?.aborted) withdraw();
        // The elicitation timeout and the HTTP socket timeout are both minutes
        // on the same idle connection, so raising the former did nothing: the
        // socket killed the wait regardless. A comment frame every 15s is
        // traffic, which resets Node's idle timer. Safe to write because the
        // stream sets Cache-Control: no-transform, so compression skips it and
        // the bytes reach the socket instead of sitting in a buffer.
        const heartbeat = setInterval(() => {
            if (!res.writableEnded) res.write(': keepalive\n\n');
        }, 15_000);
        heartbeat.unref?.();
        try {
            writeSseMessage(
                res,
                buildElicitationRequest(requestId, request.message, {
                    allowRemember: request.allowRemember,
                    protocolVersion
                })
            );
            return readElicitationAnswer(await pending.answer);
        } finally {
            clearInterval(heartbeat);
            res.off('close', abandon);
            signal?.removeEventListener('abort', withdraw);
        }
    };
}

// Streams the pending elicitation to the client and keeps the response open
// until the tool call finishes. Switching to SSE here is safe because nothing
// has been written yet: the JSON path only writes at the very end.
function openElicitationStream(res: express.Response): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
}

function writeSseMessage(res: express.Response, payload: unknown): void {
    // The peer may already be gone; writing to a destroyed socket throws and
    // would surface as a bogus tool failure.
    if (res.writableEnded || res.destroyed) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function createDurableSession(
    req: express.Request
): Promise<string | undefined> {
    try {
        const principal = streamPrincipal(req);
        if (!principal) throw new Error('MCP credential identity unavailable');
        return await mcpEventStreams.createSession(principal);
    } catch (error) {
        logger.warn(
            `MCP durable session not created: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        return undefined;
    }
}

// Records the session so a later request on it can be recognised, and says
// whether this client can be prompted. Undefined when it could not be
// recorded: the client then works without a session.
async function registerSession(
    owner: ElicitationOwner,
    elicitation: boolean,
    durableId: string | undefined
): Promise<string | undefined> {
    try {
        return await elicitationBroker().createSession(
            owner,
            {elicitation},
            durableId
        );
    } catch (error) {
        logger.warn(
            `MCP session not recorded: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        return undefined;
    }
}

// A durable session that could not be recorded is never handed out, so it is
// dropped rather than left to its expiry.
function dropDurableSession(req: express.Request, durableId: string): void {
    const principal = streamPrincipal(req);
    if (!principal) return;
    void mcpEventStreams
        .deleteSession(durableId, principal)
        .catch((error) =>
            logger.warn(
                'MCP durable session cleanup failed: %s',
                error instanceof Error ? error.message : String(error)
            )
        );
}

/**
 * The session for a new client. Every session handed out is recorded, so an
 * ended or expired one is answered 404. A client with neither an event stream
 * nor prompts needs no session at all.
 */
async function openSession(
    req: express.Request,
    message: McpMessage
): Promise<{id: string; durable: boolean} | undefined> {
    if (!req.user) return undefined;
    const durableId = await createDurableSession(req);
    const elicitation = clientDeclaredElicitation(message);
    if (!durableId && !elicitation) return undefined;
    const id = await registerSession(
        callerFor(req.user, req.token),
        elicitation,
        durableId
    );
    if (!id && durableId) dropDurableSession(req, durableId);
    return id ? {id, durable: id === durableId} : undefined;
}

type SessionState = 'live' | 'ended' | 'unknown';

async function sessionState(
    sessionId: string,
    owner: ElicitationOwner
): Promise<SessionState> {
    try {
        return (await elicitationBroker().isLiveSession(sessionId, owner))
            ? 'live'
            : 'ended';
    } catch (error) {
        logger.warn(
            'MCP session not checked: %s',
            error instanceof Error ? error.message : String(error)
        );
        return 'unknown';
    }
}

/**
 * A request naming a session is served only while that session lives. An
 * ended one gets 404, which tells the client to initialize again; a store
 * that cannot answer gets 503, which does not end the session.
 */
async function requireLiveSession(
    req: express.Request,
    res: express.Response,
    id: string | number | undefined
): Promise<boolean> {
    const sessionId = req.get('mcp-session-id');
    if (!sessionId) return true;
    const state = req.user
        ? await sessionState(sessionId, callerFor(req.user, req.token))
        : 'ended';
    if (state === 'live') return true;
    if (state === 'unknown') {
        res.status(503).json(
            errorResponse(
                id,
                new McpError(
                    'operation_unavailable',
                    'The MCP session could not be checked; send it again',
                    {retryable: true}
                )
            )
        );
        return false;
    }
    res.status(404).json(
        errorResponse(
            id,
            new McpError(
                'session_not_found',
                'This MCP session has ended; initialize a new one',
                {retryable: false}
            )
        )
    );
    return false;
}

// What the body is, or a 400 that says why it is not one JSON-RPC message.
function readMessageKind(
    res: express.Response,
    message: McpMessage
): McpMessageKind | undefined {
    try {
        return classifyMcpMessage(message);
    } catch (error) {
        res.status(400).json(errorResponse(requestIdOf(message), error));
        return undefined;
    }
}

/**
 * The governance gates every message passes: the client allow-list, the
 * credential's level, the organization switch and the rate budget. Undefined
 * once a refusal has been sent; otherwise the level, absent with no user.
 */
async function admitMessage(
    req: express.Request,
    res: express.Response,
    message: McpMessage,
    admission: {clientId: string | undefined; budget: BudgetKind | undefined}
): Promise<{level: McpLevel | undefined} | undefined> {
    const {clientId} = admission;
    const refuse = (err: McpError) => {
        recordMcpDenial(err.reason);
        auditDenial(req, message, err.message, clientId);
        res.status(403).json(errorResponse(requestIdOf(message), err));
        return undefined;
    };
    const claimedClientId = req.get('x-mcp-client') ?? undefined;
    if (!clientAllowed(claimedClientId, req.user?.credentialAudience)) {
        return refuse(
            new McpError(
                'client_not_allowed',
                'MCP client is not allowed or is not bound to this key',
                {retryable: false}
            )
        );
    }
    // Per-org on/off switch for an authenticated principal. A null org fails
    // closed — getEffectiveMcpPolicy treats no-org as disabled, so a signed-in
    // principal without an organization can never reach a tool. A request with
    // no user at all is gated upstream by requireMcpBearer and can only see docs
    // tools here, so it needs no per-org decision. The capability LEVEL comes
    // from the MCP key, not the org.
    if (!req.user) return {level: undefined};
    const level = mcpIssuedCredentialLevel(req.user);
    if (!level) {
        refuseNonMcpCredential(res);
        return undefined;
    }
    const policy = await getEffectiveMcpPolicy(req.user.organizationId);
    if (!policy.enabled) {
        return refuse(
            new McpError(
                'mcp_disabled',
                'MCP is disabled for this organization',
                {
                    retryable: false
                }
            )
        );
    }
    // Per-user rate budget is a governance gate like the others: a rejection
    // is a 403 with the client attributed on the denial, not a dispatched call.
    try {
        await enforceRequestBudget(req, admission.budget);
    } catch (err) {
        if (!(err instanceof McpError)) throw err;
        return refuse(err);
    }
    return {level};
}

// Requests that do real work, so a client may want to stop them.
const CANCELLABLE_METHODS = new Set(['tools/call', 'resources/read']);

async function trackCancellable(
    req: express.Request,
    message: McpMessage,
    sessionId: string | undefined
): Promise<TrackedCall | undefined> {
    const id = requestIdOf(message);
    if (
        !req.user ||
        !sessionId ||
        id === undefined ||
        !CANCELLABLE_METHODS.has(message.method ?? '')
    ) {
        return undefined;
    }
    return elicitationBroker().trackCall(
        sessionId,
        callerFor(req.user, req.token),
        id
    );
}

// Stops waiting once the client cancels; the work sees the same signal.
function untilCancelled<T>(
    signal: AbortSignal | undefined,
    work: Promise<T>
): Promise<T> {
    if (!signal) return work;
    return new Promise<T>((resolve, reject) => {
        const onAbort = () =>
            reject(
                new McpError(
                    'cancelled',
                    `Cancelled by the client: ${String(signal.reason)}`,
                    {retryable: false}
                )
            );
        signal.addEventListener('abort', onAbort, {once: true});
        if (signal.aborted) onAbort();
        work.then(resolve, reject).finally(() =>
            signal.removeEventListener('abort', onAbort)
        );
    });
}

function isCancellation(error: unknown): boolean {
    return error instanceof McpError && error.reason === 'cancelled';
}

// A cancelled request gets no JSON-RPC response; its stream just ends.
function endWithoutResponse(res: express.Response): void {
    if (res.writableEnded || res.destroyed) return;
    if (!res.headersSent) openElicitationStream(res);
    res.end();
}

// 2026-07-28 cancels a request by closing its response stream.
function closeSignal(res: express.Response): AbortSignal {
    const controller = new AbortController();
    res.once('close', () => {
        if (!res.writableFinished) {
            controller.abort('the client closed the response stream');
        }
    });
    return controller.signal;
}

export async function serveMcpPost(
    req: express.Request,
    res: express.Response
) {
    const message = req.body as McpMessage;
    const kind = readMessageKind(res, message);
    if (!kind) return;
    if (kind !== 'request') {
        if (namesStatelessRevision(req.get('mcp-protocol-version'))) {
            answerStatelessNonRequest(res, kind);
            return;
        }
        await serveSessionMessage(req, res, message, kind);
        return;
    }
    const protocol = readProtocolOrRefuse(req, res, message);
    if (!protocol) return;
    if (protocol.era === 'stateless') {
        await serveStatelessRequest(req, res, message, protocol);
        return;
    }
    await serveSessionMessage(req, res, message, kind);
}

/**
 * The revision a request speaks, or the 400 it earns: 2026-07-28 requires its
 * _meta fields, and mirrored headers that agree with the body.
 */
function readProtocolOrRefuse(
    req: express.Request,
    res: express.Response,
    message: McpMessage
): RequestProtocol | undefined {
    try {
        const protocol = readRequestProtocol(
            message,
            req.get('mcp-protocol-version') ?? undefined
        );
        if (protocol.era === 'stateless') {
            assertMirroredHeaders(message, {
                method: req.get('mcp-method') ?? undefined,
                name: req.get('mcp-name') ?? undefined
            });
        }
        return protocol;
    } catch (error) {
        res.status(400).json(
            errorResponse(requestIdOf(message), error, 'stateless')
        );
        return undefined;
    }
}

// 2026-07-28 defines no client notification over HTTP and forbids client
// responses: the server never sends it a request to answer.
function answerStatelessNonRequest(
    res: express.Response,
    kind: Exclude<McpMessageKind, 'request'>
): void {
    if (kind === 'notification') {
        res.status(202).end();
        return;
    }
    res.status(400).json(
        errorResponse(
            undefined,
            new McpError(
                'invalid_request',
                'A stateless client sends requests only; nothing here asked it a question',
                {retryable: false}
            ),
            'stateless'
        )
    );
}

/** A session-era message: initialize, sessions, elicitation on the stream. */
async function serveSessionMessage(
    req: express.Request,
    res: express.Response,
    message: McpMessage,
    kind: McpMessageKind
): Promise<void> {
    // initialize starts a new session, whatever header it carries.
    const requestedSessionId =
        message.method === 'initialize'
            ? undefined
            : (req.get('mcp-session-id') ?? undefined);
    if (
        requestedSessionId &&
        !(await requireLiveSession(req, res, requestIdOf(message)))
    ) {
        return;
    }
    if (kind === 'response') {
        await serveElicitationAnswer(req, res, message);
        return;
    }
    if (message.method === 'notifications/cancelled') {
        await serveCancellation(req, res, message);
        return;
    }
    const clientId = attributedMcpClient(
        req.get('x-mcp-client') ?? undefined,
        req.user?.credentialAudience
    );
    const admitted = await admitMessage(req, res, message, {
        clientId,
        budget: requestBudgetKind(message)
    });
    if (!admitted) return;
    const {level} = admitted;
    const created =
        message.method === 'initialize'
            ? await openSession(req, message)
            : undefined;
    if (created) res.setHeader('Mcp-Session-Id', created.id);
    const sessionId = requestedSessionId ?? created?.id;
    const resourceSessionId =
        requestedSessionId ?? (created?.durable ? created.id : undefined);
    const resources =
        req.user && resourceSessionId && level
            ? eventResourcesFor(req, level, resourceSessionId)
            : undefined;
    const tracked = await trackCancellable(req, message, requestedSessionId);
    // Only offer elicitation when this client said it can show a prompt.
    const owner = req.user ? callerFor(req.user, req.token) : undefined;
    const elicit =
        owner &&
        sessionId &&
        (await elicitationBroker().supportsElicitation(sessionId, owner))
            ? buildElicitor(res, {
                  sessionId,
                  owner,
                  protocolVersion: req.get('mcp-protocol-version') ?? undefined,
                  signal: tracked?.signal
              })
            : undefined;
    try {
        await dispatchToCore(req, res, message, {
            level,
            clientId,
            elicit,
            resources,
            signal: tracked?.signal
        });
    } finally {
        void tracked?.release();
    }
}

/**
 * A 2026-07-28 request: the same gates and the same core, with no session.
 * Approvals travel as an input_required result and the retry that answers
 * it; cancelling is closing the response stream.
 */
async function serveStatelessRequest(
    req: express.Request,
    res: express.Response,
    message: McpMessage,
    protocol: Extract<RequestProtocol, {era: 'stateless'}>
): Promise<void> {
    const clientId = attributedMcpClient(
        req.get('x-mcp-client') ?? undefined,
        req.user?.credentialAudience
    );
    const admitted = await admitMessage(req, res, message, {
        clientId,
        budget: statelessBudgetKind(req, message, protocol)
    });
    if (!admitted) return;
    const {level} = admitted;
    if (message.method === 'subscriptions/listen') {
        const work = serveSubscriptionsListen(req, res, message, level);
        eventStreamRouteWork.add(work);
        await work.finally(() => eventStreamRouteWork.delete(work));
        return;
    }
    let elicit: OperateElicit | undefined;
    try {
        elicit = await statelessElicitor(req, message, protocol);
    } catch (error) {
        if (error instanceof McpError) recordMcpDenial(error.reason);
        auditDenial(
            req,
            message,
            error instanceof Error ? error.message : String(error),
            clientId
        );
        res.json(errorResponse(requestIdOf(message), error, 'stateless'));
        return;
    }
    await dispatchToCore(req, res, message, {
        level,
        clientId,
        elicit,
        resources:
            req.user && level ? statelessEventResources(req, level) : undefined,
        eventSubscriptions: Boolean(level) && mcpEventStreams.available(),
        signal: closeSignal(res),
        protocol
    });
}

/**
 * How a stateless tools/call asks a human: only when the client declared a
 * form prompt for this request. A retry's echoed state is verified and spent
 * first, whether or not it still asks: state that fails is refused, never
 * ignored.
 */
async function statelessElicitor(
    req: express.Request,
    message: McpMessage,
    protocol: Extract<RequestProtocol, {era: 'stateless'}>
): Promise<OperateElicit | undefined> {
    if (message.method !== 'tools/call' || !req.user) return undefined;
    const call = approvalCallOf(req.user, req.token, message, protocol);
    const answered = await readApprovalRetry(call, {
        inputResponses: message.params?.inputResponses,
        requestState: message.params?.requestState
    });
    return declaresFormElicitation(protocol.meta.clientCapabilities)
        ? approvalElicitor(call, answered)
        : undefined;
}

// The tools/call an approval is bound to: who calls, which tool, which args.
function approvalCallOf(
    user: user_t,
    token: string | undefined,
    message: McpMessage,
    protocol: Extract<RequestProtocol, {era: 'stateless'}>
): ApprovalCall {
    return {
        owner: callerFor(user, token),
        tool: String(message.params?.name ?? ''),
        args: message.params?.arguments ?? {},
        protocolVersion: protocol.version
    };
}

/** What differs per era in a call to the core; the rest is the request. */
interface CoreCall {
    level: McpLevel | undefined;
    clientId: string | undefined;
    elicit: OperateElicit | undefined;
    resources: McpEventResourcePort | undefined;
    eventSubscriptions?: boolean;
    signal: AbortSignal | undefined;
    protocol?: RequestProtocol;
}

// A stateless method that does not exist is 404, so a client can tell it from
// a missing endpoint; the session revisions answer it with 200.
function replyStatus(reply: unknown, era: ProtocolEra): number {
    const code = (reply as {error?: {code?: unknown}} | null)?.error?.code;
    return era === 'stateless' && code === -32601 ? 404 : 200;
}

// Times one tools/call. Only a registered tool name becomes a label, so a
// client cannot grow the metric's label set.
function timeToolCall(message: McpMessage) {
    if (message.method !== 'tools/call') return undefined;
    const name = String(message.params?.name ?? '');
    const tool = isKnownTool(name) ? name : 'unknown';
    const startedAt = Date.now();
    return {
        finish(outcome: 'success' | 'error') {
            recordMcpToolCall(tool, outcome, Date.now() - startedAt);
        }
    };
}

// Bounded labels only: a tool name the server does not know becomes 'unknown'.
function spanFor(
    message: McpMessage,
    call: CoreCall,
    trace: TraceContext | undefined
): McpSpan {
    const name = String(message.params?.name ?? '');
    return startMcpSpan({
        method: String(message.method ?? ''),
        toolName:
            message.method === 'tools/call'
                ? isKnownTool(name)
                    ? name
                    : 'unknown'
                : undefined,
        protocolVersion: call.protocol?.version,
        parent: trace
    });
}

// The stable reason of a failed reply, for the span's error.type.
function replyErrorType(reply: unknown): string | undefined {
    const answer = reply as {
        error?: {data?: {reason?: unknown}};
        result?: {_meta?: Record<string, {reason?: unknown} | undefined>};
    } | null;
    const reason =
        answer?.error?.data?.reason ??
        answer?.result?._meta?.[TOOL_ERROR_META]?.reason;
    return typeof reason === 'string' ? reason : undefined;
}

function callFailed(reply: unknown): boolean {
    const answer = reply as {
        error?: unknown;
        result?: {isError?: unknown};
    } | null;
    return Boolean(answer?.error || answer?.result?.isError);
}

/**
 * The W3C trace a request joins: its `_meta` carries MCP's own context, so it
 * wins over the HTTP headers a proxy may have set for its hop.
 */
function requestTraceContext(
    req: express.Request,
    message: McpMessage
): TraceContext | undefined {
    const meta = message.params?._meta;
    if (meta && ('traceparent' in meta || 'tracestate' in meta)) {
        return readTraceContext({
            traceparent: meta.traceparent,
            tracestate: meta.tracestate
        });
    }
    return readTraceContext({
        traceparent: req.get('traceparent'),
        tracestate: req.get('tracestate')
    });
}

// Joins an external trace to the audit rows that carry this correlation id.
function logJoinedTrace(
    message: McpMessage,
    call: {correlationId: string; trace: TraceContext}
): void {
    logger.info(
        'MCP request method=%s correlationId=%s traceId=%s parentId=%s',
        message.method,
        call.correlationId,
        call.trace.traceId,
        call.trace.parentId
    );
}

/** Runs one request through the shared core and writes what it returns. */
async function dispatchToCore(
    req: express.Request,
    res: express.Response,
    message: McpMessage,
    call: CoreCall
): Promise<void> {
    const era = call.protocol?.era ?? 'session';
    const owner = req.user ? callerFor(req.user, req.token) : undefined;
    // One id for this whole tool call: the doorway row below and every rpc row
    // the tool causes carry it, so "show me everything this call did" is a
    // single query instead of a guess from timestamps.
    const correlationId = randomUUID();
    const trace = requestTraceContext(req, message);
    if (trace) logJoinedTrace(message, {correlationId, trace});
    const stopProgress = startProgress(req, res, message);
    const timing = timeToolCall(message);
    const span = spanFor(message, call, trace);
    try {
        const reply = await withToolDeadline(() =>
            untilCancelled(
                call.signal,
                withCallContext({correlationId, trace}, () =>
                    handleRequest(message, {
                        execute: executorFor(req.user),
                        level: call.level,
                        role: effectiveMcpRole(req.user),
                        elicit: call.elicit,
                        resources: call.resources,
                        eventSubscriptions: call.eventSubscriptions,
                        protocolVersions: STREAMABLE_HTTP_PROTOCOL_VERSIONS,
                        protocol: call.protocol,
                        signal: call.signal,
                        operations: {
                            reserve: reserveOperation,
                            get: getOperation,
                            registerRecovery: registerOperationRecovery,
                            getRecovery: getOperationRecovery,
                            linkRecoveryJob: linkOperationRecoveryJob,
                            findRecoveryJob: findOperationRecoveryJob,
                            start: startOperation,
                            canExecute: canExecuteOperation,
                            finishExecution: finishOperationExecution,
                            recordSuccess: recordOperationSuccess,
                            recordDefinitiveFailure:
                                recordDefinitiveOperationFailure,
                            recordOutcomeUnknown: recordOperationOutcomeUnknown
                        },
                        caller: owner,
                        audit: req.user
                            ? (entry) =>
                                  logMcpTool({
                                      username: req.user?.username,
                                      organizationId:
                                          req.user?.organizationId ?? null,
                                      credentialId: mcpCredentialIdentity(
                                          req.user,
                                          req.token
                                      ),
                                      correlationId,
                                      traceId: trace?.traceId,
                                      clientId: call.clientId,
                                      ...entry
                                  })
                            : undefined
                    })
                )
            )
        );
        timing?.finish(callFailed(reply) ? 'error' : 'success');
        span.end({failed: callFailed(reply), errorType: replyErrorType(reply)});
        // Once an elicitation went out the reply owes the open SSE stream, not
        // a fresh JSON body.
        if (res.headersSent) {
            if (reply) writeSseMessage(res, reply);
            res.end();
            return;
        }
        if (!reply) {
            res.status(202).end();
            return;
        }
        res.status(replyStatus(reply, era)).json(reply);
    } catch (error) {
        timing?.finish('error');
        span.end({
            failed: true,
            errorType: error instanceof McpError ? error.reason : 'internal'
        });
        if (error instanceof McpError) recordMcpDenial(error.reason);
        auditDenial(
            req,
            message,
            error instanceof Error ? error.message : String(error)
        );
        if (isCancellation(error)) {
            endWithoutResponse(res);
            return;
        }
        const failure = errorResponse(requestIdOf(message), error, era);
        if (res.headersSent) {
            writeSseMessage(res, failure);
            res.end();
            return;
        }
        res.json(failure);
    } finally {
        // Every exit, including a throw and an early return: a leaked interval
        // would keep writing to a finished response.
        stopProgress();
    }
}

/** Test seam: the interval is otherwise five seconds of real waiting. */
export const startProgressForTest = startProgress;

/** Test seam: how a stateless request learns its client went away. */
export const closeSignalForTest = closeSignal;

export function writeEventFrameForTest(
    res: express.Response,
    eventId: string,
    payload: unknown
): boolean {
    if (res.writableEnded || res.destroyed) return false;
    return res.write(`id: ${eventId}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function transportEventId(sessionId: string, redisId: string): string {
    return `${sessionId}:${redisId}`;
}

function redisEventId(
    sessionId: string,
    transportId: string | undefined
): string | undefined {
    if (!transportId) return undefined;
    const separator = transportId.lastIndexOf(':');
    if (
        separator < 1 ||
        transportId.slice(0, separator) !== sessionId ||
        !/^\d+-\d+$/.test(transportId.slice(separator + 1))
    ) {
        throw new Error('Last-Event-ID belongs to another MCP stream');
    }
    return transportId.slice(separator + 1);
}

function gapNotification(uri?: string) {
    return {
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: {
            level: 'warning',
            logger: 'fleet-manager-events',
            data: {
                code: 'history_gap',
                message:
                    'Retained event history no longer includes the requested position',
                ...(uri ? {uri} : {})
            }
        }
    };
}

function resourceUriFromPayload(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const message = payload as {
        method?: unknown;
        params?: {uri?: unknown; data?: {uri?: unknown}};
    };
    if (typeof message.params?.uri === 'string') return message.params.uri;
    return typeof message.params?.data?.uri === 'string'
        ? message.params.data.uri
        : undefined;
}

// A live session without a durable stream (none created, or no Redis) is
// offered no SSE stream, which the spec answers with 405.
async function hasEventStream(
    sessionId: string,
    principal: McpStreamPrincipal
): Promise<boolean> {
    try {
        return Boolean(await mcpEventStreams.getSession(sessionId, principal));
    } catch (error) {
        logger.warn(
            'MCP event stream unavailable: %s',
            error instanceof Error ? error.message : String(error)
        );
        return false;
    }
}

/**
 * The credential as it is now, and the event reads it allows. Undefined once
 * it no longer admits this principal at an MCP level: re-authentication,
 * a different identity, or a key that lost its MCP audience.
 */
async function currentEventReader(
    token: string | undefined,
    principal: McpStreamPrincipal
): Promise<EventReader | undefined> {
    const user = await refreshMcpUser(token);
    const refreshed = principalFor(user, token);
    const level = mcpIssuedCredentialLevel(user);
    if (!user || !refreshed || !principalsMatch(principal, refreshed) || !level)
        return undefined;
    return eventReaderFor(user, principal, level);
}

async function organizationAllowsMcp(
    principal: McpStreamPrincipal
): Promise<boolean> {
    return (await getEffectiveMcpPolicy(principal.organizationId ?? undefined))
        .enabled;
}

/**
 * Keeps a stream's reader lease alive between polls; a pass that takes longer
 * than the lease would otherwise hand the stream to nobody.
 */
function holdReaderLease(sessionId: string, readerOwner: string) {
    let current = true;
    let renewing: Promise<void> | undefined;
    const timer = setInterval(() => {
        if (renewing || !current) return;
        renewing = mcpEventStreams
            .renewReader(sessionId, readerOwner)
            .then((renewed) => {
                current = renewed;
            })
            .catch(() => {
                current = false;
            })
            .finally(() => {
                renewing = undefined;
            });
    }, 2_000);
    timer.unref?.();
    return {
        current: () => current,
        /** Stops renewing and releases the lease once any renewal settles. */
        async release(): Promise<void> {
            clearInterval(timer);
            await renewing;
            await mcpEventStreams.releaseReader(sessionId, readerOwner);
        }
    };
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// One frame on a session stream: kept for replay first, then sent, and only
// while this reader still holds the stream.
async function appendAndSend(
    stream: {
        res: express.Response;
        sessionId: string;
        principal: McpStreamPrincipal;
        readerOwner: string;
    },
    payload: unknown
): Promise<boolean> {
    const {res, sessionId, principal, readerOwner} = stream;
    const id = await mcpEventStreams.appendFrame(
        sessionId,
        principal,
        payload,
        readerOwner
    );
    if (!(await mcpEventStreams.ownsReader(sessionId, readerOwner)))
        return false;
    return writeEventFrameForTest(
        res,
        transportEventId(sessionId, id),
        payload
    );
}

export async function serveMcpGet(
    req: express.Request,
    res: express.Response
): Promise<void> {
    const sessionId = req.get('mcp-session-id');
    // Only a session has a stream; without one the answer must be 405.
    if (!sessionId) {
        res.setHeader('Allow', 'GET, POST, DELETE');
        res.status(405).json(
            errorResponse(
                undefined,
                new McpError(
                    'invalid_request',
                    'Open the event stream with the Mcp-Session-Id from initialize'
                )
            )
        );
        return;
    }
    const principal = streamPrincipal(req);
    if (!principal || !req.user) {
        refuseNonMcpCredential(res);
        return;
    }
    if (!(await requireLiveSession(req, res, undefined))) return;
    let reader: EventReader | undefined;
    try {
        reader = await currentEventReader(req.token, principal);
    } catch {
        reader = undefined;
    }
    if (!reader) {
        res.status(401).json({error: 'MCP credential is no longer valid'});
        return;
    }
    let lastEventId: string | undefined;
    try {
        lastEventId = redisEventId(
            sessionId,
            req.get('last-event-id') ?? undefined
        );
    } catch (error) {
        res.status(400).json({error: describe(error)});
        return;
    }
    if (!(await hasEventStream(sessionId, principal))) {
        res.setHeader('Allow', 'POST, DELETE');
        res.status(405).json(
            errorResponse(
                undefined,
                new McpError(
                    'invalid_request',
                    'This session has no event stream'
                )
            )
        );
        return;
    }
    if (activeEventStreams >= tuning.mcp.maxSessions) {
        res.status(503).json({
            error: 'MCP event stream connection limit reached'
        });
        return;
    }
    const readerOwner = randomUUID();
    if (
        !(await mcpEventStreams.acquireReader(
            sessionId,
            principal,
            readerOwner
        ))
    ) {
        res.status(404).json({error: 'Unknown or unauthorized MCP session'});
        return;
    }
    endSupersededReader(sessionId);
    sessionReaders.set(sessionId, res);
    activeEventStreams++;
    eventStreamClosers.set(res, () => res.end());
    let resolveDrain: () => void = () => {};
    const drained = new Promise<void>((resolve) => {
        resolveDrain = resolve;
    });
    eventStreamDrains.add(drained);
    let released = false;
    const lease = holdReaderLease(sessionId, readerOwner);
    const releaseConnection = () => {
        if (released) return;
        released = true;
        activeEventStreams--;
        eventStreamClosers.delete(res);
        if (sessionReaders.get(sessionId) === res)
            sessionReaders.delete(sessionId);
        void lease
            .release()
            .catch((error) =>
                logger.warn(
                    'MCP event reader lease release failed: %s',
                    describe(error)
                )
            )
            .finally(() => {
                eventStreamDrains.delete(drained);
                resolveDrain();
            });
    };
    res.once('close', releaseConnection);
    let replay: Awaited<ReturnType<typeof mcpEventStreams.replay>>;
    try {
        replay = await mcpEventStreams.replay(
            sessionId,
            principal,
            lastEventId
        );
    } catch (error) {
        releaseConnection();
        res.status(404).json({error: describe(error)});
        return;
    }

    const replayFrames = [] as typeof replay.frames;
    try {
        for (const frame of replay.frames) {
            const uri = resourceUriFromPayload(frame.payload);
            if (!uri) {
                replayFrames.push(frame);
                continue;
            }
            await reader.validate(uri);
            const message = frame.payload as {method?: unknown};
            if (message.method !== 'notifications/resources/updated') {
                replayFrames.push(frame);
                continue;
            }
            if ((await reader.poll(uri)).changed) replayFrames.push(frame);
        }
    } catch {
        releaseConnection();
        res.status(403).json({error: 'MCP resource permission was revoked'});
        return;
    }

    openEventStream(res);
    const stream = {res, sessionId, principal, readerOwner};
    if (replay.gap) {
        if (
            !(await mcpEventStreams.ownsReader(sessionId, readerOwner)) ||
            !(await appendAndSend(stream, gapNotification()))
        ) {
            res.end();
            releaseConnection();
            return;
        }
    }
    for (const frame of replayFrames) {
        if (
            !(await mcpEventStreams.ownsReader(sessionId, readerOwner)) ||
            !writeEventFrameForTest(
                res,
                transportEventId(sessionId, frame.id),
                frame.payload
            )
        ) {
            res.end();
            releaseConnection();
            return;
        }
    }

    let stopped = false;
    res.once('close', () => {
        stopped = true;
    });
    await followEventSubscriptions({
        sessionId,
        principal,
        readerOwner,
        streams: mcpEventStreams,
        currentReader: () => currentEventReader(req.token, principal),
        policyEnabled: () => organizationAllowsMcp(principal),
        open: () => !stopped && !res.writableEnded && !res.destroyed,
        leaseCurrent: lease.current,
        deliver: ({uri, gap}) =>
            appendAndSend(
                stream,
                gap ? gapNotification(uri) : resourceUpdated(uri)
            ),
        reportFailure: (error) =>
            logger.warn(
                'MCP event stream stopped session=%s: %s',
                sessionId,
                describe(error)
            ),
        pollIntervalMs: EVENT_POLL_INTERVAL_MS
    });
    if (!res.writableEnded) res.end();
    releaseConnection();
}

const EVENT_POLL_INTERVAL_MS = 1_000;
const KEEPALIVE_INTERVAL_MS = 15_000;

function openEventStream(res: express.Response): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Tells a buffering proxy (nginx) to pass each event on at once.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
}

function resourceUpdated(uri: string, meta?: Record<string, unknown>) {
    return {
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: {...(meta ? {_meta: meta} : {}), uri}
    };
}

// What a listen stream subscribes to. Only fm://events changes; any other
// URI is left out of the acknowledgement rather than silently never firing.
function readListenUris(notifications: unknown): string[] {
    if (
        typeof notifications !== 'object' ||
        notifications === null ||
        Array.isArray(notifications)
    ) {
        throw new McpError(
            'invalid_params',
            'subscriptions/listen needs a notifications object'
        );
    }
    const requested = (notifications as {resourceSubscriptions?: unknown})
        .resourceSubscriptions;
    if (requested === undefined) return [];
    if (
        !Array.isArray(requested) ||
        !requested.every((uri) => typeof uri === 'string')
    ) {
        throw new McpError(
            'invalid_params',
            'resourceSubscriptions must be a list of resource URIs'
        );
    }
    const uris = [...new Set(requested as string[])].filter(isMcpEventUri);
    if (uris.length > MCP_EVENT_STREAM_LIMITS.maxSubscriptions) {
        throw new McpError(
            'invalid_params',
            `A listen stream follows at most ${MCP_EVENT_STREAM_LIMITS.maxSubscriptions} resources`
        );
    }
    return uris;
}

function streamUnavailable(message: string): McpError {
    return new McpError('operation_unavailable', message, {retryable: true});
}

interface ListenStream {
    sessionId: string;
    readerOwner: string;
    uris: string[];
}

/**
 * Checks every URI as the credential allows it now, then records the
 * subscriptions in the shared event stream store under a stream of their
 * own. Nothing is recorded when any URI is refused.
 */
async function openListenStream(
    user: user_t,
    principal: McpStreamPrincipal,
    request: {level: McpLevel; notifications: unknown}
): Promise<ListenStream> {
    const uris = readListenUris(request.notifications);
    const reader = eventReaderFor(user, principal, request.level);
    const subscriptions: {uri: string; cursor: string}[] = [];
    for (const uri of uris) {
        await reader.validate(uri);
        subscriptions.push({uri, cursor: await baselineCursor(reader, uri)});
    }
    if (
        !mcpEventStreams.available() ||
        activeEventStreams >= tuning.mcp.maxSessions
    ) {
        throw streamUnavailable('No event stream can be opened right now');
    }
    let sessionId: string;
    try {
        sessionId = await mcpEventStreams.createSession(principal);
    } catch (error) {
        logger.warn('MCP listen stream not created: %s', describe(error));
        throw streamUnavailable('No event stream can be opened right now');
    }
    try {
        for (const subscription of subscriptions) {
            await mcpEventStreams.subscribe(sessionId, principal, subscription);
        }
        const readerOwner = randomUUID();
        if (
            !(await mcpEventStreams.acquireReader(
                sessionId,
                principal,
                readerOwner
            ))
        ) {
            throw streamUnavailable('The event stream could not be claimed');
        }
        return {sessionId, readerOwner, uris};
    } catch (error) {
        await mcpEventStreams.deleteSession(sessionId, principal);
        throw error;
    }
}

// Why a listen stream ended, as the error its client reads. A client that
// closed it gets nothing; a server that is stopping sends the result instead.
const LISTEN_END_ERRORS: Readonly<
    Record<Exclude<EventFollowEnd, 'closed' | 'failed'>, () => McpError>
> = {
    credential: () =>
        new McpError(
            'not_authenticated',
            'The credential no longer admits this subscription',
            {retryable: false}
        ),
    policy: () =>
        new McpError('mcp_disabled', 'MCP is disabled for this organization', {
            retryable: false
        }),
    lease: () => streamUnavailable('The event stream was lost; listen again')
};

/**
 * subscriptions/listen: one long-lived response stream. It acknowledges what
 * it will deliver, then sends notifications/resources/updated for each
 * watched URI that changed, until the client closes it, the credential or
 * organization stops admitting it, a permission is revoked, or the server
 * stops (which answers the request so the client knows it ended cleanly).
 */
async function serveSubscriptionsListen(
    req: express.Request,
    res: express.Response,
    message: McpMessage,
    level: McpLevel | undefined
): Promise<void> {
    const id = requestIdOf(message) ?? null;
    const principal = streamPrincipal(req);
    const user = req.user;
    if (!user || !principal || !level) {
        res.json(
            errorResponse(
                id,
                new McpError(
                    'permission_denied',
                    'Event subscriptions need a credential issued for MCP'
                ),
                'stateless'
            )
        );
        return;
    }
    let opened: ListenStream;
    try {
        opened = await openListenStream(user, principal, {
            level,
            notifications: message.params?.notifications
        });
    } catch (error) {
        res.json(errorResponse(id, error, 'stateless'));
        return;
    }
    await followListenStream(req, res, {id, principal, ...opened});
}

async function followListenStream(
    req: express.Request,
    res: express.Response,
    stream: ListenStream & {
        id: string | number | null;
        principal: McpStreamPrincipal;
    }
): Promise<void> {
    const {id, principal, sessionId, readerOwner, uris} = stream;
    const tag = {[META_SUBSCRIPTION_ID]: id};
    let lastFailure: unknown;
    const lease = holdReaderLease(sessionId, readerOwner);
    const keepalive = setInterval(() => {
        if (!res.writableEnded) res.write(': keepalive\n\n');
    }, KEEPALIVE_INTERVAL_MS);
    keepalive.unref?.();
    activeEventStreams++;
    eventStreamClosers.set(res, () => {
        writeSseMessage(res, {
            jsonrpc: '2.0',
            id,
            result: {resultType: 'complete', _meta: tag}
        });
        res.end();
    });
    let resolveDrain: () => void = () => {};
    eventStreamDrains.add(
        new Promise<void>((resolve) => {
            resolveDrain = resolve;
        })
    );
    let closedByClient = false;
    res.once('close', () => {
        closedByClient = true;
    });
    try {
        openEventStream(res);
        writeSseMessage(res, {
            jsonrpc: '2.0',
            method: 'notifications/subscriptions/acknowledged',
            params: {
                _meta: tag,
                notifications: uris.length ? {resourceSubscriptions: uris} : {}
            }
        });
        const end = await followEventSubscriptions({
            sessionId,
            principal,
            readerOwner,
            streams: mcpEventStreams,
            currentReader: () => currentEventReader(req.token, principal),
            policyEnabled: () => organizationAllowsMcp(principal),
            open: () => !closedByClient && !res.writableEnded && !res.destroyed,
            leaseCurrent: lease.current,
            // A retention gap is a change too: reading the URI reports it.
            deliver: async ({uri}) =>
                !res.writableEnded &&
                !res.destroyed &&
                res.write(
                    `data: ${JSON.stringify(resourceUpdated(uri, tag))}\n\n`
                ),
            reportFailure: (error) => {
                lastFailure = error;
                logger.warn(
                    'MCP listen stream stopped id=%s: %s',
                    JSON.stringify(id),
                    describe(error)
                );
            },
            pollIntervalMs: EVENT_POLL_INTERVAL_MS
        });
        if (end !== 'closed' && !res.writableEnded) {
            const error =
                end === 'failed' ? lastFailure : LISTEN_END_ERRORS[end]();
            writeSseMessage(res, errorResponse(id, error, 'stateless'));
        }
    } finally {
        clearInterval(keepalive);
        if (!res.writableEnded) res.end();
        activeEventStreams--;
        eventStreamClosers.delete(res);
        await lease
            .release()
            .then(() => mcpEventStreams.deleteSession(sessionId, principal))
            .catch((error) =>
                logger.warn(
                    'MCP listen stream cleanup failed: %s',
                    describe(error)
                )
            )
            .finally(resolveDrain);
    }
}

const router = express.Router();
router.use(validateMcpTransport);
router.post(
    '/',
    requireMcpBearer,
    requireMcpAccess,
    mcpRateLimit,
    express.json({limit: '4mb'}),
    serveMcpPost
);
router.get(
    '/',
    refuseStatelessStreamMethods,
    requireMcpBearer,
    requireMcpAccess,
    mcpRateLimit,
    (req, res) => {
        const work = serveMcpGet(req, res);
        eventStreamRouteWork.add(work);
        return work.finally(() => eventStreamRouteWork.delete(work));
    }
);

// A host calling terminateSession() gets a clean 204 instead of an SDK-level
// throw about an unexpected 404.
router.delete(
    '/',
    refuseStatelessStreamMethods,
    requireMcpBearer,
    requireMcpAccess,
    mcpRateLimit,
    (req, res) => {
        const sessionId = req.get('mcp-session-id');
        if (sessionId && req.user) {
            void elicitationBroker()
                .deleteSession(sessionId, callerFor(req.user, req.token))
                .catch((error) =>
                    logger.warn(
                        'MCP elicitation session cleanup failed: %s',
                        error instanceof Error ? error.message : String(error)
                    )
                );
            const principal = streamPrincipal(req);
            if (principal) {
                void mcpEventStreams
                    .deleteSession(sessionId, principal)
                    .catch((error) =>
                        logger.warn(
                            'MCP durable session cleanup failed: %s',
                            error instanceof Error
                                ? error.message
                                : String(error)
                        )
                    )
                    .finally(() => res.status(204).end());
                return;
            }
        }
        res.status(204).end();
    }
);

// Client-caused refusals of the body parser; its server faults are not here.
const BODY_REFUSALS = new Set([
    'entity.parse.failed',
    'entity.too.large',
    'charset.unsupported',
    'encoding.unsupported',
    'request.size.invalid'
]);

// Body parsing fails before the handler runs. Answer as JSON-RPC: bad JSON is
// a parse error, anything else the parser refuses is an invalid request, with
// the parser's own 4xx status (413 for a body over the limit).
router.use(
    (
        err: unknown,
        _req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        const failure = err as {type?: unknown; status?: unknown};
        if (
            res.headersSent ||
            typeof failure.type !== 'string' ||
            !BODY_REFUSALS.has(failure.type) ||
            typeof failure.status !== 'number'
        ) {
            next(err);
            return;
        }
        const status = failure.status;
        const parseFailed = failure.type === 'entity.parse.failed';
        res.status(status).json(
            errorResponse(
                undefined,
                new McpError(
                    parseFailed ? 'parse_error' : 'invalid_request',
                    parseFailed
                        ? 'The body is not valid JSON'
                        : 'The body could not be read as one JSON-RPC message'
                )
            )
        );
    }
);

export default router;
