export type MonitoringRecord = Record<string, unknown>;

export const REDACTED = '[redacted]';

const SECRET_KEY_PATTERNS = [
    /secret/i,
    /password/i,
    /passwd/i,
    /token/i,
    /private[_-]?key/i,
    /connection[_-]?string/i,
    /database[_-]?url/i,
    /db[_-]?url/i,
    /dsn/i,
    /authorization/i,
    /cookie/i
];

export function redactMonitoringPayload(value: unknown): unknown {
    return redactValue(value, new WeakSet<object>());
}

export function redactMonitoringField(key: string, value: unknown): unknown {
    return shouldRedactMonitoringKey(key)
        ? REDACTED
        : redactMonitoringPayload(value);
}

export function shouldRedactMonitoringKey(key: string): boolean {
    return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
    if (Array.isArray(value)) return value.map((entry) => redactValue(entry, seen));
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const out: MonitoringRecord = {};
    for (const [key, entry] of Object.entries(value as MonitoringRecord)) {
        out[key] = shouldRedactMonitoringKey(key)
            ? REDACTED
            : redactValue(entry, seen);
    }
    return out;
}
