// The alert-rule signal picker: which signals a rule can watch, narrowed to
// the devices the rule names.
//
// The catalog RPC answers per device, so the picker asks once per scoped
// device and keeps the owner on each row. Grouping by owner is what turns a
// flat list of component keys into "these are your kitchen door's signals".
// Pure functions so the modal holds the wiring and nothing else.

import type {AlertComponentPath} from '@api/alert';

/** A catalog signal plus the device it was read from, when the rule names one. */
export interface ScopedComponentPath extends AlertComponentPath {
    deviceId?: string;
    deviceName?: string;
}

export interface SignalGroup {
    /** Owning device id, or '' for the fleet-wide list. */
    key: string;
    /** Device name; empty when the list is not device-scoped. */
    label: string;
    paths: ScopedComponentPath[];
}

export interface SignalFilter {
    kind: 'metric' | 'state' | null;
    search: string;
}

/** Stamps a device's signals with their owner so the grid can name it. */
export function tagPathsWithDevice(
    paths: readonly AlertComponentPath[],
    device: {id: string; name: string}
): ScopedComponentPath[] {
    return paths.map((path) => ({
        ...path,
        deviceId: device.id,
        deviceName: device.name
    }));
}

/** Signals of the wanted kind that match the search text. */
export function filterSignals(
    paths: readonly ScopedComponentPath[],
    filter: SignalFilter
): ScopedComponentPath[] {
    if (!filter.kind) return [];
    const ofKind = paths.filter((path) => path.kind === filter.kind);
    const needle = filter.search.trim().toLowerCase();
    if (!needle) return ofKind;
    return ofKind.filter((path) => searchText(path).includes(needle));
}

/** Groups signals under their owning device, keeping first-seen order. */
export function groupSignalsByDevice(
    paths: readonly ScopedComponentPath[]
): SignalGroup[] {
    const groups = new Map<string, SignalGroup>();
    for (const path of paths) {
        const key = path.deviceId ?? '';
        const group = groups.get(key);
        if (group) {
            group.paths.push(path);
            continue;
        }
        groups.set(key, {key, label: path.deviceName ?? '', paths: [path]});
    }
    return [...groups.values()];
}

/** Says whose signals these are, so the list is never a fleet-wide mystery. */
export function describeSignalSource(deviceCount: number): string {
    if (deviceCount === 0) return 'every device';
    return deviceCount === 1 ? '1 device' : `${deviceCount} devices`;
}

/** Explains an empty grid in terms of what the user actually did. */
export function explainNoSignals(input: {
    search: string;
    deviceCount: number;
}): string {
    if (input.search.trim()) return 'No signal matches that search.';
    if (input.deviceCount > 0) {
        return 'The devices you picked do not report a signal of this shape.';
    }
    return 'No device in this fleet reports a signal of this shape yet.';
}

/** A stable set key, so re-emitting the same devices does not refetch. */
export function scopeKeyOf(deviceIds: readonly string[]): string {
    return [...deviceIds].sort().join(',');
}

function searchText(path: ScopedComponentPath): string {
    return [
        path.label ?? '',
        path.deviceName ?? '',
        path.component,
        path.field,
        path.deviceClass ?? ''
    ]
        .join(' ')
        .toLowerCase();
}
