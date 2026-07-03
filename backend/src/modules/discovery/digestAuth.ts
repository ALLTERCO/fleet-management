// RFC 7616 HTTP Digest Authorization header for Shelly Gen2+ /rpc.
// Shelly firmware fixes user to 'admin', algorithm to SHA-256, qop to 'auth'.
//
// WHY nc is hardcoded to 00000001: Shelly issues a fresh nonce per request —
// every unauth call (Ws.SetConfig, Shelly.Reboot, etc.) starts a new
// challenge cycle, so the client nonce-count never needs to advance. This
// helper is Shelly-only; a generic device that maintains nonce state
// across requests would need stale=true handling and an incrementing nc.

import {createHash, randomBytes} from 'node:crypto';

const SHELLY_USER = 'admin';
const DEFAULT_QOP = 'auth';
const DEFAULT_ALGORITHM = 'SHA-256';
const DEFAULT_NC = '00000001';

export interface DigestAuthInput {
    wwwAuthenticate: string;
    password: string;
    method: string;
    uri: string;
    cnonce?: string;
    nc?: string;
    username?: string;
}

interface DigestChallenge {
    realm: string;
    nonce: string;
    qop: string;
    algorithm: string;
    opaque?: string;
}

interface DigestResponseInput {
    challenge: DigestChallenge;
    username: string;
    password: string;
    method: string;
    uri: string;
    cnonce: string;
    nc: string;
}

const CHALLENGE_FIELD_RE = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,"]+))/g;

function parseChallengeFields(header: string): Map<string, string> {
    const fields = new Map<string, string>();
    for (const m of header.matchAll(CHALLENGE_FIELD_RE)) {
        const key = m[1].toLowerCase();
        const value = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3];
        fields.set(key, value);
    }
    return fields;
}

// HA2 here is computed as method:uri (the qop=auth form). Selecting
// 'auth-int' would also require entity-body hashing in HA2 — this helper
// does not implement that variant, so reject rather than emit a header
// the server will silently mismatch.
function pickQop(raw: string): string {
    const candidates = raw.split(',').map((s) => s.trim());
    if (candidates.includes('auth')) return 'auth';
    throw new Error('auth-int qop not supported');
}

function rejectMalformed(missing: string): never {
    throw new Error(`malformed WWW-Authenticate: missing ${missing}`);
}

export function parseWwwAuthenticate(header: string): DigestChallenge {
    const stripped = header.replace(/^\s*Digest\s+/i, '');
    const f = parseChallengeFields(stripped);
    const realm = f.get('realm');
    const nonce = f.get('nonce');
    if (!realm) rejectMalformed('realm');
    if (!nonce) rejectMalformed('nonce');
    const opaque = f.get('opaque');
    return {
        realm,
        nonce,
        qop: pickQop(f.get('qop') ?? DEFAULT_QOP),
        algorithm: f.get('algorithm') ?? DEFAULT_ALGORITHM,
        ...(opaque !== undefined ? {opaque} : {})
    };
}

function sha256Hex(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
}

function computeResponseHash(args: DigestResponseInput): string {
    const ha1 = sha256Hex(
        `${args.username}:${args.challenge.realm}:${args.password}`
    );
    const ha2 = sha256Hex(`${args.method}:${args.uri}`);
    return sha256Hex(
        `${ha1}:${args.challenge.nonce}:${args.nc}:${args.cnonce}:${args.challenge.qop}:${ha2}`
    );
}

interface AuthorizationFields {
    challenge: DigestChallenge;
    username: string;
    uri: string;
    cnonce: string;
    nc: string;
    response: string;
}

function renderAuthorization(args: AuthorizationFields): string {
    const parts = [
        `username="${args.username}"`,
        `realm="${args.challenge.realm}"`,
        `nonce="${args.challenge.nonce}"`,
        `uri="${args.uri}"`,
        `algorithm=${args.challenge.algorithm}`,
        `qop=${args.challenge.qop}`,
        `nc=${args.nc}`,
        `cnonce="${args.cnonce}"`,
        `response="${args.response}"`
    ];
    if (args.challenge.opaque !== undefined) {
        parts.push(`opaque="${args.challenge.opaque}"`);
    }
    return `Digest ${parts.join(', ')}`;
}

function defaultCnonce(): string {
    return randomBytes(16).toString('hex');
}

export function digestAuth(input: DigestAuthInput): string {
    const challenge = parseWwwAuthenticate(input.wwwAuthenticate);
    const username = input.username ?? SHELLY_USER;
    const cnonce = input.cnonce ?? defaultCnonce();
    const nc = input.nc ?? DEFAULT_NC;
    const response = computeResponseHash({
        challenge,
        username,
        password: input.password,
        method: input.method,
        uri: input.uri,
        cnonce,
        nc
    });
    return renderAuthorization({
        challenge,
        username,
        uri: input.uri,
        cnonce,
        nc,
        response
    });
}
