import type {DbCaller} from './TariffRepository.js';

export interface LiveTariffRepositoryDeps {
    callDb: DbCaller;
}

export class LiveTariffRepository {
    readonly #deps: LiveTariffRepositoryDeps;

    constructor(deps: LiveTariffRepositoryDeps) {
        this.#deps = deps;
    }

    /** Append (or overwrite) a single price point. p_ts is Unix epoch seconds. */
    async appendPrice(
        tariffId: number,
        tsSeconds: number,
        price: number
    ): Promise<void> {
        await this.#deps.callDb('organization.fn_tariff_live_append', {
            p_tariff_id: tariffId,
            p_ts: tsSeconds,
            p_price: price
        });
    }

    /** Upsert the live source config. Pass pushTokenHash=null to preserve any existing hash. */
    async upsertSource(opts: {
        tariffId: number;
        mode: 'push' | 'pull';
        provider?: string | null;
        pushTokenHash?: string | null;
        providerConfig?: unknown;
    }): Promise<void> {
        await this.#deps.callDb('organization.fn_tariff_live_source_upsert', {
            p_tariff_id: opts.tariffId,
            p_mode: opts.mode,
            p_provider: opts.provider ?? null,
            p_push_token_hash: opts.pushTokenHash ?? null,
            p_provider_config: opts.providerConfig ?? null
        });
    }

    /** Return the tariff id that owns the given push token hash, or null. */
    async tariffIdByPushToken(tokenHash: string): Promise<number | null> {
        const res = await this.#deps.callDb(
            'organization.fn_tariff_live_source_by_token',
            {p_token_hash: tokenHash}
        );
        const row = res?.rows?.[0];
        if (!row) return null;
        return (Object.values(row)[0] as number) ?? null;
    }

    /** Return all pull-mode live sources for the periodic fetch scheduler. */
    async listPullSources(): Promise<
        Array<{tariffId: number; provider: string | null; providerConfig: any}>
    > {
        const res = await this.#deps.callDb(
            'organization.fn_tariff_live_pull_sources',
            {}
        );
        return (res?.rows ?? []).map((r: any) => ({
            tariffId: r.tariff_id as number,
            provider: (r.provider as string | null) ?? null,
            providerConfig: r.provider_config ?? null
        }));
    }

    /**
     * Return prices in [from, to) plus the single most-recent price before
     * `from` (so a billing pass can price the first open bucket).
     */
    async getPrices(
        tariffId: number,
        from: Date,
        to: Date
    ): Promise<Array<{ts: string; price: number}>> {
        const res = await this.#deps.callDb(
            'organization.fn_tariff_live_prices',
            {
                p_tariff_id: tariffId,
                p_from: from,
                p_to: to
            }
        );
        return (res?.rows ?? []) as Array<{ts: string; price: number}>;
    }
}

let defaultInstance: Promise<LiveTariffRepository> | undefined;
export function defaultLiveTariffRepository(): Promise<LiveTariffRepository> {
    if (!defaultInstance) {
        defaultInstance = (async () => {
            const pg = await import('../PostgresProvider.js');
            return new LiveTariffRepository({
                callDb: pg.callMethod as DbCaller
            });
        })();
    }
    return defaultInstance;
}
