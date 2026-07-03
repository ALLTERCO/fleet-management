// Lenient readers for untrusted notification-bundle JSON. readKey/readName
// define the bundle's id/name identity used by both plan and apply.

export function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readObjects(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return [];
    return value.filter(
        (entry): entry is Record<string, unknown> =>
            !!entry && typeof entry === 'object' && !Array.isArray(entry)
    );
}

export function readKey(record: Record<string, unknown>): string {
    return readString(record.id) ?? readString(record.name) ?? '<unknown>';
}

export function readName(
    record: Record<string, unknown>,
    fallback: string
): string {
    return readString(record.name) ?? fallback;
}
