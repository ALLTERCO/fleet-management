// A registration's row read is current only if no access change for the device
// reached this process while the read was in flight: a peer's deny signal can
// be handled before the read's own answer. No imports: the device factory and
// the trust cache both reach it.

export interface AccessChangeWatch {
    readonly externalId: string;
    changed: boolean;
}

// Entries live only while a registration read is in flight, so the map stays
// bounded by concurrent registrations.
const watches = new Map<string, Set<AccessChangeWatch>>();

export function watchAccessChange(externalId: string): AccessChangeWatch {
    const watch: AccessChangeWatch = {externalId, changed: false};
    const set = watches.get(externalId) ?? new Set();
    set.add(watch);
    watches.set(externalId, set);
    return watch;
}

export function endAccessChangeWatch(watch: AccessChangeWatch): void {
    const set = watches.get(watch.externalId);
    if (!set) return;
    set.delete(watch);
    if (set.size === 0) watches.delete(watch.externalId);
}

export function noteAccessChange(externalId: string): void {
    for (const watch of watches.get(externalId) ?? []) watch.changed = true;
}
