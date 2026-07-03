// Normalize a DB timestamp (Date or already-ISO string) to an ISO string.

export function iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
}

export function isoOrNull(value: Date | string | null): string | null {
    return value === null ? null : iso(value);
}
