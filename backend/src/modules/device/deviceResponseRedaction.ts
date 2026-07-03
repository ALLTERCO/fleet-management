import {redactCredentialUrl} from '../deviceIngress/redaction';

const REDACTED = '[REDACTED]';
const SECRET_KEY_RE = /authorization|password|passwd|secret|token|api[_-]?key/i;

export function redactDeviceResponseSecrets<T>(value: T): T {
    return redactValue(value, '') as T;
}

function redactValue(value: unknown, key: string): unknown {
    if (typeof value === 'string') return redactString(value, key);
    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item, key));
    }
    if (!value || typeof value !== 'object') return value;
    return redactRecord(value as Record<string, unknown>);
}

function redactRecord(
    record: Record<string, unknown>
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
        out[key] = redactValue(value, key);
    }
    return out;
}

function redactString(value: string, key: string): string {
    if (SECRET_KEY_RE.test(key)) return REDACTED;
    return redactCredentialUrl(value);
}
