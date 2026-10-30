import {DEVICE_TYPES, type DeviceType} from '@/helpers/deviceTypeFilter';

export type DeviceSortMode =
    | 'online-az'
    | 'az'
    | 'za'
    | 'offline-first';

export interface DeviceFilterPersistenceState {
    nameFilter: string;
    sortMode: DeviceSortMode;
    statusFilter: string[];
    typeFilter: string[];
    groupFilter: string[];
    tagFilter: string[];
    sourceFilter: DeviceType[];
    locationFilter: string[];
    legacyGroupName: string | null;
}

const SORT_MODES = new Set<DeviceSortMode>([
    'online-az',
    'az',
    'za',
    'offline-first'
]);
const STATUS_FILTERS = new Set(['true', 'false']);
const SOURCE_FILTERS = new Set<string>(DEVICE_TYPES);

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function valuesOf(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    return value == null ? [] : [value];
}

function uniqueStrings(value: unknown): string[] {
    const out = new Set<string>();
    for (const item of valuesOf(value)) {
        if (typeof item === 'string' && item.length > 0) out.add(item);
    }
    return [...out];
}

function enumStrings(value: unknown, allowed: ReadonlySet<string>): string[] {
    return uniqueStrings(value).filter((item) => allowed.has(item));
}

function idStrings(value: unknown): string[] {
    const out = new Set<string>();
    for (const item of valuesOf(value)) {
        if (typeof item !== 'string' && typeof item !== 'number') continue;
        const id = Number(item);
        if (Number.isSafeInteger(id) && id > 0) out.add(String(id));
    }
    return [...out];
}

export function parseDeviceSortMode(value: unknown): DeviceSortMode | null {
    return typeof value === 'string' && SORT_MODES.has(value as DeviceSortMode)
        ? (value as DeviceSortMode)
        : null;
}

function legacyTypeFilter(value: unknown): string[] {
    return typeof value === 'string' &&
        value.length > 0 &&
        value !== 'All devices'
        ? [value]
        : [];
}

function legacyStatusFilter(value: unknown): string[] {
    return typeof value === 'boolean' ? [String(value)] : [];
}

function legacyGroupName(value: unknown): string | null {
    return typeof value === 'string' &&
        value.length > 0 &&
        value !== 'All groups'
        ? value
        : null;
}

export function decodeDeviceFilterState(
    value: unknown
): DeviceFilterPersistenceState {
    const saved = asRecord(value);
    const hasStatusFilter = Object.hasOwn(saved, 'statusFilter');
    const hasTypeFilter = Object.hasOwn(saved, 'typeFilter');
    const hasGroupFilter = Object.hasOwn(saved, 'groupFilter');

    return {
        nameFilter:
            typeof saved.nameFilter === 'string' ? saved.nameFilter : '',
        sortMode: parseDeviceSortMode(saved.sortMode) ?? 'online-az',
        statusFilter: hasStatusFilter
            ? enumStrings(saved.statusFilter, STATUS_FILTERS)
            : legacyStatusFilter(saved.online),
        typeFilter: hasTypeFilter
            ? uniqueStrings(saved.typeFilter)
            : legacyTypeFilter(saved.type),
        groupFilter: hasGroupFilter ? idStrings(saved.groupFilter) : [],
        tagFilter: idStrings(saved.tagFilter),
        sourceFilter: enumStrings(
            saved.sourceFilter,
            SOURCE_FILTERS
        ) as DeviceType[],
        locationFilter: idStrings(saved.locationFilter),
        legacyGroupName: hasGroupFilter
            ? null
            : legacyGroupName(saved.group)
    };
}

export function parseDeviceFilterState(
    raw: string | null
): DeviceFilterPersistenceState {
    if (!raw) return decodeDeviceFilterState(null);
    try {
        return decodeDeviceFilterState(JSON.parse(raw));
    } catch {
        return decodeDeviceFilterState(null);
    }
}

export function resolveLegacyGroupId(
    name: string,
    groups: readonly {id: number; name: string}[]
): string | null {
    const match = groups.find((group) => group.name === name);
    return match ? String(match.id) : null;
}
