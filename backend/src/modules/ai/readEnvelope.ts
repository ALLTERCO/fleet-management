// Bounds fm_read output for an agent: redact secrets, cap rows + bytes, wrap
// in an evidence envelope.

import {tuning} from '../../config/tuning';
import {McpError} from './mcpErrors.js';

const REDACTED = '[redacted]';

// Opaque paging cursor over a method's own offset param. base64url so an agent
// treats it as a token, not an integer to do arithmetic on.
export function encodeCursor(offset: number): string {
    return Buffer.from(String(offset)).toString('base64url');
}

export function decodeCursor(cursor: string): number {
    const n = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Number.isInteger(n) || n < 0) {
        throw new McpError('invalid_params', 'malformed read cursor', {
            tool: 'fm_read'
        });
    }
    return n;
}

// Field names whose value must never reach an agent. Optional separators catch
// snake_case AND camelCase (private_key / privateKey, ssl_ca / sslCa).
const SECRET_KEY =
    /(pass(word|phrase)?|secret|token|api[-_]?key|private[-_]?key|ssl[-_]?ca|ha1|credential|bearer|authorization|cookie|session|jwt|pem)/i;

// Value-borne secrets: shapes that are a secret no matter the field name, so a
// token returned under an innocuous key (data, note, url) is still caught. Each
// pattern is high-precision to avoid redacting benign data:
//   PEM / OpenSSH private material · JWT (three base64url segments, eyJ header)
//   provider webhook URLs that embed a token · AWS access key · Slack token ·
//   GitHub token · Stripe secret key · Google API key.
const SECRET_VALUE =
    /-----BEGIN [A-Z ]+-----|ssh-(rsa|ed25519) |\beyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}|https:\/\/(hooks\.slack\.com|discord(app)?\.com\/api\/webhooks|[a-z0-9-]+\.webhook\.office\.com)\/|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}|\bgh[posru]_[A-Za-z0-9]{20,}|\bsk_(live|test)_[A-Za-z0-9]{16,}|\bAIza[0-9A-Za-z_-]{35}\b/;

function redact(value: unknown): unknown {
    if (typeof value === 'string') {
        return SECRET_VALUE.test(value) ? REDACTED : value;
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value)) {
            out[key] = SECRET_KEY.test(key) ? REDACTED : redact(val);
        }
        return out;
    }
    return value;
}

interface Envelope {
    method: string;
    result: unknown;
    truncated: boolean;
    rowLimit: number;
    // Present only when a row cap cut a list AND the method pages by offset:
    // pass it back as the read cursor to fetch the next page.
    nextCursor?: string;
    evidence: {type: 'method'; id: string}[];
}

// Where in the list this page started, and whether the method can page — set by
// operateRead from the request cursor/offset and the method's params schema.
export interface Paging {
    offset: number;
    pageable: boolean;
}

// Trim the first array we find (the list payload) to MAX_ROWS; then hard-cap
// the whole envelope by bytes as a final backstop.
export function buildReadEnvelope(
    method: string,
    rawResult: unknown,
    paging?: Paging
): Envelope {
    const maxRows = tuning.mcp.readMaxRows;
    const maxBytes = tuning.mcp.readMaxBytes;
    const redacted = redact(rawResult);
    let rowTruncated = false;
    let result = redacted;

    if (redacted && typeof redacted === 'object' && !Array.isArray(redacted)) {
        const obj = redacted as Record<string, unknown>;
        for (const [key, val] of Object.entries(obj)) {
            if (Array.isArray(val) && val.length > maxRows) {
                obj[key] = val.slice(0, maxRows);
                rowTruncated = true;
            }
        }
        result = obj;
    } else if (Array.isArray(redacted) && redacted.length > maxRows) {
        result = redacted.slice(0, maxRows);
        rowTruncated = true;
    }

    let truncated = rowTruncated;
    if (JSON.stringify(result).length > maxBytes) {
        result = {
            note: 'result exceeded the byte limit; narrow the query or page it',
            bytes: JSON.stringify(result).length,
            limit: maxBytes
        };
        truncated = true;
    }

    // A cursor is only meaningful for a row-capped page of a method that pages
    // by offset — a byte-capped result has no resumable position.
    const nextCursor =
        rowTruncated && paging?.pageable
            ? encodeCursor(paging.offset + maxRows)
            : undefined;

    return {
        method,
        ...(nextCursor ? {nextCursor} : {}),
        result,
        truncated,
        rowLimit: maxRows,
        evidence: [{type: 'method', id: method}]
    };
}
