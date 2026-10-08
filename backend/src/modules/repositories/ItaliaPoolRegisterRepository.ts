import type {ItaliaPoolChemistryPolicy} from '../../types/api/operations';
import type {SensorDbCaller as DbCaller} from './SensorRepository';

export interface ItaliaPoolRegisterRow {
    organizationId: string;
    siteId: number;
    poolId: string;
    date: string;
    entry: string;
    value: number | string;
    acceptedBy: string | null;
    acceptedAt: string;
}

export interface ItaliaPoolRegisterRepositoryDeps {
    callDb: DbCaller;
}

export class ItaliaPoolRegisterRepository {
    readonly #deps: ItaliaPoolRegisterRepositoryDeps;

    constructor(deps: ItaliaPoolRegisterRepositoryDeps) {
        this.#deps = deps;
    }

    async listPolicies(
        organizationId: string
    ): Promise<ItaliaPoolChemistryPolicy[]> {
        const result = await this.#deps.callDb(
            'organization.fn_italia_pool_chemistry_policy_list',
            {p_organization_id: organizationId}
        );
        return (result?.rows ?? [])
            .map((row) => policyOf(row))
            .filter(
                (policy): policy is ItaliaPoolChemistryPolicy => policy !== null
            );
    }

    async upsertPolicy(input: {
        organizationId: string;
        policy: ItaliaPoolChemistryPolicy;
    }): Promise<ItaliaPoolChemistryPolicy | null> {
        const result = await this.#deps.callDb(
            'organization.fn_italia_pool_chemistry_policy_upsert',
            {
                p_organization_id: input.organizationId,
                p_pool_id: input.policy.poolId,
                p_site_id: input.policy.siteId,
                p_policy: input.policy
            }
        );
        return policyOf(result?.rows?.[0]);
    }

    async deletePolicy(
        organizationId: string,
        poolId: string
    ): Promise<boolean> {
        const result = await this.#deps.callDb(
            'organization.fn_italia_pool_chemistry_policy_delete',
            {p_organization_id: organizationId, p_pool_id: poolId}
        );
        const row = result?.rows?.[0] as Record<string, unknown> | undefined;
        return row?.fn_italia_pool_chemistry_policy_delete === true;
    }

    async upsert(input: {
        organizationId: string;
        siteId: number;
        poolId: string;
        date: string;
        entry: string;
        value: number | string;
        acceptedBy: string | null;
    }): Promise<ItaliaPoolRegisterRow | null> {
        const result = await this.#deps.callDb(
            'organization.fn_italia_pool_register_entry_upsert',
            {
                p_organization_id: input.organizationId,
                p_site_id: input.siteId,
                p_pool_id: input.poolId,
                p_register_date: input.date,
                p_entry: input.entry,
                p_value: input.value,
                p_accepted_by: input.acceptedBy
            }
        );
        return rowOf(result?.rows?.[0]);
    }

    async list(input: {
        organizationId: string;
        siteId: number;
        poolId: string;
        from: string;
        to: string;
    }): Promise<ItaliaPoolRegisterRow[]> {
        const result = await this.#deps.callDb(
            'organization.fn_italia_pool_register_entry_list',
            {
                p_organization_id: input.organizationId,
                p_site_id: input.siteId,
                p_pool_id: input.poolId,
                p_from: input.from,
                p_to: input.to
            }
        );
        return (result?.rows ?? [])
            .map(rowOf)
            .filter((row): row is ItaliaPoolRegisterRow => row !== null);
    }

    async delete(input: {
        organizationId: string;
        siteId: number;
        poolId: string;
        date: string;
        entry: string;
    }): Promise<boolean> {
        const result = await this.#deps.callDb(
            'organization.fn_italia_pool_register_entry_delete',
            {
                p_organization_id: input.organizationId,
                p_site_id: input.siteId,
                p_pool_id: input.poolId,
                p_register_date: input.date,
                p_entry: input.entry
            }
        );
        const row = result?.rows?.[0] as Record<string, unknown> | undefined;
        return row?.fn_italia_pool_register_entry_delete === true;
    }
}

function policyOf(raw: unknown): ItaliaPoolChemistryPolicy | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const policy = row.policy;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
        return null;
    }
    return policy as ItaliaPoolChemistryPolicy;
}

function rowOf(raw: unknown): ItaliaPoolRegisterRow | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const value = row.value;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const acceptedAt = new Date(String(row.accepted_at));
    if (Number.isNaN(acceptedAt.getTime())) return null;
    return {
        organizationId: String(row.organization_id),
        siteId: Number(row.site_id),
        poolId: String(row.pool_id),
        date: dateOnly(row.register_date),
        entry: String(row.entry),
        value,
        acceptedBy:
            row.accepted_by === null || row.accepted_by === undefined
                ? null
                : String(row.accepted_by),
        acceptedAt: acceptedAt.toISOString()
    };
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The register reads return dates as text (20161); a Date here would carry a time zone.
function dateOnly(value: unknown): string {
    if (typeof value === 'string' && CALENDAR_DATE.test(value)) return value;
    throw new Error(
        `Expected a YYYY-MM-DD calendar date, got ${String(value)}`
    );
}

let defaultInstance: Promise<ItaliaPoolRegisterRepository> | undefined;
export function defaultItaliaPoolRegisterRepository(): Promise<ItaliaPoolRegisterRepository> {
    if (!defaultInstance) {
        defaultInstance = (async () => {
            const pg = await import('../PostgresProvider.js');
            return new ItaliaPoolRegisterRepository({
                callDb: pg.callMethod as DbCaller
            });
        })();
    }
    return defaultInstance;
}
