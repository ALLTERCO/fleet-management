interface GroupLike {
    devices: readonly string[];
}

// Union of every shelly-ID listed under any of the given groups.
// Missing group ids are skipped silently — caller may pass a sparse list
// (e.g. UI filter chips can include ids the store hasn't loaded yet).
export function shellyIdsFromGroups(
    groupIds: readonly number[],
    groupsById: Record<number, GroupLike | undefined>
): Set<string> {
    const ids = new Set<string>();
    for (const gid of groupIds) {
        const group = groupsById[gid];
        if (!group) continue;
        for (const id of group.devices) ids.add(id);
    }
    return ids;
}
