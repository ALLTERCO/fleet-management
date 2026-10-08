// A location with an address belongs in a real geography tree, so Fleet
// ensures the country/region/city chain above it. Existing nodes are adopted,
// never duplicated, and a location someone already placed by hand is left
// exactly where it is.

import {
    type BackfillGeographySummary,
    type GeographySkipReason,
    LOCATION_KINDS,
    type LocationKind,
    type LocationKindFields
} from '../../types/api/location';
import {cachedCountries, loadCountries} from '../geocoding/geocoding';
import {callMethod, queryRows} from '../PostgresProvider';
import {isValidCountryCode} from './isoData';
import {isValidParentage} from './kindDescriptors';
import {LOCATION_KIND_FIELD_SCHEMAS} from './kindSchemas';

/** The levels Fleet can derive from a postal address, shallowest first. */
type GeographyLevel = 'country' | 'region' | 'city';

export const DEFAULT_GEOGRAPHY_BATCH_SIZE = 50;

/** Only ever caps the reported list — the counts stay exact. */
const MAX_REPORTED_SKIPS = 20;

const UNIQUE_VIOLATION = '23505';

export interface GeographyAddress {
    countryCode?: unknown;
    region?: unknown;
    city?: unknown;
}

export interface GeographyTarget {
    organizationId: string;
    id: number;
    kind: LocationKind;
    parentLocationId: number | null;
    address: GeographyAddress | null;
}

export interface CreatedAncestor {
    id: number;
    name: string;
}

export interface EnsureGeographyResult {
    outcome: 'created' | 'adopted' | 'skipped';
    reason: GeographySkipReason | null;
    parentLocationId: number | null;
    createdAncestors: CreatedAncestor[];
}

export interface GeographyBackfillRequest {
    organizationId: string;
    batchSize: number;
    afterId: number;
}

export interface GeographyBackfillResult {
    summary: BackfillGeographySummary;
    createdAncestors: CreatedAncestor[];
}

/** Kinds that carry an address and may hang under a geography node. Derived
 *  from the kind schemas so a new kind cannot silently miss the backfill. */
export const GEOGRAPHY_BACKFILL_KINDS: readonly LocationKind[] =
    LOCATION_KINDS.filter(
        (kind) => hasAddressField(kind) && deepestLevelFor(kind) !== null
    );

/** Ensure the geography chain above one addressed location, then parent the
 *  location under the deepest node the chain reached. */
export async function ensureGeographyAncestors(
    target: GeographyTarget
): Promise<EnsureGeographyResult> {
    // Manual structure wins — a placed location is never moved.
    if (target.parentLocationId !== null) return skipped('already-parented');
    const address = readAddress(target.address);
    if (address.countryCode === null) return skipped('no-country-code');
    const levels = plannedLevels(target.kind, address);
    if (levels.length === 0) return skipped('kind-cannot-nest');

    const createdAncestors: CreatedAncestor[] = [];
    let parentId = 0;
    for (const level of levels) {
        const node =
            level === 'country'
                ? await ensureCountryNode(
                      target.organizationId,
                      address.countryCode
                  )
                : await ensureChildNode(
                      target.organizationId,
                      parentId,
                      level,
                      level === 'region'
                          ? (address.region ?? '')
                          : (address.city ?? '')
                  );
        if (node === null) {
            return {
                outcome: 'skipped',
                reason: 'name-taken-by-other-kind',
                parentLocationId: null,
                createdAncestors
            };
        }
        if (node.created !== null) createdAncestors.push(node.created);
        parentId = node.id;
    }

    const attached = await attachToParent(
        target.organizationId,
        target.id,
        parentId
    );
    if (!attached) {
        return {
            outcome: 'skipped',
            reason: 'already-parented',
            parentLocationId: null,
            createdAncestors
        };
    }
    return {
        outcome: createdAncestors.length > 0 ? 'created' : 'adopted',
        reason: null,
        parentLocationId: parentId,
        createdAncestors
    };
}

/** Run the chain across one page of an organization's addressed, parentless
 *  locations. Cursor-paginated on id so a permanently skipped row cannot
 *  stall a caller that loops until nextAfterId is null. */
export async function backfillGeographyBatch(
    req: GeographyBackfillRequest
): Promise<GeographyBackfillResult> {
    const rows = await loadPending(req);
    const summary: BackfillGeographySummary = {
        processed: 0,
        created: 0,
        adopted: 0,
        skipped: 0,
        nextAfterId: null,
        skips: []
    };
    const createdAncestors: CreatedAncestor[] = [];

    for (const row of rows) {
        summary.processed += 1;
        const result = await ensureGeographyAncestors({
            organizationId: req.organizationId,
            id: row.id,
            kind: row.kind,
            parentLocationId: row.parent_location_id,
            address: row.address
        });
        createdAncestors.push(...result.createdAncestors);
        summary[result.outcome] += 1;
        if (
            result.reason !== null &&
            summary.skips.length < MAX_REPORTED_SKIPS
        ) {
            summary.skips.push({locationId: row.id, reason: result.reason});
        }
    }

    const last = rows.at(-1);
    summary.nextAfterId =
        rows.length === req.batchSize && last !== undefined ? last.id : null;
    return {summary, createdAncestors};
}

// ---- chain construction -----------------------------------------------------

interface EnsuredNode {
    id: number;
    created: CreatedAncestor | null;
}

interface ExistingNode {
    id: number;
    kind: string;
}

async function ensureCountryNode(
    organizationId: string,
    countryCode: string
): Promise<EnsuredNode | null> {
    // A country code identifies the node better than its display name does.
    const byCode = await findCountryByCode(organizationId, countryCode);
    if (byCode !== null) return {id: byCode, created: null};

    const name = await countryName(countryCode);
    const lookup = () => findRootByName(organizationId, name);
    const existing = await lookup();
    if (existing !== null) return adopt(existing, 'country');
    return createNode(
        organizationId,
        null,
        'country',
        name,
        {countryCode},
        lookup
    );
}

async function ensureChildNode(
    organizationId: string,
    parentLocationId: number,
    kind: 'region' | 'city',
    name: string
): Promise<EnsuredNode | null> {
    const lookup = () =>
        findChildByName(organizationId, parentLocationId, name);
    const existing = await lookup();
    if (existing !== null) return adopt(existing, kind);
    return createNode(organizationId, parentLocationId, kind, name, {}, lookup);
}

// A name already taken by another kind is a human's structure, not ours.
function adopt(
    existing: ExistingNode,
    kind: GeographyLevel
): EnsuredNode | null {
    return existing.kind === kind ? {id: existing.id, created: null} : null;
}

async function createNode(
    organizationId: string,
    parentLocationId: number | null,
    kind: GeographyLevel,
    name: string,
    kindFields: LocationKindFields,
    lookup: () => Promise<ExistingNode | null>
): Promise<EnsuredNode | null> {
    try {
        const result = await callMethod('organization.fn_location_create', {
            p_organization_id: organizationId,
            p_name: name,
            p_kind: kind,
            p_parent_location_id: parentLocationId,
            p_sort_order: 0,
            p_kind_fields: kindFields,
            p_custom_fields: {}
        });
        const row = result?.rows?.[0] as {id: number; name: string} | undefined;
        if (row) {
            return {id: row.id, created: {id: row.id, name: row.name}};
        }
    } catch (err: unknown) {
        if (!isUniqueViolation(err)) throw err;
    }
    // A concurrent writer won the sibling-name index — adopt its row.
    const existing = await lookup();
    return existing === null ? null : adopt(existing, kind);
}

function isUniqueViolation(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        (err as {code?: unknown}).code === UNIQUE_VIOLATION
    );
}

// ---- database access --------------------------------------------------------

interface PendingRow {
    id: number;
    kind: LocationKind;
    parent_location_id: number | null;
    address: GeographyAddress | null;
}

async function loadPending(
    req: GeographyBackfillRequest
): Promise<PendingRow[]> {
    return queryRows<PendingRow>(
        `SELECT id, kind, parent_location_id, address
           FROM organization.locations
          WHERE organization_id = $1
            AND parent_location_id IS NULL
            AND NULLIF(address->>'countryCode', '') IS NOT NULL
            AND kind = ANY($2::text[])
            AND id > $3
          ORDER BY id
          LIMIT $4`,
        [
            req.organizationId,
            [...GEOGRAPHY_BACKFILL_KINDS],
            req.afterId,
            req.batchSize
        ]
    );
}

async function findCountryByCode(
    organizationId: string,
    countryCode: string
): Promise<number | null> {
    const rows = await queryRows<{id: number}>(
        `SELECT id
           FROM organization.locations
          WHERE organization_id = $1
            AND kind = 'country'
            AND upper(country_code) = $2
          ORDER BY id
          LIMIT 1`,
        [organizationId, countryCode]
    );
    return rows[0]?.id ?? null;
}

async function findRootByName(
    organizationId: string,
    name: string
): Promise<ExistingNode | null> {
    const rows = await queryRows<ExistingNode>(
        `SELECT id, kind
           FROM organization.locations
          WHERE organization_id = $1
            AND parent_location_id IS NULL
            AND lower(name) = lower($2)
          LIMIT 1`,
        [organizationId, name]
    );
    return rows[0] ?? null;
}

async function findChildByName(
    organizationId: string,
    parentLocationId: number,
    name: string
): Promise<ExistingNode | null> {
    const rows = await queryRows<ExistingNode>(
        `SELECT id, kind
           FROM organization.locations
          WHERE organization_id = $1
            AND parent_location_id = $2
            AND lower(name) = lower($3)
          LIMIT 1`,
        [organizationId, parentLocationId, name]
    );
    return rows[0] ?? null;
}

async function attachToParent(
    organizationId: string,
    id: number,
    parentLocationId: number
): Promise<boolean> {
    // The IS NULL guard is the lock: a location parented between our read and
    // this write keeps the placement a human gave it.
    const rows = await queryRows<{id: number}>(
        `UPDATE organization.locations
            SET parent_location_id = $3,
                updated_at = NOW()
          WHERE organization_id = $1
            AND id = $2
            AND parent_location_id IS NULL
      RETURNING id`,
        [organizationId, id, parentLocationId]
    );
    return rows.length > 0;
}

async function countryName(countryCode: string): Promise<string> {
    const countries = cachedCountries() ?? (await loadCountries());
    const match = countries.find((c) => c.iso2 === countryCode);
    return match?.name ?? countryCode;
}

// ---- address reading --------------------------------------------------------

interface ResolvedAddress {
    countryCode: string | null;
    region: string | null;
    city: string | null;
}

function readAddress(address: GeographyAddress | null): ResolvedAddress {
    const raw = text(address?.countryCode)?.toUpperCase() ?? null;
    return {
        countryCode: raw !== null && isValidCountryCode(raw) ? raw : null,
        region: text(address?.region),
        city: text(address?.city)
    };
}

function text(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// Levels the address supplies, trimmed to what this kind may hang under, so a
// building never lands straight beneath a city.
function plannedLevels(
    kind: LocationKind,
    address: ResolvedAddress
): GeographyLevel[] {
    const levels: GeographyLevel[] = ['country'];
    if (address.region !== null) levels.push('region');
    if (address.city !== null) levels.push('city');
    while (levels.length > 0) {
        const deepest = levels.at(-1);
        if (deepest !== undefined && isValidParentage(kind, deepest)) break;
        levels.pop();
    }
    return levels;
}

function deepestLevelFor(kind: LocationKind): GeographyLevel | null {
    const levels: GeographyLevel[] = ['city', 'region', 'country'];
    return levels.find((level) => isValidParentage(kind, level)) ?? null;
}

function hasAddressField(kind: LocationKind): boolean {
    const schema = LOCATION_KIND_FIELD_SCHEMAS[kind] as {
        properties?: Record<string, unknown>;
    };
    return Object.hasOwn(schema.properties ?? {}, 'address');
}

function skipped(reason: GeographySkipReason): EnsureGeographyResult {
    return {
        outcome: 'skipped',
        reason,
        parentLocationId: null,
        createdAncestors: []
    };
}
