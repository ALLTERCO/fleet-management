export function allSelectionScopeSelected(
    selected: ReadonlySet<string>,
    scope: readonly string[]
): boolean {
    return scope.length > 0 && scope.every((id) => selected.has(id));
}

export function toggleSelectionScope(
    selected: readonly string[],
    scope: readonly string[]
): string[] {
    const next = new Set(selected);
    const remove = allSelectionScopeSelected(next, scope);
    for (const id of scope) {
        if (remove) next.delete(id);
        else next.add(id);
    }
    return [...next];
}
