// Leaf module: kept import-light so tests skip the config barrel.

// Boot-config logging is deliberately more aggressive than param redaction:
// a bare 'key' is fine here (no user data to false-positive on).
const REDACT_PATTERNS =
    /secret|password|passwd|passphrase|token|credential|masterkey|key|dkim|bearer|authorization/i;

export function redactSecretsForLog(obj: unknown): unknown {
    return JSON.parse(
        JSON.stringify(obj, (k, v) =>
            typeof v === 'string' && REDACT_PATTERNS.test(k) ? '[REDACTED]' : v
        )
    );
}
