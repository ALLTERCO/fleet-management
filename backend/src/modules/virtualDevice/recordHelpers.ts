export function recordAt(
    value: Record<string, unknown>,
    key: string
): Record<string, unknown> {
    return recordValue(value[key]) ?? {};
}

export function recordValue(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

export function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
