/**
 * Secret redaction for RPC response bodies.
 *
 * Word-boundary matcher: the sensitive token must appear as a whole
 * segment (start, end, or separated by `_`/`-`/`.`). Matches
 * `api_key`, `jwt-secret`, `auth.token`, `password`; does NOT match
 * `keyboard`, `author`, `keycloak_url`, `monkey`, `publickey_fingerprint`.
 */
export const SECRET_KEY_PATTERN =
    /(^|[_\-.])(secret|password|passwd|token|apikey|authtoken|jwt|key)($|[_\-.])/i;

/**
 * Recursively redacts plain-object / array values whose keys look like
 * secrets. Returns non-plain values (Date, Buffer, Map, class instances)
 * unchanged so they aren't mangled into empty objects. A `WeakSet`
 * stops runaway recursion on circular references.
 */
export function redactSecrets(value: unknown, seen?: WeakSet<object>): unknown {
    if (value === null || typeof value !== 'object') return value;
    const proto = Object.getPrototypeOf(value);
    const isPlain = proto === Object.prototype || proto === null;
    const isArray = Array.isArray(value);
    if (!isPlain && !isArray) return value;
    const tracker = seen ?? new WeakSet<object>();
    if (tracker.has(value)) return '[CIRCULAR]';
    tracker.add(value);
    if (isArray) {
        return (value as unknown[]).map((v) => redactSecrets(v, tracker));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (SECRET_KEY_PATTERN.test(k)) {
            out[k] = '[REDACTED]';
        } else {
            out[k] = redactSecrets(v, tracker);
        }
    }
    return out;
}
