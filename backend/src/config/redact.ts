// Leaf module: kept import-light so tests skip the config barrel.

// Boot-config logging is deliberately more aggressive than param redaction:
// a bare 'key' is fine here (no user data to false-positive on).
const REDACT_PATTERNS =
    /secret|password|passwd|passphrase|token|credential|masterkey|key|dkim|bearer|authorization/i;

// Value-based, so a URL under any key name (url, dsn, endpoint) is covered.
// With a colon the user stays and the password goes; without one the whole
// userinfo may be a token, so it goes.
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^/?#\s@]*)@/gi;

export function stripUrlUserinfo(value: string): string {
    return value.replace(URL_USERINFO, (_m, scheme: string, info: string) => {
        const colon = info.indexOf(':');
        return colon < 0
            ? `${scheme}[REDACTED]@`
            : `${scheme}${info.slice(0, colon)}:[REDACTED]@`;
    });
}

export function redactSecretsForLog(obj: unknown): unknown {
    return JSON.parse(
        JSON.stringify(obj, (k, v) =>
            typeof v !== 'string'
                ? v
                : REDACT_PATTERNS.test(k)
                  ? '[REDACTED]'
                  : stripUrlUserinfo(v)
        )
    );
}
