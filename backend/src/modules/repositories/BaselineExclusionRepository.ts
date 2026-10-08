// Persistence seam for operator-declared baseline exclusions. The stored
// functions own tenant scoping and return audit evidence atomically.

import {callMethod, type DbResult} from '../PostgresProvider';

export interface BaselineExclusionRow {
    id: number;
    organization_id: string;
    from_day: string;
    to_day: string;
    reason: string;
    created_by: string | null;
    created_at: string;
}

export interface SaveBaselineExclusionDbParams {
    id: number | null;
    organizationId: string;
    fromDay: string;
    toDay: string;
    reason: string;
    createdBy: string;
}

export interface BaselineExclusionChange {
    before: BaselineExclusionRow | null;
    after: BaselineExclusionRow;
}

export async function listBaselineExclusions(
    organizationId: string
): Promise<BaselineExclusionRow[]> {
    const result = await callMethod('fm.fn_list_baseline_exclusions', {
        p_org: organizationId
    });
    return rowsOf(result).map(mapRow);
}

export async function saveBaselineExclusion(
    params: SaveBaselineExclusionDbParams
): Promise<BaselineExclusionChange | null> {
    const result = await callMethod('fm.fn_save_baseline_exclusion', {
        p_id: params.id,
        p_org: params.organizationId,
        p_from_day: params.fromDay,
        p_to_day: params.toDay,
        p_reason: params.reason,
        p_created_by: params.createdBy
    });
    const row = rowsOf(result)[0];
    if (!row) return null;
    return {
        before: row.before_row ? mapRow(asRecord(row.before_row)) : null,
        after: mapRow(asRecord(row.after_row))
    };
}

export async function deleteBaselineExclusion(
    id: number,
    organizationId: string
): Promise<BaselineExclusionRow | null> {
    const result = await callMethod('fm.fn_delete_baseline_exclusion', {
        p_id: id,
        p_org: organizationId
    });
    const removed = rowsOf(result)[0]?.removed_row;
    return removed ? mapRow(asRecord(removed)) : null;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
    return (result as DbResult)?.rows ?? [];
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('baseline exclusion function returned an invalid row');
    }
    return value as Record<string, unknown>;
}

function mapRow(row: Record<string, unknown>): BaselineExclusionRow {
    return {
        id: Number(row.id),
        organization_id: String(row.organization_id),
        from_day: String(row.from_day),
        to_day: String(row.to_day),
        reason: String(row.reason),
        created_by:
            row.created_by === null || row.created_by === undefined
                ? null
                : String(row.created_by),
        created_at: isoTimestamp(row.created_at)
    };
}

function isoTimestamp(value: unknown): string {
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(
            'baseline exclusion function returned an invalid timestamp'
        );
    }
    return parsed.toISOString();
}
