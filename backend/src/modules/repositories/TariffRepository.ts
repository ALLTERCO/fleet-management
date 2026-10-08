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

import {ValidationError, validateParams} from '../../rpc/validation.js';
import {
    TARIFF_SPEC_SCHEMA,
    type TariffAssignmentSpec,
    type TariffPriceComponentSpec,
    type TariffResolutionPoint,
    type TariffResolvedAssignment,
    type TariffSpec
} from '../../types/api/tariff.js';

/** Raw DB function caller — same shape as EnergyRepository uses. */
export type DbCaller = (
    method: string,
    params: Record<string, unknown>
) => Promise<{rows: unknown[]} | null | undefined>;

export interface TariffRepositoryDeps {
    callDb: DbCaller;
}

export class PersistedTariffValidationError extends Error {
    readonly code = 'invalid_persisted_tariff';

    constructor(cause: ValidationError) {
        super('tariff database function returned invalid data', {cause});
        this.name = 'PersistedTariffValidationError';
    }
}

/** One assignment row (snake_case from fn_tariff_list_assignments). */
export interface TariffAssignmentRow {
    scope_level:
        | 'organization'
        | 'location'
        | 'dashboard'
        | 'device'
        | 'channel';
    dashboard_id: number | null;
    location_id: number | null;
    device_external_id: string | null;
    channel: number | null;
    tariff_id: number;
    commodity: string;
    billed_unit: string;
    direction: 'import' | 'export';
}

interface TariffResolvedAssignmentRow {
    device_external_id: string;
    channel: number | null;
    tariff_id: number | null;
    scope_level: 'organization' | 'location' | 'device' | 'channel' | null;
    location_id: number | null;
    ambiguous: boolean;
    commodity: 'electricity' | 'water' | 'gas' | 'heat';
    direction: 'import' | 'export';
}

export class TariffRepository {
    readonly #deps: TariffRepositoryDeps;

    constructor(deps: TariffRepositoryDeps) {
        this.#deps = deps;
    }

    /** List tariffs for an org — headers plus contract provenance. */
    async list(org: string): Promise<
        Array<{
            id: number;
            name: string;
            kind: string;
            currency: string;
            effective_from: string | null;
            effective_to: string | null;
            source_reference: string | null;
            commodity: string;
            billed_unit: string;
        }>
    > {
        const res = await this.#deps.callDb('organization.fn_tariff_list', {
            p_org: org
        });
        return (res?.rows ?? []) as Array<{
            id: number;
            name: string;
            kind: string;
            currency: string;
            effective_from: string | null;
            effective_to: string | null;
            source_reference: string | null;
            commodity: string;
            billed_unit: string;
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
        const tariff = row ? Object.values(row)[0] : null;
        if (!tariff) return null;
        const validated = validatePersistedTariff(tariff);
        return {
            ...validated,
            components: await this.listComponents(org, id)
        };
    }

    async listComponents(
        org: string,
        tariffId: number
    ): Promise<TariffPriceComponentSpec[]> {
        const res = await this.#deps.callDb(
            'organization.fn_tariff_component_list',
            {p_org: org, p_tariff_id: tariffId}
        );
        return (res?.rows ?? []).map((raw) => {
            const row = raw as Record<string, unknown>;
            return {
                code: String(row.code),
                name: String(row.name),
                sequence: Number(row.sequence),
                chargeType:
                    row.charge_type as TariffPriceComponentSpec['chargeType'],
                chargeClass: String(row.charge_class),
                basis: row.basis as TariffPriceComponentSpec['basis'],
                rate: Number(row.rate),
                appliesTo: (row.applies_to as string[] | null) ?? [],
                taxable: Boolean(row.taxable),
                effectiveFrom: (row.effective_from as string | null) ?? null,
                effectiveTo: (row.effective_to as string | null) ?? null,
                sourceReference: (row.source_reference as string | null) ?? null
            };
        });
    }

    async writeComponents(
        org: string,
        tariffId: number,
        components: readonly TariffPriceComponentSpec[]
    ): Promise<void> {
        await this.#deps.callDb('organization.fn_tariff_write_components', {
            p_org: org,
            p_tariff_id: tariffId,
            p_components: JSON.stringify(components)
        });
    }

    /**
     * Upsert a tariff (insert when spec.id is absent, update otherwise).
     * Returns the tariff id. The scalar output column is named after the
     * function, so Object.values(row)[0] is the robust unwrap.
     */
    async upsert(org: string, spec: TariffSpec): Promise<number> {
        const method =
            spec.components == null
                ? 'organization.fn_tariff_upsert'
                : 'organization.fn_tariff_upsert_with_components';
        const res = await this.#deps.callDb(method, {
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
        const [imports, exports] = await Promise.all([
            this.#deps.callDb('organization.fn_tariff_list_assignments', {
                p_org: org
            }),
            this.#deps.callDb(
                'organization.fn_tariff_list_export_assignments',
                {p_org: org}
            )
        ]);
        return [
            ...((imports?.rows ?? []) as TariffAssignmentRow[]).map((row) => ({
                ...row,
                direction: 'import' as const
            })),
            ...((exports?.rows ?? []) as TariffAssignmentRow[]).map((row) => ({
                ...row,
                direction: 'export' as const
            }))
        ];
    }

    async resolveAssignments(
        org: string,
        points: readonly TariffResolutionPoint[]
    ): Promise<TariffResolvedAssignment[]> {
        const importPoints = points.filter(
            (point) => (point.direction ?? 'import') === 'import'
        );
        const exportPoints = points.filter(
            (point) => point.direction === 'export'
        );
        const encode = (selected: readonly TariffResolutionPoint[]) =>
            JSON.stringify(
                selected.map((point) => ({
                    device_external_id: point.deviceExternalId,
                    channel: point.channel,
                    commodity: point.commodity ?? 'electricity'
                }))
            );
        const [imports, exports] = await Promise.all([
            importPoints.length
                ? this.#deps.callDb(
                      'organization.fn_tariff_resolve_assignments',
                      {p_org: org, p_points: encode(importPoints)}
                  )
                : Promise.resolve({rows: []}),
            exportPoints.length
                ? this.#deps.callDb(
                      'organization.fn_tariff_resolve_export_assignments',
                      {p_org: org, p_points: encode(exportPoints)}
                  )
                : Promise.resolve({rows: []})
        ]);
        const rows = [
            ...((imports?.rows ?? []) as TariffResolvedAssignmentRow[]).map(
                (row) => ({...row, direction: 'import' as const})
            ),
            ...((exports?.rows ?? []) as TariffResolvedAssignmentRow[]).map(
                (row) => ({...row, direction: 'export' as const})
            )
        ];
        return rows.map((row) => ({
            deviceExternalId: row.device_external_id,
            channel: row.channel,
            commodity: row.commodity ?? 'electricity',
            direction: row.direction,
            tariffId: row.tariff_id,
            scopeLevel: row.scope_level,
            locationId: row.location_id,
            ambiguous: row.ambiguous
        }));
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
        const method =
            spec.direction === 'export'
                ? 'organization.fn_tariff_assign_export'
                : 'organization.fn_tariff_assign';
        await this.#deps.callDb(method, {
            p_org: org,
            p_payload: spec,
            p_delete: del
        });
    }
}

function validatePersistedTariff(value: unknown): TariffSpec {
    try {
        return validateParams<TariffSpec>(value, TARIFF_SPEC_SCHEMA);
    } catch (error) {
        if (error instanceof ValidationError) {
            throw new PersistedTariffValidationError(error);
        }
        throw error;
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
