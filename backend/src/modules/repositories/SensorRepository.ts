/**
 * Persistence seam for the `Sensor.*` namespace — reads `device_sensor`:
 *   - queryEvents  → device_sensor.fn_events_query   (discrete events)
 *   - queryNumeric → device_sensor.fn_numeric_history (15-minute numeric rollup)
 *
 * EnergyRepository.queryEnvironmental also wraps fn_numeric_history, but for
 * Energy.Query's dashboard env branch and without a source filter. The two stay
 * separate until that branch is migrated onto Sensor.Query — keeping the sensor
 * read (source-aware) in the sensor repository, not blurred into the energy one.
 */

export type SensorDbCaller = (
    method: string,
    params: Record<string, unknown>
) => Promise<{rows: unknown[]} | null | undefined>;

export interface SensorEventsRow {
    ts: string;
    device_id: number;
    source: string;
    kind: string;
    channel: number | null;
    state: number;
}

export interface SensorNumericRow {
    bucket: string;
    device_id: number;
    source: string;
    channel: number | null;
    sample_count: number | string;
    // NUMERIC columns arrive as string from the pg driver — the handler coerces.
    avg_value: number | string | null;
    min_value: number | string | null;
    max_value: number | string | null;
}

export interface SensorRepositoryDeps {
    callDb: SensorDbCaller;
}

export class SensorRepository {
    readonly #deps: SensorRepositoryDeps;

    constructor(deps: SensorRepositoryDeps) {
        this.#deps = deps;
    }

    /** Wrap device_sensor.fn_events_query — newest-first, optional kind filter. */
    async queryEvents(opts: {
        organizationId: string | null;
        internalIds: readonly number[];
        kind: string | null;
        from: Date;
        to: Date;
        limit?: number;
    }): Promise<SensorEventsRow[]> {
        if (opts.internalIds.length === 0) {
            return [];
        }
        const res = await this.#deps.callDb('device_sensor.fn_events_query', {
            p_organization_id: opts.organizationId,
            p_device_ids: [...opts.internalIds],
            p_kind: opts.kind,
            p_from: opts.from.toISOString(),
            p_to: opts.to.toISOString(),
            p_limit: opts.limit ?? null
        });
        return (res?.rows as SensorEventsRow[]) ?? [];
    }

    /**
     * Wrap device_sensor.fn_numeric_history — one sensor kind, re-bucketed to
     * sample-weighted avg + true min/max, grouped per (device, source, channel).
     * A null source returns every source; a set source filters to it.
     */
    async queryNumeric(opts: {
        organizationId: string | null;
        internalIds: readonly number[];
        kind: string;
        source: string | null;
        from: Date;
        to: Date;
        bucket: string;
        limit?: number;
    }): Promise<SensorNumericRow[]> {
        if (opts.internalIds.length === 0) {
            return [];
        }
        const res = await this.#deps.callDb(
            'device_sensor.fn_numeric_history',
            {
                p_organization_id: opts.organizationId,
                p_device_ids: [...opts.internalIds],
                p_kind: opts.kind,
                p_source: opts.source,
                p_from: opts.from.toISOString(),
                p_to: opts.to.toISOString(),
                p_bucket: opts.bucket,
                p_limit: opts.limit ?? null
            }
        );
        return (res?.rows as SensorNumericRow[]) ?? [];
    }
}

/**
 * Lazily constructed default repository wired to PostgresProvider. Separate
 * factory (not a module-level singleton) keeps PostgresProvider import out
 * of unit tests that just want the class. Memoizes the in-flight promise so
 * two concurrent first-callers share one construction.
 */
let defaultInstance: Promise<SensorRepository> | undefined;
export function defaultSensorRepository(): Promise<SensorRepository> {
    if (!defaultInstance) {
        defaultInstance = (async () => {
            const pg = await import('../PostgresProvider.js');
            return new SensorRepository({
                callDb: pg.callMethod as SensorDbCaller
            });
        })();
    }
    return defaultInstance;
}
