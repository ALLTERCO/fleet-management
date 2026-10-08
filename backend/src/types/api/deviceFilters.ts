// What a device list can be filtered by, and what matching means.
//
// Lives here, not beside the component, because the backend list and the
// devices page both answer 'does this device match'. They answered it twice,
// by hand, and disagreed: the page read groupIds off the row but tags and
// locations out of separate indexes, and mapped source through its own table.
// One rule, both tiers, reached through @api/*.

import type {DeviceSource} from './deviceSource';

/**
 * The shape every device kind is reduced to before filtering.
 *
 * Membership lives on the org tables rather than the device, so it is passed
 * in rather than read off the device object.
 */
export interface DeviceFilterView {
    shellyID: string;
    id: number | undefined;
    source: DeviceSource;
    /** Null when presence is unknown; a null never matches a filter. */
    presence: string | null;
    locationId: number | null;
    groupIds: readonly number[];
    tagIds: readonly number[];
    /** Hardware model. Every kind reports one. */
    model: string | null;
    /** The kind assigned to the device. Only physical devices carry one. */
    kind: string | null;
    /** Null where no profile is built (virtual, BLU), so the filter skips them
     *  rather than claiming false. */
    battery: boolean | null;
    /** Component types the device actually has, e.g. switch, em, light. */
    componentTypes: readonly string[];
}

/** Membership of a device, as the org tables hold it. */
export interface DeviceFilterMemberships {
    locationId: number | null;
    groupIds: readonly number[];
    tagIds: readonly number[];
}

export const NO_FILTER_MEMBERSHIPS: DeviceFilterMemberships = {
    locationId: null,
    groupIds: [],
    tagIds: []
};

/**
 * Singular on purpose: `groupId` asks "is it in this group", which is what a
 * list filter means. Plural would read as "in all of these" or "in any of
 * these" and the caller could not tell which.
 */
export const DEVICE_FILTER_KEYS = [
    'shellyID',
    'id',
    'source',
    'presence',
    'locationId',
    'groupId',
    'tagId',
    'model',
    'kind',
    'battery',
    'component'
] as const;

export type DeviceFilterKey = (typeof DEVICE_FILTER_KEYS)[number];

export function isPrimitiveFilterValue(
    value: unknown
): value is string | number | boolean {
    return ['string', 'number', 'boolean'].includes(typeof value);
}

function matchesOne(
    view: DeviceFilterView,
    key: string,
    value: string | number | boolean
): boolean {
    switch (key as DeviceFilterKey) {
        case 'shellyID':
            return view.shellyID === value;
        case 'id':
            return view.id === value;
        case 'source':
            return view.source === value;
        case 'presence':
            return view.presence === value;
        // A device sits in one location; it is in many groups and carries many
        // tags. Hence equality for one and membership for the others.
        case 'locationId':
            return view.locationId === value;
        case 'groupId':
            return view.groupIds.includes(value as number);
        case 'tagId':
            return view.tagIds.includes(value as number);
        case 'model':
            return view.model === value;
        case 'kind':
            return view.kind === value;
        case 'battery':
            return view.battery === value;
        // A device has many components, so this asks membership, like groupId.
        case 'component':
            return view.componentTypes.includes(value as string);
        default:
            return false;
    }
}

/**
 * Every supplied filter must match. Values that are not scalars are skipped,
 * the way they always were — `assertKnownDeviceFilters` is what stops a caller
 * silently getting an unfiltered list.
 */
export function deviceMatchesFilters(
    view: DeviceFilterView,
    filters: Record<string, unknown>
): boolean {
    for (const [key, value] of Object.entries(filters)) {
        if (!isPrimitiveFilterValue(value)) continue;
        if (!matchesOne(view, key, value)) return false;
    }
    return true;
}
