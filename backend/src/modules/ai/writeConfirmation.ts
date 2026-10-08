// Short-lived signed token binding user+org+method+params, so fm_confirm_write
// runs only the exact action fm_write previewed.

import crypto from 'node:crypto';
import {getJwtToken} from '../../config/jwtSecret';

const TTL_SEC = 300;
// Domain-separation tag: distinct from other HMAC-over-JWT_SECRET tokens.
const PURPOSE = 'mcp-write:';

export interface WriteAction {
    method: string;
    params: Record<string, unknown>;
    username: string;
    organizationId: string | null;
    credentialId?: string;
    idempotencyKey?: string;
}

interface TokenPayload extends WriteAction {
    iat: number;
    exp: number;
}

export interface VerifiedWrite extends WriteAction {
    /** Token issue time and expiry in ms, for single-use claiming. */
    issuedAtMs: number;
    expiresAtMs: number;
}

function mac(payload: string): string {
    return crypto
        .createHmac('sha256', getJwtToken())
        .update(PURPOSE + payload)
        .digest('base64url');
}

function timingSafeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function signWriteConfirmation(action: WriteAction): string {
    const iat = Math.floor(Date.now() / 1000);
    const payload: TokenPayload = {...action, iat, exp: iat + TTL_SEC};
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
        'base64url'
    );
    return `${encoded}.${mac(encoded)}`;
}

// Returns the bound action, or throws — expired, tampered, or a different
// user than the one who prepared it is refused.
export function verifyWriteConfirmation(
    token: unknown,
    caller: {
        username: string;
        organizationId: string | null;
        credentialId?: string;
    }
): VerifiedWrite {
    if (typeof token !== 'string') {
        throw new Error('confirmationToken required');
    }
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra !== undefined) {
        throw new Error('malformed confirmationToken');
    }
    if (!timingSafeEqual(signature, mac(encoded))) {
        throw new Error('invalid confirmationToken signature');
    }
    let payload: TokenPayload;
    try {
        payload = JSON.parse(
            Buffer.from(encoded, 'base64url').toString('utf8')
        ) as TokenPayload;
    } catch {
        throw new Error('malformed confirmationToken');
    }
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
        throw new Error('malformed confirmationToken');
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error('confirmationToken expired — prepare again');
    }
    if (payload.username !== caller.username) {
        throw new Error('confirmationToken was issued for a different user');
    }
    if (payload.organizationId !== caller.organizationId) {
        throw new Error(
            'confirmationToken was issued for a different organization'
        );
    }
    if (payload.credentialId !== caller.credentialId) {
        throw new Error(
            'confirmationToken was issued for a different credential'
        );
    }
    return {
        credentialId: payload.credentialId,
        idempotencyKey: payload.idempotencyKey,
        method: payload.method,
        params: payload.params,
        username: payload.username,
        organizationId: payload.organizationId,
        issuedAtMs: payload.iat * 1000,
        expiresAtMs: payload.exp * 1000
    };
}
