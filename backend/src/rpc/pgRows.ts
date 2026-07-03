/** Shared row→entity mapping helpers used across api components. */

export function toIso(v: Date | string | null | undefined): string | null {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString();
    const parsed = new Date(v);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}
