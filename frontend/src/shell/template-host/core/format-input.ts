// The loose inputs both formatting layers accept, coerced once. This lives in
// core because template-host may never import Fleet code, while the app is
// free to import core: one copy, and the one-way ban stays intact.

export type TimestampInput = number | string | Date;

export function toMs(input: TimestampInput): number {
    if (typeof input === 'number') return input;
    if (input instanceof Date) return input.getTime();
    return new Date(input).getTime();
}

// A BCP-47 tag, or undefined for "let Intl pick the browser's own locale".
// Intl.getCanonicalLocales rejects a malformed tag by throwing, which is
// exactly the "unknown tag" case this treats the same as unset.
export function canonicalRegion(
    tag: string | null | undefined
): string | undefined {
    if (!tag) return undefined;
    try {
        return Intl.getCanonicalLocales(tag).length > 0 ? tag : undefined;
    } catch {
        return undefined;
    }
}
