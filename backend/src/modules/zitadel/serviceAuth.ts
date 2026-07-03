// Zitadel Mgmt-API service auth: machine-user JWT-bearer flow with cached tokens.
// Used when FM_ZITADEL_SERVICE_AUTH=jwt-profile; key JSON at ZITADEL_SERVICE_KEY_PATH.

import {readFileSync} from 'node:fs';
import * as jwt from 'jsonwebtoken';

interface ZitadelMachineKey {
    type: 'serviceaccount';
    keyId: string;
    key: string;
    userId: string;
}

const REQUIRED_KEYS: ReadonlyArray<keyof ZitadelMachineKey> = [
    'type',
    'keyId',
    'key',
    'userId'
];

function parseMachineKey(raw: string, sourcePath: string): ZitadelMachineKey {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(
            `Zitadel service key file ${sourcePath} is not valid JSON: ${
                (err as Error).message
            }`
        );
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(
            `Zitadel service key file ${sourcePath} did not contain a JSON object`
        );
    }
    const obj = parsed as Record<string, unknown>;
    for (const k of REQUIRED_KEYS) {
        if (typeof obj[k] !== 'string' || (obj[k] as string).length === 0) {
            throw new Error(
                `Zitadel service key file ${sourcePath} is missing required field '${k}'`
            );
        }
    }
    if (obj.type !== 'serviceaccount') {
        throw new Error(
            `Zitadel service key file ${sourcePath} has type='${String(obj.type)}' (expected 'serviceaccount')`
        );
    }
    return parsed as ZitadelMachineKey;
}

export interface JwtGrantRequest {
    audience: string;
    scope: string;
    nowSeconds: number;
}

// Pure: signs the assertion presented at /oauth/v2/token (grant=jwt-bearer).
export function signServiceAssertion(
    key: ZitadelMachineKey,
    req: JwtGrantRequest
): string {
    const payload = {
        iss: key.userId,
        sub: key.userId,
        aud: req.audience,
        iat: req.nowSeconds,
        exp: req.nowSeconds + 3600
    };
    return jwt.sign(payload, key.key, {
        algorithm: 'RS256',
        keyid: key.keyId
    });
}

interface CachedToken {
    accessToken: string;
    expiresAtMs: number;
}

export type TokenFetcher = (
    assertion: string,
    scope: string
) => Promise<{
    accessToken: string;
    expiresInSeconds: number;
}>;

const REFRESH_LEAD_MS = 30_000;

// Deps injected so tests can drive the clock, file reader, and HTTP exchange.
export interface ServiceAuthDeps {
    readFile?: (path: string) => string;
    now?: () => number;
    fetchAccessToken: TokenFetcher;
    keyPath: string;
    audience: string;
    scope: string;
}

// Cached per-process: refreshes when token has < REFRESH_LEAD_MS left.
export function makeJwtServiceTokenSource(
    deps: ServiceAuthDeps
): () => Promise<string> {
    const readFile =
        deps.readFile ?? ((p: string) => readFileSync(p, {encoding: 'utf8'}));
    const now = deps.now ?? (() => Date.now());

    let cached: CachedToken | null = null;
    let inFlight: Promise<string> | null = null;

    async function refresh(): Promise<string> {
        const raw = readFile(deps.keyPath);
        const key = parseMachineKey(raw, deps.keyPath);
        const nowMs = now();
        const assertion = signServiceAssertion(key, {
            audience: deps.audience,
            scope: deps.scope,
            nowSeconds: Math.floor(nowMs / 1000)
        });
        const {accessToken, expiresInSeconds} = await deps.fetchAccessToken(
            assertion,
            deps.scope
        );
        cached = {
            accessToken,
            expiresAtMs: nowMs + expiresInSeconds * 1000
        };
        return accessToken;
    }

    return async () => {
        const nowMs = now();
        if (cached && cached.expiresAtMs - nowMs > REFRESH_LEAD_MS) {
            return cached.accessToken;
        }
        if (inFlight) return inFlight;
        inFlight = refresh().finally(() => {
            inFlight = null;
        });
        return inFlight;
    };
}
