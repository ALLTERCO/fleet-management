// SQL wrappers for the scoped_token table. Auth.MintScopedToken
// mints; auth middleware consumes. Single SoT lives in 6572.

import {createHash, randomBytes} from 'node:crypto';
import * as postgres from '../PostgresProvider';

export interface ScopedTokenRow {
    token_hash: string;
    organization_id: string;
    issued_by: string;
    purpose: string;
    issued_at: string;
    expires_at: string;
    consumed_at: string | null;
    consumed_by: string | null;
}

const ALLOWED_PURPOSES = new Set(['devices.create']);

export function isAllowedPurpose(value: string): boolean {
    return ALLOWED_PURPOSES.has(value);
}

export function hashToken(plaintext: string): string {
    return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

// 32 random bytes → base64url. ~256 bits entropy, opaque to caller.
export function generateScopedToken(): string {
    return randomBytes(32).toString('base64url');
}

export interface MintScopedTokenInput {
    organizationId: string;
    issuedBy: string;
    purpose: string;
    ttlSeconds: number;
}

export interface MintedToken {
    token: string;
    expiresAt: string;
    organizationId: string;
    purpose: string;
}

export async function mintScopedToken(
    input: MintScopedTokenInput
): Promise<MintedToken> {
    const token = generateScopedToken();
    const tokenHash = hashToken(token);
    const rows = await postgres.queryRows<ScopedTokenRow>(
        `SELECT * FROM organization.fn_scoped_token_record($1, $2, $3, $4, $5)`,
        [
            tokenHash,
            input.organizationId,
            input.issuedBy,
            input.purpose,
            input.ttlSeconds
        ]
    );
    const row = rows[0];
    if (!row) throw new Error('fn_scoped_token_record returned no row');
    return {
        token,
        expiresAt: row.expires_at,
        organizationId: row.organization_id,
        purpose: row.purpose
    };
}

// Single-use consumption: returns null if already consumed, expired,
// or the purpose does not match.
export async function consumeScopedToken(
    token: string,
    purpose: string,
    actor: string
): Promise<ScopedTokenRow | null> {
    const tokenHash = hashToken(token);
    const rows = await postgres.queryRows<ScopedTokenRow>(
        `SELECT * FROM organization.fn_scoped_token_consume($1, $2, $3)`,
        [tokenHash, purpose, actor]
    );
    return rows[0]?.token_hash ? rows[0] : null;
}
