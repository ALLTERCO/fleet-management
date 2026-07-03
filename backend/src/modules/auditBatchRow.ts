// Pure transform; kept config-free so tests skip the config barrel.

import type {AuditLogEntry} from './AuditLogger';
import {sanitizeErrorMessageForPersistence} from './util/sanitizeErrorMessage';

// params stays an object so SQL e->'params' is queryable JSONB, not a string.
export interface AuditBatchRow {
    ts: string | null;
    event_type: string;
    username: string | null;
    shelly_id: string | null;
    shelly_ids: string[] | null;
    method: string | null;
    params: Record<string, unknown> | null;
    success: boolean;
    error_message: string | null;
    ip_address: string | null;
    organization_id: string | null;
}

export const REDACTED_PLACEHOLDER = '[REDACTED]';

// Substrings that mark a key as secret-bearing, so it never reaches JSONB in
// cleartext. Specific names — not a bare 'key', which would redact pubkey etc.
const SENSITIVE_KEY_SUBSTRINGS = [
    'password',
    'secret',
    'token',
    'authorization',
    'apikey',
    'api_key',
    'privatekey',
    'private_key',
    'accesskey',
    'access_key'
];

// SSOT predicate for "this key may carry a secret" — substring, case-insensitive.
export function isSensitiveParamKey(key: string): boolean {
    const lower = key.toLowerCase();
    return SENSITIVE_KEY_SUBSTRINGS.some((needle) => lower.includes(needle));
}

// Recursively redact values under secret-looking keys. Returns the original
// reference (allocation-free) when nothing was scrubbed; never mutates input.
function scrubSensitiveValues(value: unknown): unknown {
    if (Array.isArray(value)) {
        let changed = false;
        const out = value.map((item) => {
            const scrubbed = scrubSensitiveValues(item);
            if (scrubbed !== item) changed = true;
            return scrubbed;
        });
        return changed ? out : value;
    }
    if (value === null || typeof value !== 'object') return value;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
        value as Record<string, unknown>
    )) {
        if (isSensitiveParamKey(key)) {
            out[key] = REDACTED_PLACEHOLDER;
            changed = true;
            continue;
        }
        const scrubbed = scrubSensitiveValues(child);
        if (scrubbed !== child) changed = true;
        out[key] = scrubbed;
    }
    return changed ? out : value;
}

// Scrub first (so secrets never persist), then length-cap.
// Returns input/scrubbed object or a small marker — always an object.
export function truncateForJsonb(
    obj: Record<string, unknown>,
    maxChars: number
): Record<string, unknown> {
    const scrubbed = scrubSensitiveValues(obj) as Record<string, unknown>;
    const json = JSON.stringify(scrubbed);
    if (json.length <= maxChars) return scrubbed;
    return {_truncated: true, _originalLength: json.length};
}

export function entryToBatchRow(
    entry: AuditLogEntry,
    paramsMaxChars = 10_000,
    errorMessageMaxChars = 2048
): AuditBatchRow {
    return {
        ts: entry.ts || null,
        event_type: entry.eventType,
        username: entry.username || null,
        shelly_id: entry.shellyId || null,
        shelly_ids:
            entry.shellyIds && entry.shellyIds.length > 0
                ? entry.shellyIds
                : null,
        method: entry.method || null,
        params: entry.params
            ? truncateForJsonb(entry.params, paramsMaxChars)
            : null,
        success: entry.success ?? true,
        error_message: sanitizeErrorMessageForPersistence(
            entry.errorMessage,
            errorMessageMaxChars
        ),
        ip_address: entry.ipAddress || null,
        organization_id: entry.organizationId || null
    };
}
