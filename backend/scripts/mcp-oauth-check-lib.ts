// Pure rules of the MCP browser sign-in proof. No I/O: the runner calls them.

import {createHash, randomBytes} from 'node:crypto';

export function proofCheck(input: {
    id: string;
    status: 'pass' | 'fail' | 'observed';
    evidence: Record<string, unknown>;
}): Record<string, unknown> {
    return {...input.evidence, id: input.id, status: input.status};
}

export interface Pkce {
    verifier: string;
    challenge: string;
}

/** A fresh S256 PKCE pair (RFC 7636). */
export function createPkce(): Pkce {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return {verifier, challenge};
}

/** The parameters of a `Bearer` WWW-Authenticate challenge (RFC 6750). */
export function parseBearerChallenge(
    header: string | null
): Record<string, string> | undefined {
    if (!header || !/^Bearer\b/i.test(header)) return undefined;
    const params: Record<string, string> = {};
    for (const match of header.matchAll(/([a-z_]+)="([^"]*)"/gi)) {
        params[match[1].toLowerCase()] = match[2];
    }
    return params;
}

/**
 * The Login V2 auth request id Zitadel's authorize redirect carries, or
 * undefined when it redirected straight back to the client (an error).
 */
export function authRequestIdFrom(location: string | null): string | undefined {
    if (!location) return undefined;
    const value = new URL(location, 'http://placeholder').searchParams.get(
        'authRequest'
    );
    return value ?? undefined;
}

/** The OAuth error a redirect back to the client carries, if any. */
export function redirectErrorFrom(location: string | null): string | undefined {
    if (!location) return undefined;
    return (
        new URL(location, 'http://placeholder').searchParams.get('error') ??
        undefined
    );
}

/** The authorization code in the callback URL Zitadel returns. */
export function codeFrom(callbackUrl: string): string {
    const code = new URL(callbackUrl).searchParams.get('code');
    if (!code) throw new Error('callback URL carries no authorization code');
    return code;
}

/** `read=<id>,write=<id>` as level -> client id. */
export function clientIdsByLevel(raw: string): Record<string, string> {
    const byLevel: Record<string, string> = {};
    for (const entry of raw.split(',')) {
        const [level, clientId] = entry.trim().split('=');
        if (level && clientId) byLevel[level] = clientId;
    }
    return byLevel;
}

/**
 * The stable reason of an MCP tool refusal: a tool error result carries it in
 * its JSON text, a protocol error in `data`.
 */
export function toolRefusalReason(outcome: unknown): string | undefined {
    const value = outcome as {
        data?: {reason?: unknown};
        isError?: unknown;
        content?: Array<{type?: unknown; text?: unknown}>;
    };
    if (typeof value?.data?.reason === 'string') return value.data.reason;
    if (value?.isError !== true) return undefined;
    const text = value.content?.find((part) => part.type === 'text')?.text;
    if (typeof text !== 'string') return undefined;
    const parsed = JSON.parse(text) as {reason?: unknown};
    return typeof parsed.reason === 'string' ? parsed.reason : undefined;
}
