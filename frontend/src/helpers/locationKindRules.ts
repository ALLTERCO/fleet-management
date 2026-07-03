/** Per-parent-kind default child-kind table.
 *
 *  When the user clicks `⊕` on a tree row we pick a sensible child kind
 *  from this lookup so they can submit with one keystroke. The user can
 *  still change it via the quick-create popover or the full Edit modal.
 *
 *  Lookup-table beats a switch: additive, flat, and easy to scan when
 *  adding a new kind. */

import type {LocationKind} from '@/stores/locations';

const CHILD_KIND: Partial<Record<LocationKind, LocationKind>> = {
    continent: 'country',
    country: 'region',
    region: 'city',
    city: 'site',
    campus: 'building',
    site: 'building',
    building: 'floor',
    office: 'room',
    floor: 'room',
    area: 'zone',
    room: 'zone'
};

const DEFAULT_CHILD_KIND: LocationKind = 'site';

export function childKindFor(parentKind: LocationKind): LocationKind {
    return CHILD_KIND[parentKind] ?? DEFAULT_CHILD_KIND;
}
