/**
 * Persistence seam for the `Tariff.*` namespace.
 *
 * All DB effects are routed through `TariffRepositoryDeps.callDb` so tests
 * substitute a fake without pulling in the PostgresProvider / config init
 * graph. Each method maps to one `fn_tariff_*` SQL function in the
 * `organization` schema.
 *
 * Scalar-returning functions (upsert, delete) name their output column after
 * the function itself (PG default for scalar returns), so we unwrap via
 * `Object.values(row)[0]` instead of hardcoding the column name.
 */

import type {TariffAssignmentSpec, TariffSpec} from '../../types/api/tariff.js';

/** Raw DB function caller — same shape as EnergyRepository uses. */
export type DbCaller = (
    method: string,
    params: Record<string, unknown>
) => Promise<{rows: unknown[]} | null | undefined>;

export interface TariffRepositoryDeps {
    callDb: DbCaller;
}

/** One assignment row (snake_case from fn_tariff_list_assignments). */
export interface TariffAssignmentRow {
    scope_level: 'dashboard' | 'device' | 'channel';
    dashboard_id: number | null;
    device_external_id: string | null;
    channel: number | null;
    tariff_id: number;
}

export class TariffRepository {
    readonly #deps: TariffRepositoryDeps;

    constructor(deps: TariffRepositoryDeps) {
        this.#deps = deps;
    }

    /** List tariffs for an org — header rows only (no seasons/windows). */
    async list(
        org: string
    ): Promise<
        Array<{id: number; name: string; kind: string; currency: string}>
    > {
        const res = await this.#deps.callDb('organization.fn_tariff_list', {
            p_org: org
        });
        return (res?.rows ?? []) as Array<{
            id: number;
            name: string;
            kind: string;
            currency: string;
        }>;
    }

    /**
     * Fetch one tariff with nested seasons+windows. The SQL function returns
     * one row with a single JSONB column named after the function; unwrap
     * with Object.values to avoid hardcoding the column name.
     */
    async get(org: string, id: number): Promise<TariffSpec | null> {
        const res = await this.#deps.callDb('organization.fn_tariff_get', {
            p_org: org,
            p_id: id
        });
        const row = res?.rows?.[0];
        return row ? (Object.values(row)[0] as TariffSpec | null) : null;
    }

    /**
     * Upsert a tariff (insert when spec.id is absent, update otherwise).
     * Returns the tariff id. The scalar output column is named after the
     * function, so Object.values(row)[0] is the robust unwrap.
     */
    async upsert(org: string, spec: TariffSpec): Promise<number> {
        const res = await this.#deps.callDb('organization.fn_tariff_upsert', {
            p_org: org,
            p_payload: spec
        });
        return Object.values(res!.rows[0] as object)[0] as number;
    }

    /** Delete a tariff by id within the org. Returns the number of rows deleted. */
    async delete(org: string, id: number): Promise<number> {
        const res = await this.#deps.callDb('organization.fn_tariff_delete', {
            p_org: org,
            p_id: id
        });
        return Object.values(res!.rows[0] as object)[0] as number;
    }

    /** All assignments for the org — used to resolve per-(device,channel) tariffs. */
    async listAssignments(org: string): Promise<TariffAssignmentRow[]> {
        const res = await this.#deps.callDb(
            'organization.fn_tariff_list_assignments',
            {p_org: org}
        );
        return (res?.rows ?? []) as TariffAssignmentRow[];
    }

    /**
     * Upsert (or, when del=true, remove) a tariff assignment for a metering
     * point. The SQL function is VOID-returning so there is no output to
     * unwrap.
     */
    async assign(
        org: string,
        spec: TariffAssignmentSpec,
        del = false
    ): Promise<void> {
        await this.#deps.callDb('organization.fn_tariff_assign', {
            p_org: org,
            p_payload: spec,
            p_delete: del
        });
    }
}

/**
 * Lazily constructed default repository wired to the production
 * PostgresProvider. Separate factory so the import does not pull config /
 * plugin init into unit tests that only need the class.
 */
let defaultInstance: Promise<TariffRepository> | undefined;
export function defaultTariffRepository(): Promise<TariffRepository> {
    if (!defaultInstance) {
        defaultInstance = (async () => {
            const pg = await import('../PostgresProvider.js');
            return new TariffRepository({
                callDb: pg.callMethod as DbCaller
            });
        })();
    }
    return defaultInstance;
}
