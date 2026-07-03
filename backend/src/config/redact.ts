// Leaf module: kept import-light so tests skip the config barrel.

const REDACT_PATTERNS = /secret|password|token|masterkey|key/i;

export function redactSecretsForLog(obj: unknown): unknown {
    return JSON.parse(
        JSON.stringify(obj, (k, v) =>
            typeof v === 'string' && REDACT_PATTERNS.test(k) ? '[REDACTED]' : v
        )
    );
}
