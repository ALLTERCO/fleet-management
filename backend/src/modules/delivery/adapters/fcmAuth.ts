// FCM HTTP v1 auth. Mints short-lived OAuth2 access tokens from a Google
// service-account JSON (RS256 JWT -> token endpoint), cached until just
// before expiry. A static FM_PUSH_FCM_ACCESS_TOKEN still short-circuits this
// for operators who mint tokens out-of-band.

import * as jwt from 'jsonwebtoken';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const ASSERTION_TTL_SEC = 3600;
const EXPIRY_SKEW_MS = 60_000;
const MINT_TIMEOUT_MS = 30_000;

export interface FcmServiceAccount {
    client_email: string;
    private_key: string;
    token_uri?: string;
}

export interface FcmAuthDeps {
    fetchFn: typeof fetch;
    now: () => number;
}

const defaultDeps: FcmAuthDeps = {fetchFn: fetch, now: Date.now};

/** Signed JWT bearer assertion for the Google token endpoint. */
export function buildAssertion(sa: FcmServiceAccount, nowSec: number): string {
    return jwt.sign(
        {
            iss: sa.client_email,
            scope: SCOPE,
            aud: sa.token_uri ?? DEFAULT_TOKEN_URI,
            iat: nowSec,
            exp: nowSec + ASSERTION_TTL_SEC
        },
        sa.private_key,
        {algorithm: 'RS256'}
    );
}

export function parseServiceAccount(raw: string): FcmServiceAccount | null {
    try {
        const o = JSON.parse(raw) as Partial<FcmServiceAccount>;
        if (
            typeof o.client_email === 'string' &&
            typeof o.private_key === 'string'
        ) {
            return o as FcmServiceAccount;
        }
    } catch {
        // fall through
    }
    return null;
}

/** Exchange a fresh JWT assertion for an access token. */
export async function fetchFcmAccessToken(
    sa: FcmServiceAccount,
    deps: FcmAuthDeps = defaultDeps
): Promise<{token: string; expiresAtMs: number}> {
    const nowMs = deps.now();
    const assertion = buildAssertion(sa, Math.floor(nowMs / 1000));
    const tokenUri = sa.token_uri ?? DEFAULT_TOKEN_URI;
    const res = await deps.fetchFn(tokenUri, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion
        }).toString(),
        signal: AbortSignal.timeout(MINT_TIMEOUT_MS)
    });
    if (!res.ok) {
        throw new Error(`FCM token mint failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
    };
    if (!json.access_token) {
        throw new Error('FCM token mint returned no access_token');
    }
    return {
        token: json.access_token,
        expiresAtMs: nowMs + (json.expires_in ?? ASSERTION_TTL_SEC) * 1000
    };
}

let cache: {token: string; expiresAtMs: number} | undefined;

export function __resetFcmTokenCacheForTests(): void {
    cache = undefined;
}

/**
 * Resolve a usable FCM bearer token: prefer the static env token; otherwise
 * mint from the service account and cache until just before expiry. Returns
 * null when neither is configured.
 */
export async function resolveFcmAccessToken(
    input: {staticToken?: string; serviceAccountJson?: string},
    deps: FcmAuthDeps = defaultDeps
): Promise<string | null> {
    if (input.staticToken) return input.staticToken;
    if (!input.serviceAccountJson) return null;
    const sa = parseServiceAccount(input.serviceAccountJson);
    if (!sa) return null;
    if (cache && cache.expiresAtMs - EXPIRY_SKEW_MS > deps.now()) {
        return cache.token;
    }
    cache = await fetchFcmAccessToken(sa, deps);
    return cache.token;
}
