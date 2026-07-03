// Read access to organization.bill_actuals — the recorded actual utility-bill
// amount for a billing period, used by the energy report to reconcile its
// computed cost against the real bill. Org-scoped on every query.

import * as postgres from './PostgresProvider';

export interface BillActual {
    actualCost: number;
    currency: string;
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

// The recorded bill covering the report window [from, to], or null when none.
// A bill covers the window when it starts on/before `from` and ends on/after
// `to`; the most recent such bill wins. `from`/`to` are reduced to calendar
// dates in `timezone` (see billPeriodDate) and compared as DATEs, so the match
// never moves across a day boundary for a site off UTC.
export async function getBillActual(
    organizationId: string,
    from: string,
    to: string,
    timezone: string | null,
    deps: BillActualsRepositoryDeps = defaultDeps
): Promise<BillActual | null> {
    const rows = await deps.queryRows<{
        actual_cost: number | string;
        currency: string;
    }>(
        `SELECT actual_cost, currency FROM organization.bill_actuals
          WHERE organization_id = $1
            AND period_start <= $2::date AND period_end >= $3::date
          ORDER BY period_start DESC
          LIMIT 1`,
        [
            organizationId,
            billPeriodDate(from, timezone),
            billPeriodDate(to, timezone)
        ]
    );
    if (!rows[0]) return null;
    return {
        actualCost: Number(rows[0].actual_cost),
        currency: rows[0].currency
    };
}

// A real calendar date, not just YYYY-MM-DD-shaped: the param regex allows e.g.
// 2026-13-40, which Postgres would otherwise reject with a raw 500.
export function isRealCalendarDate(value: string): boolean {
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export interface BillActualEntry {
    id: number;
    periodStart: string;
    periodEnd: string;
    actualCost: number;
    currency: string;
}

interface BillRow {
    id: number | string;
    period_start: Date | string;
    period_end: Date | string;
    actual_cost: number | string;
    currency: string;
}

function toEntry(row: BillRow): BillActualEntry {
    return {
        id: Number(row.id),
        periodStart: asDate(row.period_start),
        periodEnd: asDate(row.period_end),
        actualCost: Number(row.actual_cost),
        currency: row.currency
    };
}

function asDate(value: Date | string): string {
    return value instanceof Date
        ? value.toISOString().slice(0, 10)
        : String(value).slice(0, 10);
}

const RETURN_COLUMNS = 'id, period_start, period_end, actual_cost, currency';

// Record the actual bill for a period; upserts on (org, period_start,
// period_end). Ensures the org profile first (FK to organization.profile).
export async function setBillActual(
    organizationId: string,
    params: {
        periodStart: string;
        periodEnd: string;
        actualCost: number;
        currency?: string;
    },
    deps: BillActualsRepositoryDeps = defaultDeps
): Promise<BillActualEntry> {
    await deps.queryRows('SELECT organization.fn_profile_ensure($1)', [
        organizationId
    ]);
    const rows = await deps.queryRows<BillRow>(
        `INSERT INTO organization.bill_actuals
            (organization_id, period_start, period_end, actual_cost, currency)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organization_id, period_start, period_end) DO UPDATE
            SET actual_cost = EXCLUDED.actual_cost,
                currency = EXCLUDED.currency,
                updated_at = now()
         RETURNING ${RETURN_COLUMNS}`,
        [
            organizationId,
            params.periodStart,
            params.periodEnd,
            params.actualCost,
            params.currency ?? 'EUR'
        ]
    );
    return toEntry(rows[0]);
}

// Recorded bills for an org, newest first, optionally within [from, to].
export async function listBillActuals(
    organizationId: string,
    range: {from?: string; to?: string},
    deps: BillActualsRepositoryDeps = defaultDeps
): Promise<BillActualEntry[]> {
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
    const rows = await deps.queryRows<BillRow>(
        `SELECT ${RETURN_COLUMNS} FROM organization.bill_actuals
          WHERE ${clauses.join(' AND ')}
          ORDER BY period_start DESC`,
        params
    );
    return rows.map(toEntry);
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
