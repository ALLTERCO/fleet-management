/** Shared factories for FilterModal sections — one source of truth. */

import {LOCATION_KIND_LABELS, type LocationKind} from '@api/location';
import {DEVICE_TYPE_LABELS, type DeviceType} from '@/helpers/deviceTypeFilter';
import type {FilterOption, FilterSection} from '@/helpers/filter-modal-types';

export function countByKey<T, K extends string | number>(
    items: readonly T[],
    key: (item: T) => K
): Map<K, number> {
    const map = new Map<K, number>();
    for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + 1);
    return map;
}

function toOptions<K extends string | number>(
    entries: Map<K, number>,
    toLabel: (k: K) => string = (k) => String(k)
): FilterOption[] {
    return Array.from(entries.entries()).map(([k, count]) => ({
        key: String(k),
        label: toLabel(k),
        count
    }));
}

export interface NamedItem {
    id: number | string;
    name: string;
}

export function severitySection(counts: Map<string, number>): FilterSection {
    return {
        key: 'severity',
        label: 'Severity',
        icon: 'fa-triangle-exclamation',
        options: [
            {
                key: 'critical',
                label: 'Critical',
                count: counts.get('critical') ?? 0
            },
            {
                key: 'warning',
                label: 'Warning',
                count: counts.get('warning') ?? 0
            },
            {key: 'info', label: 'Info', count: counts.get('info') ?? 0}
        ]
    };
}

export function booleanSection(
    key: string,
    label: string,
    icon: string,
    trueLabel: string,
    falseLabel: string,
    trueCount: number,
    falseCount: number
): FilterSection {
    return {
        key,
        label,
        icon,
        singleSelect: true,
        options: [
            {key: 'true', label: trueLabel, count: trueCount},
            {key: 'false', label: falseLabel, count: falseCount}
        ]
    };
}

export function namedSection(
    key: string,
    label: string,
    icon: string,
    items: readonly NamedItem[],
    counts?: Map<number | string, number>
): FilterSection {
    return {
        key,
        label,
        icon,
        searchable: items.length > 6,
        options: items.map((item) => ({
            key: String(item.id),
            label: item.name,
            count: counts?.get(item.id)
        }))
    };
}

export function tagSection(
    tags: readonly NamedItem[],
    counts?: Map<number | string, number>
): FilterSection {
    return namedSection('tag', 'Tags', 'fa-tag', tags, counts);
}

export function groupSection(
    groups: readonly NamedItem[],
    counts?: Map<number | string, number>
): FilterSection {
    return namedSection('group', 'Groups', 'fa-folder-tree', groups, counts);
}

export function deviceSection(
    devices: readonly NamedItem[],
    counts?: Map<number | string, number>
): FilterSection {
    return namedSection('device', 'Devices', 'fa-microchip', devices, counts);
}

export function componentSection(
    components: readonly NamedItem[],
    counts?: Map<number | string, number>
): FilterSection {
    return namedSection(
        'component',
        'Components',
        'fa-cube',
        components,
        counts
    );
}

export function locationSection(
    locations: readonly NamedItem[],
    counts?: Map<number | string, number>
): FilterSection {
    return namedSection(
        'location',
        'Locations',
        'fa-location-dot',
        locations,
        counts
    );
}

const LOCATION_KIND_ICONS: Record<LocationKind, string> = {
    continent: 'fa-earth-europe',
    country: 'fa-flag',
    region: 'fa-map',
    county: 'fa-map',
    city: 'fa-city',
    neighborhood: 'fa-map-pin',
    campus: 'fa-university',
    site: 'fa-industry',
    building: 'fa-building',
    office: 'fa-briefcase',
    floor: 'fa-layer-group',
    area: 'fa-vector-square',
    room: 'fa-door-open',
    zone: 'fa-draw-polygon'
};

export interface KindedLocation extends NamedItem {
    id: number;
    kind: LocationKind;
}

/** One section per kind (key: `location-<kind>`) so selections merge cleanly. */
export function locationSectionsByKind(
    locations: readonly KindedLocation[],
    counts?: Map<number, number>
): FilterSection[] {
    const byKind = new Map<LocationKind, KindedLocation[]>();
    for (const loc of locations) {
        const bucket = byKind.get(loc.kind);
        if (bucket) bucket.push(loc);
        else byKind.set(loc.kind, [loc]);
    }
    const sections: FilterSection[] = [];
    for (const kind of Object.keys(LOCATION_KIND_LABELS) as LocationKind[]) {
        const items = byKind.get(kind);
        if (!items || items.length === 0) continue;
        sections.push({
            key: `location-${kind}`,
            label: LOCATION_KIND_LABELS[kind],
            icon: LOCATION_KIND_ICONS[kind],
            searchable: items.length > 6,
            options: items
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((item) => ({
                    key: String(item.id),
                    label: item.name,
                    count: counts?.get(item.id)
                }))
        });
    }
    return sections;
}

/** Flatten a state record into the set of location ids selected across all kinds. */
export function locationIdsFromState(
    state: Record<string, string[]>
): Set<number> {
    const out = new Set<number>();
    for (const [key, values] of Object.entries(state)) {
        if (!key.startsWith('location-')) continue;
        for (const v of values) {
            const n = Number(v);
            if (Number.isFinite(n)) out.add(n);
        }
    }
    return out;
}

/** Spread a flat set of selected location ids back into per-kind state entries. */
export function locationStateByKind(
    locationIds: readonly (number | string)[],
    locations: readonly KindedLocation[]
): Record<string, string[]> {
    const selected = new Set(locationIds.map((v) => Number(v)));
    const out: Record<string, string[]> = {};
    for (const loc of locations) {
        if (!selected.has(loc.id)) continue;
        (out[`location-${loc.kind}`] ??= []).push(String(loc.id));
    }
    return out;
}

export function enumSection<K extends string | number>(
    key: string,
    label: string,
    icon: string,
    counts: Map<K, number>,
    labelFor: (k: K) => string = (k) => String(k)
): FilterSection {
    return {
        key,
        label,
        icon,
        searchable: counts.size > 6,
        options: toOptions(counts, labelFor)
    };
}

// SSOT device-class section; page supplies per-class counts (key 'source').
export function deviceClassSection(
    counts: Map<DeviceType, number>
): FilterSection {
    return enumSection(
        'source',
        'Class',
        'fa-shapes',
        counts,
        (k) => DEVICE_TYPE_LABELS[k]
    );
}
