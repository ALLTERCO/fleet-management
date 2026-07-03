/**
 * Persistence seam for the `Energy.*` namespace.
 *
 * The repository owns:
 *   - A size-bounded TTL cache for shellyID ↔ internal-device-id lookups,
 *     so a single `Energy.Query` does not make N separate DB round-trips.
 *   - DB accessors that wrap the TimescaleDB functions `fn_report_stats`,
 *     `fn_report_stats_by_phase`, and `fn_status_environmental_history`.
 *   - Group-device resolution (`device.fn_groups_get`).
 *
 * Eviction policy: per the 2026-04-17 audit finding #2, unbounded module-
 * level caches (FM.deviceNameCache) are a known regression — the cache
 * here is capped at `MAX_ENTRIES` and uses absolute TTL so it cannot grow
 * without bound under reconnect storms.
 *
 * All external effects (DB, device collector) are passed in through
 * `EnergyRepositoryDeps` so tests substitute fakes without dragging in
 * the config / plugin init graph.
 */

import {bucketUsesRollup} from '../../config/energy';

/**
 * Default cache sizing used when callers construct the repository
 * without explicit `cacheConfig`. Matches the env-driven `FM_ENERGY_IDMAP_CACHE_*`
 * defaults so tests that instantiate the repository bare see sensible TTLs
 * without importing config / plugin init. Production call sites go through
 * `defaultEnergyRepository()` which forwards the live tuning values.
 */
const DEFAULT_CACHE_CONFIG: EnergyCacheConfig = {
    idMapTtlMs: 60_000,
    idMapMaxEntries: 5_000
};

interface CacheEntry {
    internalIds: readonly number[];
    idMap: Readonly<Record<number, string>>;
    expiresAt: number;
}

/** Resolve a list of shellyIDs to internal ids (and the inverse map). */
export type DeviceIdResolver = (
    shellyIDs: string[]
) => Promise<{internalIds: number[]; idMap: Record<number, string>}>;

/**
 * Fetch a group's device shellyIDs.
 *
 * Post-slice-E, groups live under `organization.groups` with membership in
 * `organization.group_members`, so the caller must supply the
 * organization scope. The legacy `device.fn_groups_get` call (org-blind)
 * was removed when the underlying `device.groups` table was dropped.
 */
export type GroupDeviceResolver = (
    groupId: number,
    organizationId: string
) => Promise<string[]>;

/** Return every in-memory device the backend currently has — used for fleet scope. */
export type FleetDeviceSnapshot = () => Array<{id: number; shellyID: string}>;

/** Raw DB function caller (PostgresProvider.callMethod). */
export type DbCaller = (
    method: string,
    params: Record<string, unknown>
) => Promise<{rows: unknown[]} | null | undefined>;

/** Cache sizing — TTLs + bounded LRU entry caps. */
export interface EnergyCacheConfig {
    idMapTtlMs: number;
    idMapMaxEntries: number;
}

export interface EnergyRepositoryDeps {
    resolveDeviceIds: DeviceIdResolver;
    groupDevices: GroupDeviceResolver;
    fleetDevices: FleetDeviceSnapshot;
    callDb: DbCaller;
    /** Optional — falls back to DEFAULT_CACHE_CONFIG when omitted. */
    cacheConfig?: EnergyCacheConfig;
}

export interface ReportStatsOpts {
    internalIds: readonly number[];
    from: Date;
    to: Date;
    tags: readonly string[];
    bucket: string;
    perDevice: boolean;
    limit?: number;
    offset?: number;
}

// --- DB row types -------------------------------------------------------

export interface EnergyStatsRow {
    bucket: string;
    device: number;
    tag: string;
    agg_value: number;
    /** Set only by by-phase queries; loose for 'z' / no-phase rows. */
    phase?: string;
}

export interface EnergyStatsByPhaseRow extends EnergyStatsRow {
    phase: 'a' | 'b' | 'c';
}

/** One 15-minute energy bucket for one device channel — the cost-pass grain. */
export interface Energy15minByChannelRow {
    bucket: string;
    device: number;
    channel: number;
    tag: string;
    energy_wh: number;
}

// One distinct stored point per (device, channel, phase, tag, domain) with its
// latest bucket. componentKey is absent — the rollup drops it — so the caller
// labels it from the live snapshot.
export interface MeasurementPointHistoryRow {
    device: number;
    channel: number;
    phase: string;
    tag: string;
    domain: string;
    sum_val: number;
    sample_count: number;
    sample_ts: string;
}

export interface EnvironmentalStatsRow {
    bucket: string;
    device_id: number;
    avg_value: number | string;
    min_value: number | string;
    max_value: number | string;
}

// --- Repository ---------------------------------------------------------

export class EnergyRepository {
    readonly #deviceIdCache = new Map<string, CacheEntry>();
    readonly #deps: EnergyRepositoryDeps;
    readonly #cacheConfig: EnergyCacheConfig;

    constructor(deps: EnergyRepositoryDeps) {
        this.#deps = deps;
        this.#cacheConfig = deps.cacheConfig ?? DEFAULT_CACHE_CONFIG;
    }

    /**
     * Resolve a list of shellyIDs to internal device ids, with TTL caching.
     * The cache key is the sorted shellyID list — identical queries share an
     * entry. Entries outside the TTL are lazily replaced.
     */
    async resolveDevices(shellyIDs: readonly string[]): Promise<{
        readonly internalIds: readonly number[];
        readonly idMap: Readonly<Record<number, string>>;
    }> {
        if (shellyIDs.length === 0) {
            return {internalIds: [], idMap: {}};
        }
        const key = [...shellyIDs].sort().join('\0');
        const now = Date.now();
        const hit = this.#deviceIdCache.get(key);
        if (hit && hit.expiresAt > now) {
            return {internalIds: hit.internalIds, idMap: hit.idMap};
        }
        const resolved = await this.#deps.resolveDeviceIds([...shellyIDs]);
        // Freeze before caching so a caller cannot mutate the shared
        // reference on a later cache hit. Shallow freeze is sufficient —
        // the shape is {number[], Record<number, string>}.
        Object.freeze(resolved.internalIds);
        Object.freeze(resolved.idMap);
        const frozen = Object.freeze(resolved);
        this.#storeCacheEntry(key, frozen, now);
        return frozen;
    }

    /** Resolve a group's membership to internal ids + shellyID map. */
    async resolveGroupDevices(
        groupId: number,
        organizationId: string
    ): Promise<{
        readonly internalIds: readonly number[];
        readonly idMap: Readonly<Record<number, string>>;
    }> {
        const shellyIDs = await this.#deps.groupDevices(
            groupId,
            organizationId
        );
        return this.resolveDevices(shellyIDs);
    }

    /** Return the fleet-wide device set. Not cached — DeviceCollector is in-memory. */
    resolveFleetDevices(): {
        internalIds: number[];
        idMap: Record<number, string>;
    } {
        const snapshot = this.#deps.fleetDevices();
        const internalIds: number[] = [];
        const idMap: Record<number, string> = {};
        for (const d of snapshot) {
            if (d.id > 0) {
                internalIds.push(d.id);
                idMap[d.id] = d.shellyID;
            }
        }
        return {internalIds, idMap};
    }

    /**
     * Wrap device_em.fn_report_stats; paged variant when limit is set. Buckets
     * 15 min and coarser route to the rollup (long-term + fast); finer buckets
     * read raw (the 1-month hot window).
     */
    async queryEnergyStats(opts: ReportStatsOpts): Promise<EnergyStatsRow[]> {
        const [baseFn, pagedFn] = bucketUsesRollup(opts.bucket)
            ? [
                  'device_em.fn_report_stats_rollup',
                  'device_em.fn_report_stats_rollup_paged'
              ]
            : ['device_em.fn_report_stats', 'device_em.fn_report_stats_paged'];
        return this.#callReportStats(baseFn, pagedFn, opts);
    }

    /** By-phase variant of queryEnergyStats — same raw/rollup routing. */
    async queryEnergyStatsByPhase(
        opts: ReportStatsOpts
    ): Promise<EnergyStatsByPhaseRow[]> {
        const [baseFn, pagedFn] = bucketUsesRollup(opts.bucket)
            ? [
                  'device_em.fn_report_stats_rollup_by_phase',
                  'device_em.fn_report_stats_rollup_by_phase_paged'
              ]
            : [
                  'device_em.fn_report_stats_by_phase',
                  'device_em.fn_report_stats_by_phase_paged'
              ];
        return this.#callReportStats(baseFn, pagedFn, opts);
    }

    /**
     * Per-channel 15-minute energy for the report cost pass. Kept at the finest
     * grain (no re-bucketing) so the engine can classify each piece by the
     * tariff window in local time — the proper fix for day/night cost at coarse
     * display granularity. Reads the long-term rollup, so it is correct for old
     * periods where raw stats have expired.
     */
    async queryEnergy15minByChannel(opts: {
        internalIds: readonly number[];
        from: Date;
        to: Date;
        tags: readonly string[];
    }): Promise<Energy15minByChannelRow[]> {
        if (opts.internalIds.length === 0 || opts.tags.length === 0) {
            return [];
        }
        const res = await this.#deps.callDb(
            'device_em.fn_report_energy_15min_by_channel',
            {
                p_devices: [...opts.internalIds],
                p_from: opts.from,
                p_to: opts.to,
                p_tags: [...opts.tags]
            }
        );
        return (res?.rows as Energy15minByChannelRow[]) ?? [];
    }

    /** Distinct stored measurement points for a device set — the wizard's history source. */
    async listMeasurementPointHistory(
        internalIds: readonly number[]
    ): Promise<MeasurementPointHistoryRow[]> {
        if (internalIds.length === 0) return [];
        const res = await this.#deps.callDb(
            'device_em.fn_list_measurement_points',
            {p_devices: [...internalIds]}
        );
        return (res?.rows as MeasurementPointHistoryRow[]) ?? [];
    }

    /** Per-(device, channel) energy totals over the window, for PV meter refs. */
    async queryChannelEnergyTotals(opts: {
        internalIds: readonly number[];
        from: Date;
        to: Date;
        tags: readonly string[];
    }): Promise<
        Array<{
            device: number;
            channel: number | null;
            tag: string;
            totalWh: number;
        }>
    > {
        if (opts.internalIds.length === 0 || opts.tags.length === 0) return [];
        const res = await this.#deps.callDb(
            'device_em.fn_report_channel_energy_totals',
            {
                p_devices: [...opts.internalIds],
                p_from: opts.from,
                p_to: opts.to,
                p_tags: [...opts.tags]
            }
        );
        const rows =
            (res?.rows as Array<{
                device: number;
                channel: number | null;
                tag: string;
                total_wh: number | null;
            }>) ?? [];
        return rows.map((r) => ({
            device: r.device,
            channel: r.channel,
            tag: r.tag,
            totalWh: r.total_wh ?? 0
        }));
    }

    /** True peak power (W) over the window — MAX of 15-min maxes. null if no data. */
    async queryPeakPowerW(opts: {
        internalIds: readonly number[];
        from: Date;
        to: Date;
    }): Promise<number | null> {
        if (opts.internalIds.length === 0) return null;
        const res = await this.#deps.callDb('device_em.fn_report_power_peak', {
            p_devices: [...opts.internalIds],
            p_from: opts.from,
            p_to: opts.to
        });
        const row = res?.rows?.[0] as Record<string, unknown> | undefined;
        if (!row) return null;
        const v = Object.values(row)[0];
        return typeof v === 'number' ? v : v == null ? null : Number(v);
    }

    /** Grid frequency over the window (Hz): sample-weighted avg + true min/max. null fields if no data. */
    async queryFrequencyStats(opts: {
        internalIds: readonly number[];
        from: Date;
        to: Date;
    }): Promise<{
        avgHz: number | null;
        minHz: number | null;
        maxHz: number | null;
    }> {
        if (opts.internalIds.length === 0) {
            return {avgHz: null, minHz: null, maxHz: null};
        }
        const res = await this.#deps.callDb(
            'device_em.fn_report_frequency_stats',
            {
                p_devices: [...opts.internalIds],
                p_from: opts.from,
                p_to: opts.to
            }
        );
        const row = res?.rows?.[0] as
            | {
                  avg_hz: number | null;
                  min_hz: number | null;
                  max_hz: number | null;
              }
            | undefined;
        return {
            avgHz: row?.avg_hz ?? null,
            minHz: row?.min_hz ?? null,
            maxHz: row?.max_hz ?? null
        };
    }

    /** Avg + true min/max per tag over the window. Tags with no data are absent. */
    async queryMetricStats(opts: {
        internalIds: readonly number[];
        from: Date;
        to: Date;
        tags: readonly string[];
    }): Promise<
        Map<
            string,
            {avg: number | null; min: number | null; max: number | null}
        >
    > {
        const out = new Map<
            string,
            {avg: number | null; min: number | null; max: number | null}
        >();
        if (opts.internalIds.length === 0 || opts.tags.length === 0) return out;
        const res = await this.#deps.callDb(
            'device_em.fn_report_metric_stats',
            {
                p_devices: [...opts.internalIds],
                p_from: opts.from,
                p_to: opts.to,
                p_tags: [...opts.tags]
            }
        );
        const rows =
            (res?.rows as
                | Array<{
                      tag: string;
                      avg_val: number | null;
                      min_val: number | null;
                      max_val: number | null;
                  }>
                | undefined) ?? [];
        for (const row of rows) {
            out.set(row.tag, {
                avg: row.avg_val ?? null,
                min: row.min_val ?? null,
                max: row.max_val ?? null
            });
        }
        return out;
    }

    async #callReportStats<T extends EnergyStatsRow>(
        baseFn: string,
        pagedFn: string,
        opts: ReportStatsOpts
    ): Promise<T[]> {
        if (opts.internalIds.length === 0 || opts.tags.length === 0) {
            return [];
        }
        const usePaged = typeof opts.limit === 'number' && opts.limit > 0;
        const args: Record<string, unknown> = {
            p_devices: [...opts.internalIds],
            p_from: opts.from,
            p_to: opts.to,
            p_tags: [...opts.tags],
            p_bucket: opts.bucket,
            p_per_device: opts.perDevice
        };
        if (usePaged) {
            args.p_limit = opts.limit;
            args.p_offset = opts.offset ?? 0;
        }
        const res = await this.#deps.callDb(usePaged ? pagedFn : baseFn, args);
        return (res?.rows as T[]) ?? [];
    }

    /** Wrap device.fn_status_environmental_history; bucket param ignored (DB hardcodes 1h). */
    async queryEnvironmental(opts: {
        organizationId: string | null;
        internalIds: readonly number[];
        fieldPattern: string;
        from: Date;
        to: Date;
        limit?: number;
    }): Promise<EnvironmentalStatsRow[]> {
        if (opts.internalIds.length === 0) {
            return [];
        }
        const res = await this.#deps.callDb(
            'device.fn_status_environmental_history',
            {
                p_organization_id: opts.organizationId,
                p_device_ids: [...opts.internalIds],
                p_field_pattern: opts.fieldPattern,
                p_from: opts.from.toISOString(),
                p_to: opts.to.toISOString(),
                p_limit: opts.limit ?? null
            }
        );
        return (res?.rows as EnvironmentalStatsRow[]) ?? [];
    }

    /** Wrap device.fn_resolve_scope — scope kind+id → shellyID list. */
    async resolveScopeShellyIDs(opts: {
        orgId: string;
        scopeKind: 'group' | 'location' | 'tag' | 'fleet';
        scopeId: number | null;
    }): Promise<string[]> {
        const res = await this.#deps.callDb('device.fn_resolve_scope', {
            p_org_id: opts.orgId,
            p_scope_kind: opts.scopeKind,
            p_scope_id: opts.scopeId
        });
        const rows = (res?.rows ?? []) as Array<{shelly_id?: string | null}>;
        return rows
            .map((r) => r.shelly_id)
            .filter((s): s is string => typeof s === 'string');
    }

    /** Test/ops hook — invalidate all cached id resolutions. */
    invalidate(): void {
        this.#deviceIdCache.clear();
    }

    /** Current cache population — for observability hooks. */
    cacheSize(): number {
        return this.#deviceIdCache.size;
    }

    #storeCacheEntry(
        key: string,
        resolved: {
            readonly internalIds: readonly number[];
            readonly idMap: Readonly<Record<number, string>>;
        },
        now: number
    ): void {
        if (this.#deviceIdCache.size >= this.#cacheConfig.idMapMaxEntries) {
            // FIFO eviction — Map iterates in insertion order, so the first
            // key is the oldest. True LRU would require touching on read;
            // 60s TTL plus a 5000-entry cap makes churn rare enough that
            // FIFO is sufficient for Phase 2.
            const firstKey = this.#deviceIdCache.keys().next().value;
            if (firstKey !== undefined) this.#deviceIdCache.delete(firstKey);
        }
        this.#deviceIdCache.set(key, {
            internalIds: resolved.internalIds,
            idMap: resolved.idMap,
            expiresAt: now + this.#cacheConfig.idMapTtlMs
        });
    }
}

/**
 * Lazily constructed default repository wired to the production deps.
 * Separate factory (rather than a module-level singleton) keeps the
 * PostgresProvider / DeviceCollector imports from pulling config init
 * into unit tests that just want the class. Memoizes the in-flight
 * promise so two concurrent first-callers share one construction.
 */
let defaultInstance: Promise<EnergyRepository> | undefined;
export function defaultEnergyRepository(): Promise<EnergyRepository> {
    if (!defaultInstance) {
        defaultInstance = (async () => {
            const pg = await import('../PostgresProvider.js');
            const dc = await import('../DeviceCollector.js');
            const cfg = await import('../../config/index.js');
            const t = cfg.tuning;
            return new EnergyRepository({
                resolveDeviceIds: pg.resolveDeviceIds,
                groupDevices: async (groupId, organizationId) => {
                    const rows = await pg.listGroupDeviceMemberships(
                        organizationId,
                        [groupId]
                    );
                    return rows.map((r) => r.subject_id);
                },
                fleetDevices: () =>
                    dc.getAll().map((d) => ({
                        id: d.id,
                        shellyID: d.shellyID as string
                    })),
                callDb: pg.callMethod as DbCaller,
                cacheConfig: {
                    idMapTtlMs: t.energy.idMapCacheTtlMs,
                    idMapMaxEntries: t.energy.idMapCacheMax
                }
            });
        })();
    }
    return defaultInstance;
}
