// Shared types and schema primitives for the group_kind catalog. A leaf module
// so the structural catalog (groupKindCatalog) and the bulk consumer list
// (groupKindConsumers) both depend on it without importing each other.

import type {JsonSchema} from '../types/api/_schema';
import type {KindMetricDef} from '../types/api/rollup';

export interface GroupKindDefinition {
    id: string;
    displayName: string;
    description: string;
    category: GroupKindCategory;
    icon: string;
    metadataSchema: JsonSchema;
    sortOrder: number;
    /**
     * Rolled-up metrics this kind exposes: a parent total/peak/etc. declared as
     * a formula over child or component-instance values. Evaluated by
     * rollupEvaluator. Absent = the kind exposes no aggregate metrics.
     */
    metrics?: readonly KindMetricDef[];
    /**
     * Which axis this kind can classify. Absent = 'group' (safe default): most
     * catalog entries are pure collections (zones, loops, hierarchies) that
     * never describe a single device. Set 'both' on kinds that may also tag an
     * individual device (e.g. circuit, meter, breaker).
     */
    appliesTo?: 'device' | 'group' | 'both';
}

export type GroupKindCategory =
    | 'general'
    | 'electrical'
    | 'building'
    | 'industrial'
    | 'property'
    | 'retail'
    | 'solar'
    | 'renewables'
    | 'energy_storage'
    | 'ev'
    | 'datacenter'
    | 'residential'
    | 'healthcare'
    | 'education'
    | 'hospitality'
    | 'water_utility'
    | 'telecom'
    | 'agriculture'
    | 'transportation'
    | 'smart_city'
    | 'logistics'
    | 'public_safety'
    | 'stadium_sports'
    | 'mining'
    | 'marine_offshore'
    | 'mass_transit'
    | 'entertainment'
    | 'film_media'
    | 'childcare'
    | 'beauty_wellness'
    | 'automotive'
    | 'convenience_service'
    | 'asset_mgmt'
    | 'sustainability';

// Strict, no-property schema shared by simple kinds that carry no metadata.
export const SCHEMA_EMPTY: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};
