// System proof of MCP browser sign-in against a running stack with real
// Zitadel: discovery, PKCE sign-in through the MCP apps, the MCP session, and
// every token Fleet must refuse. Run through mcp-oauth-zitadel-check.sh, which
// reads the stack's own state. It creates zz-verify users and one zz-verify app
// and removes them; never point it at a stack whose data matters.

import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {request} from 'undici';
import {
    authRequestIdFrom,
    clientIdsByLevel,
    codeFrom,
    createPkce,
    parseBearerChallenge,
    proofCheck,
    redirectErrorFrom,
    toolRefusalReason
} from './mcp-oauth-check-lib';
import {waitForAccessEnd} from './scoped-automation-revocation';

interface Config {
    fleetUrl: string;
    publicBaseUrl: string;
    zitadelUrl: string;
    zitadelHost?: string;
    issuer: string;
    serviceToken: string;
    loginToken: string;
    organizationId: string;
    projectId: string;
    spaClientId: string;
    spaRedirectUri: string;
    mcpClients: Record<string, string>;
    accountStateTtlMs: number;
    outputPath?: string;
}

interface HttpReply {
    status: number;
    location: string | null;
    challenge: string | null;
    text: string;
}

interface SignInRequest {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    resourceOnAuthorize?: string;
    resourceOnToken?: string;
}

interface Tokens {
    accessToken: string;
    refreshToken?: string;
}

type SignInOutcome =
    | {ok: true; tokens: Tokens}
    | {ok: false; step: 'authorize' | 'token'; status: number; error?: string};

type CheckStatus = 'pass' | 'fail' | 'observed';

const REQUEST_TIMEOUT_MS = 15_000;
const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VSCODE_REDIRECT = 'https://vscode.dev/redirect';
const LOOPBACK_REDIRECT = `http://127.0.0.1:${40_000 + Math.floor(Math.random() * 20_000)}/callback`;
const RUN_LABEL = `zz-verify-mcp-oauth-${randomUUID()}`;
const PASSWORD = `Zz9!${randomUUID()}`;

const config = readConfig();
const zitadelUsers: string[] = [];
const zitadelApps: string[] = [];
const report: Record<string, unknown> = {
    schemaVersion: 1,
    kind: 'mcp-oauth-zitadel-system-proof',
    startedAt: new Date().toISOString(),
    status: 'failed',
    checks: [] as Array<Record<string, unknown>>
};

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function readConfig(): Config {
    const mcpClients = clientIdsByLevel(
        required('FM_MCP_OAUTH_CHECK_MCP_CLIENT_IDS')
    );
    if (!mcpClients.read || !mcpClients.write) {
        throw new Error(
            'FM_MCP_OAUTH_CHECK_MCP_CLIENT_IDS needs read and write apps; rerun the Zitadel bootstrap'
        );
    }
    const ttl = Number(process.env.FM_MCP_OAUTH_CHECK_ACCOUNT_STATE_TTL_MS);
    return {
        fleetUrl: required('FM_MCP_OAUTH_CHECK_FLEET_URL').replace(/\/+$/, ''),
        publicBaseUrl: required('FM_MCP_OAUTH_CHECK_PUBLIC_BASE_URL').replace(
            /\/+$/,
            ''
        ),
        zitadelUrl: required('FM_MCP_OAUTH_CHECK_ZITADEL_URL').replace(
            /\/+$/,
            ''
        ),
        zitadelHost: process.env.FM_MCP_OAUTH_CHECK_ZITADEL_HOST?.trim(),
        issuer: required('FM_MCP_OAUTH_CHECK_ISSUER'),
        serviceToken: required('FM_MCP_OAUTH_CHECK_SERVICE_TOKEN'),
        loginToken: required('FM_MCP_OAUTH_CHECK_LOGIN_TOKEN'),
        organizationId: required('FM_MCP_OAUTH_CHECK_ORG_ID'),
        projectId: required('FM_MCP_OAUTH_CHECK_PROJECT_ID'),
        spaClientId: required('FM_MCP_OAUTH_CHECK_SPA_CLIENT_ID'),
        spaRedirectUri: required('FM_MCP_OAUTH_CHECK_SPA_REDIRECT_URI'),
        mcpClients,
        // Must match the stack's FM_ACCOUNT_STATE_TTL_MS: the promised bound.
        accountStateTtlMs: Number.isSafeInteger(ttl) && ttl > 0 ? ttl : 30_000,
        outputPath: process.env.FM_MCP_OAUTH_CHECK_OUTPUT?.trim() || undefined
    };
}

function addCheck(
    id: string,
    status: CheckStatus,
    evidence: Record<string, unknown> = {}
): void {
    (report.checks as Array<Record<string, unknown>>).push(
        proofCheck({id, status, evidence})
    );
}

function requireCheck(
    id: string,
    passed: boolean,
    evidence: Record<string, unknown> = {}
): void {
    addCheck(id, passed ? 'pass' : 'fail', evidence);
}

// --- HTTP -------------------------------------------------------------------

// undici.request, not fetch: fetch drops the Host header Zitadel routes on,
// and does not let a 302 through unfollowed.
async function zitadelHttp(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: {
        token?: string;
        json?: unknown;
        form?: Record<string, string>;
    } = {}
): Promise<HttpReply> {
    const headers: Record<string, string> = {
        ...(config.zitadelHost ? {host: config.zitadelHost} : {}),
        ...(config.issuer.startsWith('https:')
            ? {'x-forwarded-proto': 'https'}
            : {}),
        ...(options.token ? {authorization: `Bearer ${options.token}`} : {})
    };
    let body: string | undefined;
    if (options.json !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(options.json);
    } else if (options.form) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(options.form).toString();
    }
    const response = await request(`${config.zitadelUrl}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    return {
        status: response.statusCode,
        location: headerValue(response.headers.location),
        challenge: null,
        text: await response.body.text()
    };
}

function headerValue(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

async function zitadelJson<T>(
    method: 'POST' | 'DELETE',
    path: string,
    json: unknown,
    token = config.serviceToken
): Promise<T> {
    const reply = await zitadelHttp(method, path, {token, json});
    if (reply.status < 200 || reply.status >= 300) {
        throw new Error(
            `Zitadel ${method} ${path} answered HTTP ${reply.status}`
        );
    }
    return (reply.text ? JSON.parse(reply.text) : {}) as T;
}

async function fleetHttp(
    method: 'GET' | 'POST',
    path: string,
    options: {token?: string; json?: unknown} = {}
): Promise<HttpReply> {
    const response = await fetch(`${config.fleetUrl}${path}`, {
        method,
        headers: {
            ...(options.token
                ? {authorization: `Bearer ${options.token}`}
                : {}),
            ...(options.json === undefined
                ? {}
                : {
                      'content-type': 'application/json',
                      accept: 'application/json, text/event-stream'
                  })
        },
        body:
            options.json === undefined
                ? undefined
                : JSON.stringify(options.json),
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    return {
        status: response.status,
        location: response.headers.get('location'),
        challenge: response.headers.get('www-authenticate'),
        text: await response.text()
    };
}

function mcpToolsList(token?: string): Promise<HttpReply> {
    return fleetHttp('POST', '/mcp', {
        token,
        json: {jsonrpc: '2.0', id: 1, method: 'tools/list'}
    });
}

function rpcGetMe(token: string): Promise<HttpReply> {
    return fleetHttp('POST', '/rpc', {
        token,
        json: {method: 'User.GetMe', params: {}}
    });
}

function isInvalidTokenRefusal(reply: HttpReply): boolean {
    return (
        reply.status === 401 &&
        parseBearerChallenge(reply.challenge)?.error === 'invalid_token'
    );
}

// --- Zitadel fixtures ---------------------------------------------------------

async function grantRole(userId: string): Promise<void> {
    await zitadelJson(
        'POST',
        '/zitadel.authorization.v2.AuthorizationService/CreateAuthorization',
        {
            userId,
            projectId: config.projectId,
            organizationId: config.organizationId,
            roleKeys: ['admin']
        }
    );
}

async function createPerson(label: string): Promise<string> {
    const created = await zitadelJson<{id: string}>('POST', '/v2/users/new', {
        organizationId: config.organizationId,
        username: `${RUN_LABEL}-${label}`,
        human: {
            profile: {givenName: 'zz-verify', familyName: label},
            email: {
                email: `${RUN_LABEL}-${label}@example.invalid`,
                isVerified: true
            },
            password: {password: PASSWORD, changeRequired: false}
        }
    });
    zitadelUsers.push(created.id);
    await grantRole(created.id);
    return created.id;
}

async function createPersonalAccessToken(): Promise<string> {
    const created = await zitadelJson<{id: string}>('POST', '/v2/users/new', {
        organizationId: config.organizationId,
        username: `${RUN_LABEL}-pat`,
        machine: {
            name: 'zz-verify mcp oauth pat',
            accessTokenType: 'ACCESS_TOKEN_TYPE_BEARER'
        }
    });
    zitadelUsers.push(created.id);
    await grantRole(created.id);
    const pat = await zitadelJson<{token: string}>(
        'POST',
        `/v2/users/${created.id}/pats`,
        {expirationDate: new Date(Date.now() + 86_400_000).toISOString()}
    );
    return pat.token;
}

// An app in the Fleet project that Fleet does not know: what an unmapped or
// leftover MCP app, or a customer's own integration, looks like.
async function createUnknownProjectApp(): Promise<string> {
    const created = await zitadelJson<{
        applicationId: string;
        oidcConfiguration?: {clientId?: string};
    }>('POST', '/zitadel.application.v2.ApplicationService/CreateApplication', {
        projectId: config.projectId,
        name: `${RUN_LABEL}-unknown-app`,
        oidcConfiguration: {
            responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
            grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE'],
            applicationType: 'OIDC_APP_TYPE_NATIVE',
            authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
            redirectUris: ['http://127.0.0.1/callback'],
            version: 'OIDC_VERSION_1_0',
            accessTokenType: 'OIDC_TOKEN_TYPE_BEARER'
        }
    });
    zitadelApps.push(created.applicationId);
    const clientId = created.oidcConfiguration?.clientId;
    if (!clientId) throw new Error('unknown project app has no client id');
    await waitUntilSignInKnowsApp(clientId);
    return clientId;
}

// Zitadel publishes a new app to its sign-in endpoint shortly after creating it.
async function waitUntilSignInKnowsApp(clientId: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const reply = await zitadelHttp(
            'GET',
            `/oauth/v2/authorize?${new URLSearchParams({client_id: clientId})}`
        );
        if (!reply.text.includes('Errors.App.NotFound')) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Zitadel sign-in never learned app ${clientId}`);
}

// --- Sign-in ------------------------------------------------------------------

async function authorize(
    signIn: SignInRequest,
    challenge: string
): Promise<HttpReply> {
    const query = new URLSearchParams({
        client_id: signIn.clientId,
        redirect_uri: signIn.redirectUri,
        response_type: 'code',
        scope: signIn.scopes.join(' '),
        state: randomUUID(),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...(signIn.resourceOnAuthorize
            ? {resource: signIn.resourceOnAuthorize}
            : {})
    });
    return zitadelHttp('GET', `/oauth/v2/authorize?${query}`);
}

// Stands in for the person typing a password into the Zitadel login page.
async function completeLogin(
    authRequestId: string,
    userId: string
): Promise<string> {
    const session = await zitadelJson<{
        sessionId: string;
        sessionToken: string;
    }>(
        'POST',
        '/v2/sessions',
        {checks: {user: {userId}, password: {password: PASSWORD}}},
        config.loginToken
    );
    const finished = await zitadelJson<{callbackUrl: string}>(
        'POST',
        `/v2/oidc/auth_requests/${authRequestId}`,
        {
            session: {
                sessionId: session.sessionId,
                sessionToken: session.sessionToken
            }
        },
        config.loginToken
    );
    return codeFrom(finished.callbackUrl);
}

async function signInAs(
    userId: string,
    signIn: SignInRequest
): Promise<SignInOutcome> {
    const pkce = createPkce();
    const started = await authorize(signIn, pkce.challenge);
    const authRequestId = authRequestIdFrom(started.location);
    if (!authRequestId) {
        return {
            ok: false,
            step: 'authorize',
            status: started.status,
            error:
                redirectErrorFrom(started.location) ??
                started.text.slice(0, 300)
        };
    }
    const code = await completeLogin(authRequestId, userId);
    const token = await zitadelHttp('POST', '/oauth/v2/token', {
        form: {
            grant_type: 'authorization_code',
            code,
            redirect_uri: signIn.redirectUri,
            client_id: signIn.clientId,
            code_verifier: pkce.verifier,
            ...(signIn.resourceOnToken
                ? {resource: signIn.resourceOnToken}
                : {})
        }
    });
    const body = JSON.parse(token.text || '{}') as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
    };
    if (token.status !== 200 || !body.access_token) {
        return {
            ok: false,
            step: 'token',
            status: token.status,
            error: body.error
        };
    }
    return {
        ok: true,
        tokens: {
            accessToken: body.access_token,
            refreshToken: body.refresh_token
        }
    };
}

async function mustSignIn(
    userId: string,
    signIn: SignInRequest
): Promise<Tokens> {
    const outcome = await signInAs(userId, signIn);
    if (!outcome.ok) {
        throw new Error(
            `sign-in with ${signIn.clientId} failed at ${outcome.step}: HTTP ${outcome.status} ${outcome.error ?? ''}`
        );
    }
    return outcome.tokens;
}

async function refresh(
    clientId: string,
    refreshToken: string
): Promise<{status: number; tokens?: Tokens; error?: string}> {
    const reply = await zitadelHttp('POST', '/oauth/v2/token', {
        form: {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId
        }
    });
    const body = JSON.parse(reply.text || '{}') as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
    };
    return body.access_token
        ? {
              status: reply.status,
              tokens: {
                  accessToken: body.access_token,
                  refreshToken: body.refresh_token
              }
          }
        : {status: reply.status, error: body.error};
}

// --- MCP session --------------------------------------------------------------

async function withMcpClient<T>(
    accessToken: string,
    use: (client: Client) => Promise<T>
): Promise<T> {
    const client = new Client(
        {name: 'fleet-mcp-oauth-check', version: '1.0.0'},
        {capabilities: {}}
    );
    const transport = new StreamableHTTPClientTransport(
        new URL(`${config.fleetUrl}/mcp`),
        {requestInit: {headers: {authorization: `Bearer ${accessToken}`}}}
    );
    await client.connect(transport, {timeout: REQUEST_TIMEOUT_MS});
    try {
        return await use(client);
    } finally {
        await client.close();
    }
}

async function callTool(
    client: Client,
    name: string,
    args: Record<string, unknown>
): Promise<unknown> {
    try {
        return await client.callTool({name, arguments: args}, undefined, {
            timeout: REQUEST_TIMEOUT_MS
        });
    } catch (error) {
        return error;
    }
}

function toolBody(result: unknown): Record<string, unknown> {
    const value = result as {
        structuredContent?: Record<string, unknown>;
        content?: Array<{type?: string; text?: string}>;
    };
    if (value?.structuredContent) return value.structuredContent;
    const text = value?.content?.find((part) => part.type === 'text')?.text;
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

// --- Proof steps --------------------------------------------------------------

async function proveDiscovery(): Promise<string[]> {
    const expectedResource = `${config.publicBaseUrl}/mcp`;
    const metadataPath = '/.well-known/oauth-protected-resource/mcp';
    const suffixed = await fleetHttp('GET', metadataPath);
    const root = await fleetHttp(
        'GET',
        '/.well-known/oauth-protected-resource'
    );
    const document = JSON.parse(suffixed.text || '{}') as {
        resource?: string;
        authorization_servers?: string[];
        scopes_supported?: string[];
        bearer_methods_supported?: string[];
    };
    requireCheck(
        'discovery:metadata',
        suffixed.status === 200 &&
            root.status === 200 &&
            document.resource === expectedResource &&
            document.authorization_servers?.[0] === config.issuer &&
            Array.isArray(document.scopes_supported) &&
            !document.scopes_supported.includes('offline_access') &&
            document.bearer_methods_supported?.join() === 'header',
        {
            httpStatus: suffixed.status,
            rootStatus: root.status,
            resource: document.resource,
            authorizationServers: document.authorization_servers,
            scopes: document.scopes_supported
        }
    );
    const challenge = await mcpToolsList();
    const params = parseBearerChallenge(challenge.challenge);
    requireCheck(
        'discovery:401-challenge',
        challenge.status === 401 &&
            params?.resource_metadata ===
                `${config.publicBaseUrl}${metadataPath}` &&
            typeof params.scope === 'string' &&
            params.error === undefined,
        {httpStatus: challenge.status, challenge: params}
    );
    return document.scopes_supported ?? [];
}

async function proveHttpsRedirects(scopes: string[]): Promise<void> {
    for (const [id, redirectUri] of [
        ['claude', CLAUDE_REDIRECT],
        ['vscode', VSCODE_REDIRECT]
    ] as const) {
        const pkce = createPkce();
        const reply = await authorize(
            {clientId: config.mcpClients.read, redirectUri, scopes},
            pkce.challenge
        );
        requireCheck(
            `native-app:https-redirect-accepted:${id}`,
            authRequestIdFrom(reply.location) !== undefined,
            {
                httpStatus: reply.status,
                error: redirectErrorFrom(reply.location)
            }
        );
    }
}

// Zitadel has no RFC 8707 support yet; record what it does with `resource`.
async function signInWithResource(
    userId: string,
    clientId: string,
    scopes: string[]
): Promise<Tokens> {
    const resource = `${config.publicBaseUrl}/mcp`;
    const base = {clientId, redirectUri: LOOPBACK_REDIRECT, scopes};
    const full = await signInAs(userId, {
        ...base,
        resourceOnAuthorize: resource,
        resourceOnToken: resource
    });
    if (full.ok) {
        addCheck('resource:authorize-and-token-accept-resource', 'observed');
        return full.tokens;
    }
    addCheck(`resource:${full.step}-rejects-resource`, 'observed', {
        httpStatus: full.status,
        error: full.error
    });
    const tokenOnly =
        full.step === 'authorize'
            ? await signInAs(userId, {...base, resourceOnToken: resource})
            : undefined;
    if (tokenOnly?.ok) {
        addCheck('resource:token-accepts-resource', 'observed');
        return tokenOnly.tokens;
    }
    if (tokenOnly) {
        addCheck('resource:token-rejects-resource', 'observed', {
            httpStatus: tokenOnly.status,
            error: tokenOnly.error
        });
    }
    const plain = await mustSignIn(userId, base);
    addCheck('resource:sign-in-without-resource', 'pass');
    return plain;
}

async function proveReadSession(accessToken: string): Promise<void> {
    await withMcpClient(accessToken, async (client) => {
        const tools = (await client.listTools()).tools.map((t) => t.name);
        const capabilities = toolBody(
            await callTool(client, 'fm_capabilities', {})
        );
        const read = toolBody(
            await callTool(client, 'fm_read', {
                method: 'group.List',
                params: {}
            })
        );
        requireCheck(
            'read-app:initialize-tools-list-fm-read',
            tools.includes('fm_read') &&
                capabilities.level === 'read' &&
                read.method === 'group.List' &&
                'result' in read,
            {tools: tools.length, level: capabilities.level}
        );
        const write = await callTool(client, 'fm_write', {
            method: 'group.Create',
            params: {name: `${RUN_LABEL}-group`},
            mode: 'prepare'
        });
        requireCheck(
            'read-app:fm-write-refused',
            toolRefusalReason(write) === 'read_only_mode',
            {reason: toolRefusalReason(write)}
        );
    });
}

async function proveWriteSession(
    userId: string,
    scopes: string[]
): Promise<Tokens> {
    const tokens = await mustSignIn(userId, {
        clientId: config.mcpClients.write,
        redirectUri: LOOPBACK_REDIRECT,
        scopes
    });
    await withMcpClient(tokens.accessToken, async (client) => {
        const capabilities = toolBody(
            await callTool(client, 'fm_capabilities', {})
        );
        requireCheck('write-app:level-write', capabilities.level === 'write', {
            level: capabilities.level
        });
        const name = `${RUN_LABEL}-write-group`;
        const created = (await confirmedWrite(client, {
            method: 'group.Create',
            params: {name}
        })) as {id: number};
        if (!Number.isSafeInteger(created.id)) {
            throw new Error('group.Create returned no group id');
        }
        try {
            const read = toolBody(
                await callTool(client, 'fm_read', {
                    method: 'group.Get',
                    params: {id: created.id}
                })
            );
            const group = read.result as
                | {id?: number; name?: string}
                | undefined;
            requireCheck(
                'write-app:create-and-read-back',
                read.method === 'group.Get' &&
                    group?.id === created.id &&
                    group.name === name
            );
        } finally {
            const deleted = (await confirmedWrite(client, {
                method: 'group.Delete',
                params: {id: created.id}
            })) as {deleted?: boolean; id?: number};
            requireCheck(
                'write-app:created-group-cleaned-up',
                deleted.deleted === true && deleted.id === created.id
            );
        }
    });
    return tokens;
}

async function confirmedWrite(
    client: Client,
    request: {method: string; params: Record<string, unknown>}
): Promise<unknown> {
    const prepared = toolBody(
        await callTool(client, 'fm_write', {...request, mode: 'prepare'})
    );
    if (
        prepared.status !== 'confirmation_required' ||
        typeof prepared.confirmationToken !== 'string'
    ) {
        throw new Error(
            `${request.method} did not return a confirmation token`
        );
    }
    const confirmed = toolBody(
        await callTool(client, 'fm_confirm_write', {
            confirmationToken: prepared.confirmationToken
        })
    );
    if (
        confirmed.status !== 'executed' ||
        confirmed.method !== request.method ||
        !('result' in confirmed)
    ) {
        throw new Error(`${request.method} was not executed`);
    }
    return confirmed.result;
}

async function proveRefreshRotation(tokens: Tokens): Promise<Tokens> {
    if (!tokens.refreshToken) {
        requireCheck('refresh:issued', false, {
            note: 'no refresh token for offline_access'
        });
        return tokens;
    }
    const renewed = await refresh(config.mcpClients.read, tokens.refreshToken);
    const rotated =
        renewed.tokens?.refreshToken !== undefined &&
        renewed.tokens.refreshToken !== tokens.refreshToken;
    const works = renewed.tokens
        ? (await mcpToolsList(renewed.tokens.accessToken)).status === 200
        : false;
    requireCheck('refresh:new-access-token-works', works, {
        httpStatus: renewed.status,
        error: renewed.error
    });
    requireCheck('refresh:refresh-token-rotated', rotated);
    const reused = await refresh(config.mcpClients.read, tokens.refreshToken);
    addCheck('refresh:old-refresh-token-reuse', 'observed', {
        httpStatus: reused.status,
        error: reused.error,
        accepted: reused.tokens !== undefined
    });
    return renewed.tokens ?? tokens;
}

async function proveMcpTokenConfined(accessToken: string): Promise<void> {
    const rpc = await rpcGetMe(accessToken);
    const api = await fleetHttp('GET', '/api/docs/openapi.json', {
        token: accessToken
    });
    requireCheck(
        'mcp-token:refused-on-rpc-and-api',
        rpc.status === 403 && api.status === 403,
        {rpcStatus: rpc.status, apiStatus: api.status}
    );
}

async function proveSessionRefused(
    userId: string,
    scopes: string[]
): Promise<void> {
    const tokens = await mustSignIn(userId, {
        clientId: config.spaClientId,
        redirectUri: config.spaRedirectUri,
        scopes
    });
    const mcp = await mcpToolsList(tokens.accessToken);
    const rpc = await rpcGetMe(tokens.accessToken);
    requireCheck(
        'spa-token:refused-on-mcp-still-a-session',
        isInvalidTokenRefusal(mcp) && rpc.status === 200,
        {mcpStatus: mcp.status, rpcStatus: rpc.status}
    );
}

async function provePersonalAccessTokenRefused(): Promise<void> {
    const token = await createPersonalAccessToken();
    const mcp = await mcpToolsList(token);
    const rpc = await rpcGetMe(token);
    requireCheck(
        'zitadel-pat:refused-on-mcp-still-works-on-rpc',
        isInvalidTokenRefusal(mcp) && rpc.status === 200,
        {mcpStatus: mcp.status, rpcStatus: rpc.status}
    );
}

async function proveUnknownProjectAppRefused(
    userId: string,
    scopes: string[]
): Promise<void> {
    const clientId = await createUnknownProjectApp();
    const tokens = await mustSignIn(userId, {
        clientId,
        redirectUri: 'http://127.0.0.1/callback',
        scopes
    });
    const rpc = await rpcGetMe(tokens.accessToken);
    const mcp = await mcpToolsList(tokens.accessToken);
    requireCheck(
        'unknown-project-app:refused-everywhere',
        rpc.status === 401 && isInvalidTokenRefusal(mcp),
        {rpcStatus: rpc.status, mcpStatus: mcp.status}
    );
}

async function proveDeactivationEndsAccess(
    userId: string,
    tokens: {read: string; write: string}
): Promise<void> {
    await zitadelJson('POST', `/v2/users/${userId}/deactivate`, {});
    const ended = await waitForAccessEnd({
        probe: async () => ({
            httpStatus: (await mcpToolsList(tokens.read)).status,
            privileged: {httpStatus: (await mcpToolsList(tokens.write)).status}
        }),
        boundMs: config.accountStateTtlMs,
        ended: (reply) =>
            reply.httpStatus === 401 && reply.privileged?.httpStatus === 401
    });
    requireCheck('deactivated-user:refused-within-bound', true, {
        boundMs: config.accountStateTtlMs,
        endedAfterMs: ended.endedAfterMs,
        readStatus: ended.reply.httpStatus,
        writeStatus: ended.reply.privileged?.httpStatus
    });
}

async function main(): Promise<void> {
    const scopes = await proveDiscovery();
    const signInScopes = [...scopes, 'offline_access'];
    const person = await createPerson('person');
    await proveHttpsRedirects(signInScopes);
    let readTokens = await signInWithResource(
        person,
        config.mcpClients.read,
        signInScopes
    );
    await proveReadSession(readTokens.accessToken);
    const writeTokens = await proveWriteSession(person, signInScopes);
    readTokens = await proveRefreshRotation(readTokens);
    await proveMcpTokenConfined(readTokens.accessToken);
    await proveSessionRefused(person, scopes);
    await provePersonalAccessTokenRefused();
    await proveUnknownProjectAppRefused(person, scopes);
    await proveDeactivationEndsAccess(person, {
        read: readTokens.accessToken,
        write: writeTokens.accessToken
    });
}

async function cleanup(): Promise<void> {
    const errors: string[] = [];
    for (const appId of [...zitadelApps]) {
        try {
            await zitadelJson(
                'POST',
                '/zitadel.application.v2.ApplicationService/DeleteApplication',
                {projectId: config.projectId, applicationId: appId}
            );
            zitadelApps.splice(zitadelApps.indexOf(appId), 1);
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    for (const userId of [...zitadelUsers]) {
        try {
            await zitadelJson('DELETE', `/v2/users/${userId}`, undefined);
            zitadelUsers.splice(zitadelUsers.indexOf(userId), 1);
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    report.cleanup = {
        remainingUsers: zitadelUsers.length,
        remainingApps: zitadelApps.length,
        errors
    };
    if (errors.length > 0) process.exitCode = 1;
}

async function run(): Promise<void> {
    try {
        await main();
        const failed = (report.checks as Array<{status: string}>).some(
            (check) => check.status === 'fail'
        );
        report.status = failed ? 'failed' : 'passed';
        if (failed) process.exitCode = 1;
    } catch (error) {
        report.error = error instanceof Error ? error.message : String(error);
        process.exitCode = 1;
    } finally {
        await cleanup();
        report.finishedAt = new Date().toISOString();
        const serialized = `${JSON.stringify(report, null, 2)}\n`;
        if (config.outputPath) {
            writeFileSync(config.outputPath, serialized, {mode: 0o600});
        }
        process.stdout.write(serialized);
    }
}

void run();
