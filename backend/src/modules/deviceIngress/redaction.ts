// Common secret-bearing query/body param names — redact the VALUE of any of
// these wherever they appear, not just `token=`. Keeps the device-card text
// useful while scrubbing the obvious credential carriers.
const SECRET_PARAM_NAMES =
    'token|access_token|refresh_token|id_token|key|apikey|api_key|secret|client_secret|password|passwd|pwd|auth|authorization|sig|signature';
const SECRET_QUERY_RE = new RegExp(
    `([?&](?:${SECRET_PARAM_NAMES})=)[^&\\s]+`,
    'gi'
);
const SECRET_TEXT_RE = new RegExp(
    `\\b((?:${SECRET_PARAM_NAMES})=)[^&\\s]+`,
    'gi'
);
const BEARER_RE = /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

export function redactCredentialUrl(value: string): string {
    return value.replace(SECRET_QUERY_RE, '$1***');
}

export function redactToken(value: string | null | undefined): string | null {
    if (!value) return null;
    return `${value.slice(0, 8)}...`;
}

export function redactHandshakeHeaders(
    headers: Record<string, unknown>
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(headers)) {
        out[key] = redactHeaderValue(key, value);
    }
    return out;
}

function redactHeaderValue(key: string, value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (/authorization|token|cert/i.test(key)) return '***';
    return value.replace(BEARER_RE, '$1***');
}

export function truncateSafeDetail(value: unknown, maxBytes: number): string {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    const redacted = redactSafeText(raw);
    return redacted.length > maxBytes ? redacted.slice(0, maxBytes) : redacted;
}

function redactSafeText(value: string): string {
    return value
        .replace(SECRET_QUERY_RE, '$1***')
        .replace(SECRET_TEXT_RE, '$1***')
        .replace(BEARER_RE, '$1***');
}
