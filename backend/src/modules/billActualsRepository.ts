// Read access to organization.bill_actuals — the recorded actual utility-bill
// amount for a billing period, used by the energy report to reconcile its
// computed cost against the real bill. Org-scoped on every query.

import type {
    BillIdentity,
    BillListCursor,
    BillListParams,
    BillReconciliationSelector,
    BillSetParams
} from '../types/api/bill';
import * as postgres from './PostgresProvider';

export interface BillActual {
    periodStart: string;
    periodEnd: string;
    actualCost: number;
    currency: string;
    utilityAccountId: string | null;
    meterIdentifier: string | null;
    servicePointIdentifier: string | null;
}

export interface BillActualsRepositoryDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
}

const defaultDeps: BillActualsRepositoryDeps = {
    queryRows: postgres.queryRows
};

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

// The calendar date a report-window endpoint falls on, in `timezone`. A bill
// period is a span of local calendar dates, so its boundary is only meaningful
// against a fixed zone — UTC's day ends earlier than UTC+2's, and matching by
// UTC would shift the window across midnight for any site not on UTC. A bare
// YYYY-MM-DD is already a local date, taken verbatim; an instant is rendered in
// `timezone` (the org zone, else UTC). en-CA formats as YYYY-MM-DD.
export function billPeriodDate(value: string, timezone: string | null): string {
    if (BARE_DATE.test(value)) return value;
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return value.slice(0, 10);
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone ?? 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(instant);
    } catch {
        return instant.toISOString().slice(0, 10);
    }
}

// The recorded organization bill exactly aligned to the report window, or null.
// A wider bill must not be compared with a narrower shadow bill: that would
// produce a plausible but false variance. `from`/`to` are reduced to calendar
// dates in `timezone` (see billPeriodDate) before the exact DATE comparison.
export async function getBillActual(
    organizationId: string,
    from: string,
    to: string,
    timezone: string | null,
    identity: BillIdentity = {},
    deps: BillActualsRepositoryDeps = defaultDeps
): Promise<BillActual | null> {
    const resolved = await resolveBillActual(
        organizationId,
        from,
        to,
        timezone,
        identity,
        deps
    );
    if (resolved.status === 'ambiguous') {
        throw new BillActualAmbiguityError(resolved.matchCount);
    }
    return resolved.status === 'matched' ? resolved.bill : null;
}

export type BillActualResolution =
    | {status: 'matched'; bill: BillActual}
    | {status: 'not_found'}
    | {status: 'ambiguous'; matchCount: number}
    | {status: 'evidence_mismatch'; fields: string[]};

export class BillActualAmbiguityError extends Error {
    constructor(readonly matchCount: number) {
        super(
            `Recorded bill selection matched ${matchCount} utility accounts or meters.`
        );
        this.name = 'BillActualAmbiguityError';
    }
}

export async function resolveBillActual(
    organizationId: string,
    from: string,
    to: string,
    timezone: string | null,
    identity: BillIdentity = {},
    deps: BillActualsRepositoryDeps = defaultDeps
): Promise<BillActualResolution> {
    const params: unknown[] = [
        organizationId,
        billPeriodDate(from, timezone),
        billPeriodDate(to, timezone)
    ];
    const identityClauses = appendIdentityClauses(params, identity);
    const rows = await deps.queryRows<BillRow>(
        `SELECT ${RETURN_COLUMNS}
           FROM organization.bill_actuals
          WHERE organization_id = $1
             AND period_start = $2::date AND period_end = $3::date
             ${identityClauses}
           ORDER BY id
           LIMIT 2`,
        params
    );
    if (rows.length === 0) return {status: 'not_found'};
    if (rows.length > 1) return {status: 'ambiguous', matchCount: rows.length};
    return {status: 'matched', bill: toActual(rows[0])};
}

/** Exact report reconciliation selection. `billId` never behaves like a list
 * filter: it is resolved with organization and report period in the same SQL
 * predicate, then every optional identity field is verified as evidence. */
export async function resolveBillActualForReport(
    organizationId: string,
    from: string,
    to: string,
    timezone: string | null,
    selector: BillReconciliationSelector = {},
    deps: BillActualsRepositoryDeps = defaultDeps
): Promise<BillActualResolution> {
    if (selector.billId === undefined) {
        return resolveBillActual(
            organizationId,
            from,
            to,
            timezone,
            selector,
            deps
        );
    }
    const rows = await deps.queryRows<BillRow>(
        `SELECT ${RETURN_COLUMNS}
           FROM organization.bill_actuals
          WHERE organization_id = $1
            AND id = $2
            AND period_start = $3::date
            AND period_end = $4::date
          LIMIT 1`,
        [
            organizationId,
            selector.billId,
            billPeriodDate(from, timezone),
            billPeriodDate(to, timezone)
        ]
    );
    if (!rows[0]) return {status: 'not_found'};
    const bill = toActual(rows[0]);
    const mismatches = identityEvidenceMismatches(bill, selector);
    if (mismatches.length > 0) {
        return {status: 'evidence_mismatch', fields: mismatches};
    }
    return {status: 'matched', bill};
}

function identityEvidenceMismatches(
    bill: BillActual,
    evidence: BillIdentity
): string[] {
    const mismatches: string[] = [];
    for (const field of [
        'utilityAccountId',
        'meterIdentifier',
        'servicePointIdentifier'
    ] as const) {
        if (evidence[field] !== undefined && evidence[field] !== bill[field]) {
            mismatches.push(field);
        }
    }
    return mismatches;
}

// A real calendar date, not just YYYY-MM-DD-shaped: the param regex allows e.g.
// 2026-13-40, which Postgres would otherwise reject with a raw 500.
export function isRealCalendarDate(value: string): boolean {
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export interface BillActualEntry extends BillActual {
    id: number;
}

export interface BillActualPage {
    bills: BillActualEntry[];
    nextCursor: BillListCursor | null;
}

interface BillRow {
    id: number | string;
    period_start: string;
    period_end: string;
    actual_cost: number | string;
    currency: string;
    utility_account_id: string | null;
    meter_identifier: string | null;
    service_point_identifier: string | null;
}

function toEntry(row: BillRow): BillActualEntry {
    return {
        id: Number(row.id),
        periodStart: asDate(row.period_start),
        periodEnd: asDate(row.period_end),
        actualCost: Number(row.actual_cost),
        currency: row.currency,
        utilityAccountId: row.utility_account_id ?? null,
        meterIdentifier: row.meter_identifier ?? null,
        servicePointIdentifier: row.service_point_identifier ?? null
    };
}

function toActual(row: BillRow): BillActual {
    const {id: _, ...actual} = toEntry(row);
    return actual;
}

// RETURN_COLUMNS selects dates as text; a Date here would carry a time zone.
function asDate(value: unknown): string {
    if (typeof value === 'string' && BARE_DATE.test(value)) return value;
    throw new Error(
        `Expected a YYYY-MM-DD calendar date, got ${String(value)}`
    );
}

const STORED_COLUMNS =
    'id, period_start, period_end, actual_cost, currency, utility_account_id, meter_identifier, service_point_identifier';
// Calendar dates leave SQL as text so node-pg never parses them to local midnight.
const RETURN_COLUMNS =
    "id, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end, actual_cost, currency, utility_account_id, meter_identifier, service_point_identifier";

// Record the actual bill for a period; upserts on (org, period_start,
// period_end). Ensures the org profile first (FK to organization.profile).
export async function setBillActual(
    organizationId: string,
    params: BillSetParams,
    deps: BillActualsRepositoryDeps = defaultDeps
): Promise<BillActualEntry> {
    await deps.queryRows('SELECT organization.fn_profile_ensure($1)', [
        organizationId
    ]);
    const rows = await deps.queryRows<BillRow>(
        `INSERT INTO organization.bill_actuals
            (organization_id, period_start, period_end, actual_cost, currency,
             utility_account_id, meter_identifier, service_point_identifier)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (organization_id, period_start, period_end,
                      (COALESCE(utility_account_id, '')),
                      (COALESCE(meter_identifier, '')),
                      (COALESCE(service_point_identifier, ''))) DO UPDATE
            SET actual_cost = EXCLUDED.actual_cost,
                currency = EXCLUDED.currency,
                updated_at = now()
         RETURNING ${RETURN_COLUMNS}`,
        [
            organizationId,
            params.periodStart,
            params.periodEnd,
            params.actualCost,
            params.currency,
            params.utilityAccountId ?? null,
            params.meterIdentifier ?? null,
            params.servicePointIdentifier ?? null
        ]
    );
    return toEntry(rows[0]);
}

// Recorded bills for an org, newest first, optionally within [from, to].
export async function listBillActuals(
    organizationId: string,
    range: BillListParams,
    deps: BillActualsRepositoryDeps = defaultDeps
): Promise<BillActualPage> {
    const rangeError = billListRangeError(range);
    if (rangeError) throw new Error(rangeError);
    const params: unknown[] = [organizationId];
    const clauses = ['organization_id = $1'];
    if (range.from) {
        params.push(range.from);
        clauses.push(`period_end >= $${params.length}::date`);
    }
    if (range.to) {
        params.push(range.to);
        clauses.push(`period_start <= $${params.length}::date`);
    }
    const identityClauses = appendIdentityClauses(params, range);
    if (identityClauses)
        clauses.push(identityClauses.trim().replace(/^AND /, ''));
    if (range.cursor) {
        params.push(range.cursor.periodStart, range.cursor.id);
        clauses.push(
            `(period_start, id) < ($${params.length - 1}::date, $${params.length}::bigint)`
        );
    }
    const limit = Math.min(
        MAX_LIST_LIMIT,
        Math.max(1, range.limit ?? DEFAULT_LIST_LIMIT)
    );
    params.push(limit + 1);
    // The qualified ORDER BY sorts on the DATE column, not its text alias.
    const rows = await deps.queryRows<BillRow>(
        `SELECT ${RETURN_COLUMNS} FROM organization.bill_actuals
          WHERE ${clauses.join(' AND ')}
          ORDER BY bill_actuals.period_start DESC, id DESC
          LIMIT $${params.length}`,
        params
    );
    const overflow = rows.length > limit;
    const bills = rows.slice(0, limit).map(toEntry);
    const tail = bills.at(-1);
    return {
        bills,
        nextCursor:
            overflow && tail
                ? {periodStart: tail.periodStart, id: tail.id}
                : null
    };
}

export function billListRangeError(range: BillListParams): string | null {
    for (const [name, value] of [
        ['from', range.from],
        ['to', range.to],
        ['cursor.periodStart', range.cursor?.periodStart]
    ] as const) {
        if (value !== undefined && !isRealCalendarDate(value)) {
            return `${name} must be a real calendar date`;
        }
    }
    if (range.from && range.to && range.to < range.from) {
        return 'to must be on or after from';
    }
    return null;
}

export async function importBillActuals(
    organizationId: string,
    bills: readonly BillSetParams[],
    deps: BillActualsRepositoryDeps = defaultDeps
): Promise<BillActualEntry[]> {
    assertUniqueBillImportIdentities(bills);
    await deps.queryRows('SELECT organization.fn_profile_ensure($1)', [
        organizationId
    ]);
    const rows = await deps.queryRows<BillRow & {ordinality: number}>(
        `WITH input AS MATERIALIZED (
             SELECT item, ordinality
               FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS batch(item, ordinality)
         ), upserted AS (
             INSERT INTO organization.bill_actuals
                 (organization_id, period_start, period_end, actual_cost, currency,
                  utility_account_id, meter_identifier, service_point_identifier)
             SELECT $1,
                    (item->>'periodStart')::date,
                    (item->>'periodEnd')::date,
                    (item->>'actualCost')::numeric,
                    item->>'currency',
                    item->>'utilityAccountId',
                    item->>'meterIdentifier',
                    item->>'servicePointIdentifier'
               FROM input
             ON CONFLICT (organization_id, period_start, period_end,
                          (COALESCE(utility_account_id, '')),
                          (COALESCE(meter_identifier, '')),
                          (COALESCE(service_point_identifier, ''))) DO UPDATE
                 SET actual_cost = EXCLUDED.actual_cost,
                     currency = EXCLUDED.currency,
                     updated_at = now()
             RETURNING ${STORED_COLUMNS}
         )
         SELECT ${RETURN_COLUMNS}, input.ordinality
           FROM input
           JOIN upserted saved
             ON saved.period_start = (input.item->>'periodStart')::date
            AND saved.period_end = (input.item->>'periodEnd')::date
            AND saved.utility_account_id IS NOT DISTINCT FROM input.item->>'utilityAccountId'
            AND saved.meter_identifier IS NOT DISTINCT FROM input.item->>'meterIdentifier'
            AND saved.service_point_identifier IS NOT DISTINCT FROM input.item->>'servicePointIdentifier'
          ORDER BY input.ordinality`,
        [organizationId, JSON.stringify(bills)]
    );
    return rows.map(toEntry);
}

export function assertUniqueBillImportIdentities(
    bills: readonly BillSetParams[]
): void {
    const seen = new Set<string>();
    for (const bill of bills) {
        const key = [
            bill.periodStart,
            bill.periodEnd,
            bill.utilityAccountId ?? '',
            bill.meterIdentifier ?? '',
            bill.servicePointIdentifier ?? ''
        ].join('\u0000');
        if (seen.has(key)) {
            throw new Error(
                'bills contains the same period and utility identity more than once'
            );
        }
        seen.add(key);
    }
}

function appendIdentityClauses(
    params: unknown[],
    identity: BillIdentity
): string {
    const clauses: string[] = [];
    for (const [column, value] of [
        ['utility_account_id', identity.utilityAccountId],
        ['meter_identifier', identity.meterIdentifier],
        ['service_point_identifier', identity.servicePointIdentifier]
    ] as const) {
        if (value === undefined) continue;
        params.push(value);
        clauses.push(`${column} = $${params.length}`);
    }
    return clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';
}

export async function deleteBillActual(
    organizationId: string,
    id: number,
    deps: BillActualsRepositoryDeps = defaultDeps
): Promise<boolean> {
    const rows = await deps.queryRows<{id: number}>(
        `DELETE FROM organization.bill_actuals
          WHERE id = $1 AND organization_id = $2 RETURNING id`,
        [id, organizationId]
    );
    return rows.length > 0;
}
