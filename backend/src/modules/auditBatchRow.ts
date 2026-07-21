// Pure transform; kept config-free so tests skip the config barrel.

import type {AuditLogEntry} from './AuditLogger';
import {sanitizeErrorMessageForPersistence} from './util/sanitizeErrorMessage';

// params stays an object so SQL e->'params' is queryable JSONB, not a string.
export interface AuditBatchRow {
    ts: string | null;
    event_type: string;
    username: string | null;
    actor_user_id: string | null;
    shelly_id: string | null;
    shelly_ids: string[] | null;
    device_id: number | null;
    device_ids: number[] | null;
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
    'passphrase',
    'secret',
    'token',
    'authorization',
    'bearer',
    'credential',
    'dkim',
    'apikey',
    'api_key',
    'privatekey',
    'private_key',
    'accesskey',
    'access_key',
    'encryptionkey',
    'encryption_key',
    'masterkey',
    'signingkey'
];

// Exact-match keys too short/ambiguous to be substrings (e.g. 'pat' is a
// substring of 'path'/'update'; 'pass' is the Wi-Fi/AP PSK and MQTT password
// relayed via SetConfig — Shelly names the field `pass`, not `password`; 'psk'
// is the pre-shared key). Exact match so 'passthrough' etc. stay untouched.
const SENSITIVE_KEY_EXACT = new Set(['pat', 'pass', 'psk']);

// SSOT predicate for "this key may carry a secret" — case-insensitive.
export function isSensitiveParamKey(key: string): boolean {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEY_EXACT.has(lower)) return true;
    return SENSITIVE_KEY_SUBSTRINGS.some((needle) => lower.includes(needle));
}

// Recursively redact values under secret-looking keys. Returns the original
// reference (allocation-free) when nothing was scrubbed; never mutates input.
// Exported as the single home for deep param redaction (audit + WS debug log).
export function scrubSensitiveValues(value: unknown): unknown {
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
        actor_user_id: entry.actorUserId || null,
        shelly_id: entry.shellyId || null,
        shelly_ids:
            entry.shellyIds && entry.shellyIds.length > 0
                ? entry.shellyIds
                : null,
        device_id: entry.deviceId ?? null,
        device_ids:
            entry.deviceIds && entry.deviceIds.length > 0
                ? entry.deviceIds
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
