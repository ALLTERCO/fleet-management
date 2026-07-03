import type {BackfillGeoSummary} from '../../types/api/location';
import {searchPlaces} from '../geocoding/searchPlaces';
import {queryRows} from '../PostgresProvider';

const DEFAULT_BATCH_SIZE = 20;
const STRONG_MATCH_THRESHOLD = 0.7;

export interface BackfillRequest {
    organizationId: string;
    batchSize: number;
    forceRefresh: boolean;
}

interface PendingLocation {
    id: number;
    name: string;
    country_code: string | null;
    region: string | null;
    city: string | null;
}

export async function backfillGeoBatch(
    req: BackfillRequest
): Promise<BackfillGeoSummary> {
    const pending = await loadPending(req);
    const summary = emptySummary(0);
    for (const row of pending) {
        await processOne(row, summary);
    }
    // Recount after the work: a pre-count minus updates lies when
    // concurrent backfills interleave.
    summary.remaining = await countPending(req);
    return summary;
}

async function loadPending(req: BackfillRequest): Promise<PendingLocation[]> {
    const sql = req.forceRefresh ? pendingSqlForceAll : pendingSqlOnlyMissing;
    return queryRows<PendingLocation>(sql, [req.organizationId, req.batchSize]);
}

async function countPending(req: BackfillRequest): Promise<number> {
    const sql = req.forceRefresh ? countSqlForceAll : countSqlOnlyMissing;
    const rows = await queryRows<{count: string}>(sql, [req.organizationId]);
    return Number(rows[0]?.count ?? 0);
}

async function processOne(
    row: PendingLocation,
    summary: BackfillGeoSummary
): Promise<void> {
    summary.processed += 1;
    const query = composeQuery(row);
    if (query === null) {
        recordUnresolved(summary, row.id, 'no address fields to resolve');
        return;
    }
    const top = await topCandidate(query, row.country_code);
    if (top === null) {
        recordUnresolved(summary, row.id, 'no candidate');
        return;
    }
    if (top.score < STRONG_MATCH_THRESHOLD) {
        recordUnresolved(
            summary,
            row.id,
            `weak match (score=${top.score.toFixed(2)})`
        );
        return;
    }
    await writeResolvedGeo(row.id, top);
    summary.updated += 1;
}

async function topCandidate(query: string, biasCountryCode: string | null) {
    const result = await searchPlaces({
        query,
        biasCountryCode,
        limit: 1
    });
    return result.candidates[0] ?? null;
}

async function writeResolvedGeo(
    locationId: number,
    candidate: {
        lat: number;
        lng: number;
        name: string;
        geonameid?: number;
    }
): Promise<void> {
    await queryRows(
        `UPDATE organization.locations
            SET geo = jsonb_build_object(
                    'lat', $2::float8,
                    'lng', $3::float8,
                    'source', 'autocomplete',
                    'matchedName', $4::text,
                    'geonameid', $5::int,
                    'verifiedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                )
          WHERE id = $1`,
        [
            locationId,
            candidate.lat,
            candidate.lng,
            candidate.name,
            candidate.geonameid ?? null
        ]
    );
}

function composeQuery(row: PendingLocation): string | null {
    const parts = [row.city, row.region, row.country_code]
        .map((p) => (typeof p === 'string' ? p.trim() : ''))
        .filter((p) => p.length > 0);
    if (parts.length === 0) return null;
    return parts.join(', ');
}

function emptySummary(remaining: number): BackfillGeoSummary {
    return {
        processed: 0,
        updated: 0,
        skipped: 0,
        unresolved: 0,
        remaining,
        errors: []
    };
}

function recordUnresolved(
    summary: BackfillGeoSummary,
    locationId: number,
    reason: string
): void {
    summary.unresolved += 1;
    if (summary.errors.length < 5) {
        summary.errors.push({locationId, reason});
    }
}

// SQL fragments are exported lazily — keeps the top of file scannable.

const sharedSelectColumns = `
    l.id,
    l.name,
    (l.address->>'countryCode') AS country_code,
    (l.address->>'region')      AS region,
    (l.address->>'city')        AS city
`;

const pendingSqlOnlyMissing = `
    SELECT ${sharedSelectColumns}
      FROM organization.locations l
     WHERE l.organization_id = $1
       AND l.geo IS NULL
       AND l.address IS NOT NULL
     ORDER BY l.id
     LIMIT $2
`;

const pendingSqlForceAll = `
    SELECT ${sharedSelectColumns}
      FROM organization.locations l
     WHERE l.organization_id = $1
       AND l.address IS NOT NULL
     ORDER BY l.id
     LIMIT $2
`;

const countSqlOnlyMissing = `
    SELECT count(*)::text AS count
      FROM organization.locations
     WHERE organization_id = $1
       AND geo IS NULL
       AND address IS NOT NULL
`;

const countSqlForceAll = `
    SELECT count(*)::text AS count
      FROM organization.locations
     WHERE organization_id = $1
       AND address IS NOT NULL
`;

export const __forTests = {
    composeQuery,
    STRONG_MATCH_THRESHOLD,
    DEFAULT_BATCH_SIZE
};

export {DEFAULT_BATCH_SIZE};
