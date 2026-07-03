import * as postgres from '../PostgresProvider';

export interface PendingAdmissionRow {
    shelly_id: string;
    organization_id: string;
    group_id: number | null;
    created_by: string | null;
    created_at: string;
    expires_at: string;
    consumed_at: string | null;
    reserved_at: string | null;
}

export interface RecordPendingAdmissionInput {
    shellyId: string;
    organizationId: string;
    groupId?: number;
    createdBy: string;
    ttlSeconds: number;
}

export async function recordPendingAdmission(
    input: RecordPendingAdmissionInput
): Promise<PendingAdmissionRow> {
    const rows = await postgres.queryRows<PendingAdmissionRow>(
        `SELECT * FROM organization.fn_pending_admission_record($1, $2, $3, $4, $5)`,
        [
            input.shellyId,
            input.organizationId,
            input.groupId ?? null,
            input.createdBy,
            input.ttlSeconds
        ]
    );
    const row = rows[0];
    if (!row) throw new Error('fn_pending_admission_record returned no row');
    return row;
}

// Atomic single-winner claim; a stale claim past the grace window is reclaimable.
export async function reservePendingAdmission(
    shellyId: string,
    reserveGraceSeconds: number
): Promise<PendingAdmissionRow | null> {
    const rows = await postgres.queryRows<PendingAdmissionRow>(
        `SELECT * FROM organization.fn_pending_admission_reserve($1, $2)`,
        [shellyId, reserveGraceSeconds]
    );
    return liveRowOrNull(rows);
}

// DOES only — atomic single-use consume. Returns true when this caller
// won the race and finalized; false when nothing matched (already
// consumed / expired / org mismatch). SETOF: 0 rows == no match.
export async function finalizePendingAdmission(
    shellyId: string,
    organizationId: string
): Promise<boolean> {
    const rows = await postgres.queryRows<PendingAdmissionRow>(
        `SELECT * FROM organization.fn_pending_admission_finalize($1, $2)`,
        [shellyId, organizationId]
    );
    return liveRowOrNull(rows) !== null;
}

// Guards against a DB still on the pre-SETOF function (migration not
// yet applied): that function returns one all-NULL composite row on
// miss, which length-based SETOF detection mistakes for a live row.
// A real live row always has a non-null shelly_id.
function liveRowOrNull(
    rows: ReadonlyArray<PendingAdmissionRow>
): PendingAdmissionRow | null {
    const row = rows[0];
    if (!row) return null;
    if (row.shelly_id === null || row.shelly_id === undefined) return null;
    return row;
}
