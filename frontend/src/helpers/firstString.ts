// Returns the first non-empty string in the list, or null. Guards Vue
// interpolation against unexpected non-string values bubbling up from
// `Record<string, any>` props (which otherwise render as [object Object]).

export function firstString(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return null;
}
