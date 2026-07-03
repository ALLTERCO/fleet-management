// Reduce dashboard rows to those whose device matches the selected device
// types. Pure — pass each item's type; the helper decides. Layers on top of
// scope so the type filter behaves the same on every dashboard.

export type DeviceType = 'physical' | 'bluetooth' | 'virtual';

// The full set — single source for both the filter UI and the "all selected
// means no filter" short-circuit below.
export const DEVICE_TYPES: readonly DeviceType[] = [
    'physical',
    'bluetooth',
    'virtual'
];

// User-facing labels — SSOT for the devices filter and the dashboard chips.
export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
    physical: 'Physical',
    bluetooth: 'BLU',
    virtual: 'Virtual'
};

// device.source values map onto the three user-facing types.
const SOURCE_TO_TYPE: Record<string, DeviceType> = {
    shelly: 'physical',
    bluetooth: 'bluetooth',
    virtual: 'virtual'
};

// A device with no (or legacy) source is a physical Shelly.
export function deviceTypeOf(source: string | null | undefined): DeviceType {
    return source ? (SOURCE_TO_TYPE[source] ?? 'physical') : 'physical';
}

// Empty or full selection means "no filter" — return the input untouched.
export function filterByDeviceType<T>(
    items: readonly T[],
    typeOf: (item: T) => DeviceType,
    selected: ReadonlySet<DeviceType>
): readonly T[] {
    if (selected.size === 0 || selected.size >= DEVICE_TYPES.length) {
        return items;
    }
    return items.filter((item) => selected.has(typeOf(item)));
}

// True if any source is in the selected classes (empty/full = match all).
export function holdsSelectedClass(
    sources: Iterable<string | null | undefined>,
    selected: ReadonlySet<DeviceType>
): boolean {
    if (selected.size === 0 || selected.size >= DEVICE_TYPES.length) {
        return true;
    }
    for (const source of sources) {
        if (selected.has(deviceTypeOf(source))) return true;
    }
    return false;
}
