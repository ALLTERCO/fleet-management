// Personal Access Token boundary-scope display helpers. The scope object
// is stored as JSON on the PAT; UI needs a one-line summary for list rows.

// Answer — short summary string for the PAT row. Empty/absent scope means
// the token has no boundary restriction so it reads as 'all'.
// Arrays render their length to avoid blowing up the table cell when the
// scope lists 200 device ids.
export function formatBoundaryScope(
    scope: Record<string, unknown> | undefined | null
): string {
    if (!scope || Object.keys(scope).length === 0) return 'all';
    return Object.entries(scope)
        .map(([key, value]) =>
            Array.isArray(value)
                ? `${key}=[${value.length}]`
                : `${key}=${String(value)}`
        )
        .join(' · ');
}
