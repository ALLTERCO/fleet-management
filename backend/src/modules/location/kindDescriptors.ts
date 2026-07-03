// Frontend-consumable descriptors so the Location form renders itself
// based on the selected kind — fields, labels, option sets, parent
// constraints, which fields cascade down the tree.

import type {LocationKind} from '../../types/api/location';
import {
    FIELD_GROUP_ORDER,
    type FieldDescriptor,
    type FieldGroup,
    fieldMetaFor
} from './fieldMeta';
import {LOCATION_KIND_FIELD_SCHEMAS} from './kindSchemas';
import {allOptionSetDescriptors, type OptionSetDescriptor} from './optionSets';

export interface LocationKindDescriptor {
    kind: LocationKind;
    label: string;
    /** Kinds that may be this kind's parent. Empty = root only. */
    allowedParents: readonly LocationKind[];
    /** True if this kind may sit at the root of the tree (no parent). */
    allowRoot: boolean;
    /** Rich per-field metadata — label/description/widget/group/optionSet/unit. */
    fields: readonly FieldDescriptor[];
    /** Which of the above fields inherit from the parent chain when unset. */
    inheritableFields: readonly string[];
    /** Relative nesting rank — higher = deeper. Used for sort + validation. */
    sortRank: number;
}

/** Fields that cascade down the tree (child inherits if unset). */
const INHERITABLE = [
    'timezone',
    'countryCode',
    'currency',
    'regulatoryZone',
    'address',
    'complianceTags'
] as const;

function inheritablesAmong(fields: readonly string[]): string[] {
    return fields.filter((f) => (INHERITABLE as readonly string[]).includes(f));
}

function fieldsOf(kind: LocationKind): string[] {
    const schema = LOCATION_KIND_FIELD_SCHEMAS[kind];
    const props =
        (schema as {properties?: Record<string, unknown>}).properties ?? {};
    return Object.keys(props).filter((k) => k !== 'customFields');
}

const GROUP_RANK: Readonly<Record<FieldGroup, number>> = Object.freeze(
    Object.fromEntries(FIELD_GROUP_ORDER.map((g, i) => [g, i])) as Record<
        FieldGroup,
        number
    >
);

function enrichFields(keys: readonly string[]): FieldDescriptor[] {
    return keys
        .map((k) => fieldMetaFor(k))
        .sort((a, b) => {
            const dg = GROUP_RANK[a.group] - GROUP_RANK[b.group];
            return dg !== 0 ? dg : a.label.localeCompare(b.label);
        });
}

export const LOCATION_KIND_DESCRIPTORS: readonly LocationKindDescriptor[] =
    Object.freeze([
        descriptor('continent', 'Continent', [], true, 0),
        descriptor('country', 'Country', ['continent'], true, 10),
        descriptor('region', 'Region / State', ['country'], false, 20),
        descriptor('county', 'County', ['region', 'country'], false, 30),
        descriptor('city', 'City', ['county', 'region', 'country'], false, 40),
        descriptor('neighborhood', 'Neighborhood', ['city'], false, 50),
        descriptor(
            'campus',
            'Campus',
            ['city', 'neighborhood', 'region', 'country'],
            true,
            60
        ),
        descriptor(
            'site',
            'Site',
            ['campus', 'city', 'neighborhood', 'region', 'country'],
            true,
            70
        ),
        descriptor('building', 'Building', ['site', 'campus'], true, 80),
        descriptor(
            'office',
            'Office / Suite',
            ['building', 'floor'],
            false,
            85
        ),
        descriptor('floor', 'Floor', ['building', 'office'], false, 90),
        descriptor('area', 'Area / Wing', ['floor'], false, 95),
        descriptor('room', 'Room', ['floor', 'area', 'office'], false, 100),
        descriptor('zone', 'Zone', ['room', 'area', 'floor'], false, 110)
    ] as const);

function descriptor(
    kind: LocationKind,
    label: string,
    allowedParents: readonly LocationKind[],
    allowRoot: boolean,
    sortRank: number
): LocationKindDescriptor {
    const fieldKeys = fieldsOf(kind);
    return Object.freeze({
        kind,
        label,
        allowedParents,
        allowRoot,
        fields: Object.freeze(
            enrichFields(fieldKeys)
        ) as readonly FieldDescriptor[],
        inheritableFields: Object.freeze(
            inheritablesAmong(fieldKeys)
        ) as readonly string[],
        sortRank
    });
}

const DESCRIPTOR_BY_KIND: Readonly<
    Record<LocationKind, LocationKindDescriptor>
> = Object.freeze(
    Object.fromEntries(
        LOCATION_KIND_DESCRIPTORS.map((d) => [d.kind, d])
    ) as Record<LocationKind, LocationKindDescriptor>
);

export function descriptorFor(kind: LocationKind): LocationKindDescriptor {
    return DESCRIPTOR_BY_KIND[kind];
}

/** Check that a parent kind is permitted for the child kind. Root (null
 *  parent) is permitted iff the child declares `allowRoot`. */
export function isValidParentage(
    childKind: LocationKind,
    parentKind: LocationKind | null
): boolean {
    const d = descriptorFor(childKind);
    if (parentKind === null) return d.allowRoot;
    return d.allowedParents.includes(parentKind);
}

/** Full payload for the Location.ListKinds RPC — ships descriptors +
 *  option-set snapshots in one round-trip. */
export interface LocationKindsDescribeResponse {
    kinds: readonly LocationKindDescriptor[];
    optionSets: Record<string, OptionSetDescriptor>;
}

export function buildKindsDescribeResponse(): LocationKindsDescribeResponse {
    return {
        kinds: LOCATION_KIND_DESCRIPTORS,
        optionSets: allOptionSetDescriptors()
    };
}
