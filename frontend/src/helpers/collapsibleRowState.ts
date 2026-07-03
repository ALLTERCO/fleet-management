// Maintain a set of "open" ids across changes to the row list:
//   - new ids inherit `defaultExpanded`
//   - existing ids preserve their last user choice
// Pure — used by DashRowRepeat and any future repeater.

export function reseedOpenIds(
    nextIds: readonly string[],
    knownIds: ReadonlySet<string>,
    currentOpen: ReadonlySet<string>,
    defaultExpanded: boolean
): ReadonlySet<string> {
    const next = new Set<string>();
    for (const id of nextIds) {
        const isNew = !knownIds.has(id);
        if (isNew ? defaultExpanded : currentOpen.has(id)) next.add(id);
    }
    return next;
}
