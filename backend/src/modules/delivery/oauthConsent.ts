// In-app OAuth2 consent for Gmail / Microsoft 365. Start issues a state
// token + PKCE verifier and returns the provider auth URL; the HTTP
// callback consumes the state once, exchanges the code for a refresh
// token, and writes it onto the endpoint's encrypted secrets.

import {createHash, randomBytes} from 'node:crypto';
import * as log4js from 'log4js';
import {envInt, envStr, envStrRequired} from '../../config/envReader';
import {isLeader, startLeaderGate} from '../redis/leaderGate';
import {createLazyPgCall} from './lazyPgCall';

const logger = log4js.getLogger('oauthConsent');
const PRUNE_LEADER_NAME = 'oauth-state-pruner';

const STATE_TTL_SECONDS = envInt('FM_OAUTH_STATE_TTL_SECONDS', 600, 60);

const GMAIL_SCOPES = envStr(
    'FM_OAUTH_GMAIL_SCOPES',
    'https://www.googleapis.com/auth/gmail.send'
);
const MICROSOFT_SCOPES = envStr(
    'FM_OAUTH_MICROSOFT_SCOPES',
    'offline_access https://outlook.office.com/SMTP.Send'
);

// Auth + token endpoints. We reuse the SMTP-side token URL envs so
// operators configure sovereign-cloud URLs once.
const GOOGLE_AUTH_URL = envStr(
    'FM_OAUTH_GMAIL_AUTH_URL',
    'https://accounts.google.com/o/oauth2/v2/auth'
);
const GOOGLE_TOKEN_URL = envStr(
    'FM_SMTP_OAUTH2_GOOGLE_TOKEN_URL',
    'https://oauth2.googleapis.com/token'
);
const MICROSOFT_AUTH_URL_TEMPLATE = envStr(
    'FM_OAUTH_MICROSOFT_AUTH_URL_TEMPLATE',
    'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize'
);
const MICROSOFT_TOKEN_URL_TEMPLATE = envStr(
    'FM_SMTP_OAUTH2_MICROSOFT_TOKEN_URL_TEMPLATE',
    'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token'
);

export type OAuthProvider = 'oauth2_google' | 'oauth2_microsoft';

export interface StartParams {
    organizationId: string;
    endpointId: number;
    provider: OAuthProvider;
    clientId: string;
    tenant?: string;
}

export interface StartResult {
    authUrl: string;
    state: string;
    expiresAt: string;
}

interface ConsumedState {
    organizationId: string;
    endpointId: number;
    provider: OAuthProvider;
    clientId: string;
    tenant: string | null;
    codeVerifier: string;
    redirectUri: string;
    scopes: string;
}

// Lazy seam (see lazyPgCall) so tests inject a fake before any real DB call.
const {pgCall, setForTests} = createLazyPgCall();
export const __setCallMethodForTests = setForTests;

type FetchLike = typeof fetch;
let _fetchImpl: FetchLike = (...args) => fetch(...args);
export function __setOauthFetchForTests(impl: FetchLike | null): void {
    _fetchImpl = impl ?? ((...args) => fetch(...args));
}

function redirectUri(): string {
    const base = envStrRequired('FM_OAUTH_REDIRECT_BASE').replace(/\/+$/, '');
    return `${base}/api/oauth/callback/email`;
}

function base64Url(buf: Buffer): string {
    return buf
        .toString('base64')
        .replace(/=+$/, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function generatePkcePair(): {verifier: string; challenge: string} {
    // 43..128 URL-safe chars; 32 bytes → ~43 chars.
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    return {verifier, challenge};
}

function randomStateToken(): string {
    return randomBytes(32).toString('hex');
}

function microsoftTenantOrDefault(tenant?: string): string {
    return tenant && tenant.trim().length > 0 ? tenant : 'common';
}

function substituteTenant(template: string, tenant: string): string {
    return template.replace('{tenant}', encodeURIComponent(tenant));
}

function buildAuthUrl(
    provider: OAuthProvider,
    params: {
        clientId: string;
        state: string;
        challenge: string;
        tenant: string;
    }
): string {
    const q = new URLSearchParams({
        client_id: params.clientId,
        redirect_uri: redirectUri(),
        response_type: 'code',
        state: params.state,
        code_challenge: params.challenge,
        code_challenge_method: 'S256'
    });
    if (provider === 'oauth2_google') {
        q.set('scope', GMAIL_SCOPES);
        q.set('access_type', 'offline');
        q.set('prompt', 'consent'); // force refresh_token on repeat consent
        return `${GOOGLE_AUTH_URL}?${q.toString()}`;
    }
    q.set('scope', MICROSOFT_SCOPES);
    return `${substituteTenant(MICROSOFT_AUTH_URL_TEMPLATE, params.tenant)}?${q.toString()}`;
}

function scopesFor(provider: OAuthProvider): string {
    return provider === 'oauth2_google' ? GMAIL_SCOPES : MICROSOFT_SCOPES;
}

export async function startConsent(p: StartParams): Promise<StartResult> {
    const state = randomStateToken();
    const {verifier, challenge} = generatePkcePair();
    const tenant = microsoftTenantOrDefault(p.tenant);
    const redirect = redirectUri();
    await pgCall('notifications.fn_oauth_state_insert', {
        p_state_token: state,
        p_organization_id: p.organizationId,
        p_endpoint_id: p.endpointId,
        p_provider: p.provider,
        p_client_id: p.clientId,
        p_tenant: p.provider === 'oauth2_microsoft' ? tenant : null,
        p_code_verifier: verifier,
        p_redirect_uri: redirect,
        p_scopes: scopesFor(p.provider),
        p_ttl_seconds: STATE_TTL_SECONDS
    });
    const authUrl = buildAuthUrl(p.provider, {
        clientId: p.clientId,
        state,
        challenge,
        tenant
    });
    const expiresAt = new Date(
        Date.now() + STATE_TTL_SECONDS * 1000
    ).toISOString();
    return {authUrl, state, expiresAt};
}

async function consumeState(stateToken: string): Promise<ConsumedState | null> {
    const res = await pgCall('notifications.fn_oauth_state_consume', {
        p_state_token: stateToken
    });
    const row = res?.rows?.[0] as
        | {
              organization_id: string;
              endpoint_id: number;
              provider: OAuthProvider;
              client_id: string;
              tenant: string | null;
              code_verifier: string;
              redirect_uri: string;
              scopes: string;
          }
        | undefined;
    if (!row) return null;
    return {
        organizationId: row.organization_id,
        endpointId: row.endpoint_id,
        provider: row.provider,
        clientId: row.client_id,
        tenant: row.tenant,
        codeVerifier: row.code_verifier,
        redirectUri: row.redirect_uri,
        scopes: row.scopes
    };
}

async function exchangeCode(params: {
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
}): Promise<{refreshToken: string}> {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
        code_verifier: params.codeVerifier,
        redirect_uri: params.redirectUri
    });
    const res = await _fetchImpl(params.tokenUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json'
        },
        body: body.toString(),
        signal: AbortSignal.timeout(
            envInt('FM_OAUTH_TOKEN_EXCHANGE_TIMEOUT_MS', 15_000, 1_000)
        )
    });
    const text = await res.text();
    // The body reaches the error log and the browser landing page, so bound it.
    const snippet = text.slice(0, envInt('FM_DELIVERY_ERROR_SNIPPET_MAX', 500));
    if (!res.ok) {
        throw new Error(`token exchange failed: HTTP ${res.status} ${snippet}`);
    }
    let payload: unknown;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new Error(`token exchange returned non-JSON: ${snippet}`);
    }
    const refreshToken = (payload as {refresh_token?: unknown}).refresh_token;
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
        throw new Error(
            'token exchange succeeded but did not return a refresh_token (try re-issuing consent with prompt=consent)'
        );
    }
    return {refreshToken};
}

export interface HandleCallbackResult {
    organizationId: string;
    channelId: number;
    provider: OAuthProvider;
}

// Callers provide the two secret-store hooks so oauthConsent stays out
// of the encryption/DB layer. The HTTP callback and RPC caller supply
// them via endpointSecretStore helpers.
export interface CallbackHooks {
    readClientSecret: (
        organizationId: string,
        endpointId: number
    ) => Promise<string | undefined>;
    writeRefreshToken: (
        organizationId: string,
        endpointId: number,
        refreshToken: string
    ) => Promise<void>;
}

export async function handleCallback(params: {
    state: string;
    code: string;
    hooks: CallbackHooks;
}): Promise<HandleCallbackResult> {
    const consumed = await consumeState(params.state);
    if (!consumed) {
        throw new Error('oauth state invalid, expired, or already consumed');
    }
    const clientSecret = await params.hooks.readClientSecret(
        consumed.organizationId,
        consumed.endpointId
    );
    if (!clientSecret) {
        throw new Error(
            `endpoint ${consumed.endpointId} missing auth.clientSecret — save it before starting consent`
        );
    }
    const tokenUrl =
        consumed.provider === 'oauth2_google'
            ? GOOGLE_TOKEN_URL
            : substituteTenant(
                  MICROSOFT_TOKEN_URL_TEMPLATE,
                  consumed.tenant ?? 'common'
              );
    const {refreshToken} = await exchangeCode({
        tokenUrl,
        clientId: consumed.clientId,
        clientSecret,
        code: params.code,
        codeVerifier: consumed.codeVerifier,
        redirectUri: consumed.redirectUri
    });
    await params.hooks.writeRefreshToken(
        consumed.organizationId,
        consumed.endpointId,
        refreshToken
    );
    return {
        organizationId: consumed.organizationId,
        channelId: consumed.endpointId,
        provider: consumed.provider
    };
}

export async function pruneExpiredStates(): Promise<number> {
    try {
        const res = await pgCall('notifications.fn_oauth_state_prune', {});
        const row = res?.rows?.[0] as
            | {fn_oauth_state_prune?: number}
            | undefined;
        return Number(row?.fn_oauth_state_prune ?? 0);
    } catch (err) {
        logger.warn(
            'oauth state prune failed: %s',
            err instanceof Error ? err.message : String(err)
        );
        return 0;
    }
}

// Periodic prune — started by app.ts, stopped on graceful shutdown.
// .unref() so the interval never keeps the event loop alive on exit.
let _pruneTimer: NodeJS.Timeout | null = null;
export function startOAuthStatePruner(): void {
    if (_pruneTimer) return;
    const intervalMs = envInt(
        'FM_OAUTH_STATE_PRUNE_INTERVAL_MS',
        5 * 60_000,
        60_000
    );
    void startLeaderGate(PRUNE_LEADER_NAME);
    _pruneTimer = setInterval(() => {
        if (!isLeader(PRUNE_LEADER_NAME)) return;
        pruneExpiredStates().catch((err) => {
            logger.warn(
                'oauth prune timer: %s',
                err instanceof Error ? err.message : String(err)
            );
        });
    }, intervalMs);
    _pruneTimer.unref();
    logger.info('oauth state pruner started — %d ms interval', intervalMs);
}
export function stopOAuthStatePruner(): void {
    if (_pruneTimer) {
        clearInterval(_pruneTimer);
        _pruneTimer = null;
    }
}
