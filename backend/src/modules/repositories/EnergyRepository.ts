/**
 * Persistence seam for the `Energy.*` namespace.
 *
 * The repository owns:
 *   - A size-bounded TTL cache for shellyID ↔ internal-device-id lookups,
 *     so a single `Energy.Query` does not make N separate DB round-trips.
 *   - DB accessors that wrap the TimescaleDB functions `fn_report_stats`,
 *     `fn_report_stats_by_phase`, and `fn_numeric_history` (device_sensor).
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
import * as Observability from '../Observability';
import {sleep} from '../util/sleep';

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

interface JoinDateCacheEntry {
    // `found: false` is a device.list miss, cached like any other answer: an
    // id the fleet does not know always refuses loudly, so a stale miss can
    // only keep a refusal at the level it already had.
    found: boolean;
    joinedAt: Date | null;
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

export interface RollupReadConfig {
    waitMs: number;
    pollMs: number;
}

export interface RollupReadScheduler {
    now(): number;
    sleep(ms: number): Promise<void>;
}

/**
 * Rollup work in a report scope, by state. Ready work is due now; scheduled
 * work waits for its bucket to close and makes a period provisional, not
 * incomplete. Held and abandoned by reason.
 */
export interface RollupBacklogInScope {
    ready: number;
    scheduled: number;
    held: Readonly<Record<string, number>>;
    abandoned: Readonly<Record<string, number>>;
}

/** An open incomplete EM history range, as the completeness check stores it. */
export interface EmIncompleteRange {
    device: number;
    channel: number;
    kind: 'missing_records' | 'counter_mismatch';
    tag: string;
    from: Date;
    to: Date;
    expectedWh: number | null;
    storedWh: number | null;
}

interface EmIncompleteRangeRow {
    device: number;
    channel: number;
    kind: EmIncompleteRange['kind'];
    tag: string;
    range_from: Date | string;
    range_to: Date | string;
    expected_wh: number | null;
    stored_wh: number | null;
}

export function hasBlockedRollup(backlog: RollupBacklogInScope): boolean {
    return (
        Object.keys(backlog.held).length > 0 ||
        Object.keys(backlog.abandoned).length > 0
    );
}

// Work a reader must wait for or report; scheduled work is not pending.
export function rollupBacklogTotal(backlog: RollupBacklogInScope): number {
    const sum = (counts: Readonly<Record<string, number>>) =>
        Object.values(counts).reduce((total, count) => total + count, 0);
    return backlog.ready + sum(backlog.held) + sum(backlog.abandoned);
}

function invalidBacklog(): Error {
    return Object.assign(new Error('EM_ROLLUP_INVALID_PENDING'), {
        code: 'EM_ROLLUP_INVALID_PENDING'
    });
}

function backlogCount(value: unknown): number {
    const count =
        typeof value === 'number' ||
        (typeof value === 'string' && value.trim() !== '')
            ? Number(value)
            : Number.NaN;
    if (!Number.isSafeInteger(count) || count < 0) throw invalidBacklog();
    return count;
}

function backlogReason(value: unknown): string {
    if (typeof value !== 'string' || value === '') throw invalidBacklog();
    return value;
}

function parseRollupBacklog(rows: unknown[] | undefined): RollupBacklogInScope {
    if (!Array.isArray(rows)) throw invalidBacklog();
    let ready = 0;
    let scheduled = 0;
    const held: Record<string, number> = {};
    const abandoned: Record<string, number> = {};
    for (const row of rows) {
        if (!row || typeof row !== 'object') throw invalidBacklog();
        const {state, reason, buckets} = row as Record<string, unknown>;
        const count = backlogCount(buckets);
        if (state === 'ready') ready += count;
        else if (state === 'scheduled') scheduled += count;
        else if (state === 'held') held[backlogReason(reason)] = count;
        else if (state === 'abandoned')
            abandoned[backlogReason(reason)] = count;
        else throw invalidBacklog();
    }
    return {ready, scheduled, held, abandoned};
}

export interface EnergyRepositoryDeps {
    resolveDeviceIds: DeviceIdResolver;
    groupDevices: GroupDeviceResolver;
    fleetDevices: FleetDeviceSnapshot;
    callDb: DbCaller;
    /** Optional — falls back to DEFAULT_CACHE_CONFIG when omitted. */
    cacheConfig?: EnergyCacheConfig;
    /** Production report consistency guard. */
    rollupReadConfig?: RollupReadConfig;
    /** Time boundary for the consistency guard; injectable for deterministic tests. */
    rollupReadScheduler?: RollupReadScheduler;
}

export interface ReportStatsOpts {
    internalIds: readonly number[];
    from: Date;
    to: Date;
    tags: readonly string[];
    bucket: string;
    /** Commodity filter (electricity/water/heat). Omitted → all. */
    commodity?: string;
    /** Electrical-source filter (ac_mains/…). Omitted → all. */
    electricalSource?: string;
    perDevice: boolean;
    limit?: number;
    offset?: number;
}

// --- DB row types -------------------------------------------------------

export interface EnergyStatsRow {
    bucket: string;
    device: number;
    tag: string;
    /** Electrical domain the row was read from (ac_mains / dc_battery / …). */
    domain?: string;
    agg_value: number;
    /** Set only by by-phase queries; loose for 'z' / no-phase rows. */
    phase?: string;
}

export interface EnergyStatsByPhaseRow extends EnergyStatsRow {
    phase: 'a' | 'b' | 'c';
}

/** One bucket of device-total average power (W or VA), phases already summed. */
export interface DevicePowerAvgRow {
    /** timestamptz — the pg driver hands back a Date, not a string. */
    bucket: string | Date;
    device: number;
    avg_w: number | string;
}

/** One 15-minute energy bucket for one device channel — the cost-pass grain. */
export interface Energy15minByChannelRow {
    bucket: string;
    device: number;
    channel: number;
    tag: string;
    energy_wh: number;
}

export interface OperationalMetric15minByChannelRow {
    bucket: string | Date;
    device: number;
    channel: number;
    tag: string;
    value: number | string;
}

export interface CurrentHistoryByChannelRow {
    observed_at: string | Date;
    amps: number | string;
}

/** One stored point's daily energy interval for consumption anomaly evaluation. */
export interface DailyConsumptionRow {
    device: number;
    channel: number | null;
    tag: string;
    local_day: string | Date;
    local_day_start: string | Date;
    raw_total: number | string;
    max_bucket_value: number | string;
    observed_buckets: number | string;
    expected_buckets: number | string;
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
    /** Reading source (internal/builtin/addon/blu/weather) — device_sensor only. */
    source?: string;
}

export interface EmSyncStatusRow {
    device: number;
    channel: number;
    sync_created: number | string | null;
    rollup_pending: number | string;
    oldest_rollup_dirty: string | null;
    rollup_scheduled: number | string;
}

// --- Repository ---------------------------------------------------------

export class EnergyRepository {
    readonly #deviceIdCache = new Map<string, CacheEntry>();
    readonly #joinDateCache = new Map<number, JoinDateCacheEntry>();
    readonly #deps: EnergyRepositoryDeps;
    readonly #cacheConfig: EnergyCacheConfig;
    readonly #rollupReadConfig?: RollupReadConfig;
    readonly #rollupReadScheduler: RollupReadScheduler;

    constructor(deps: EnergyRepositoryDeps) {
        this.#deps = deps;
        this.#cacheConfig = deps.cacheConfig ?? DEFAULT_CACHE_CONFIG;
        this.#rollupReadConfig = deps.rollupReadConfig;
        this.#rollupReadScheduler = deps.rollupReadScheduler ?? {
            now: Date.now,
            sleep
        };
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

    /** Internal row ids to product-wide identities. Tariff assignment is keyed
     * by external id while a logical meter stores internal ones, so billing a
     * meter needs the translation the other accessors do not. */
    async resolveExternalIds(
        internalIds: readonly number[]
    ): Promise<Readonly<Record<number, string>>> {
        if (internalIds.length === 0) return {};
        const res = await this.#deps.callDb('device.fn_resolve_external_ids', {
            p_ids: [...internalIds]
        });
        const rows =
            (res?.rows as Array<{id: number; external_id: string}>) ?? [];
        return Object.fromEntries(rows.map((row) => [row.id, row.external_id]));
    }

    /**
     * When each device joined the fleet (`device.list.created`), by internal
     * id. A device the fleet does not know is left out of the map rather than
     * guessed at, so the caller can tell "joined then" from "cannot say".
     *
     * `created` never changes for a row, so answers and misses alike are
     * cached; the id-map TTL and cap are reused rather than adding a knob.
     */
    async resolveDeviceJoinDates(
        internalIds: readonly number[]
    ): Promise<ReadonlyMap<number, Date | null>> {
        const joined = new Map<number, Date | null>();
        if (internalIds.length === 0) return joined;
        const now = Date.now();
        const unread: number[] = [];
        for (const internalId of internalIds) {
            const hit = this.#joinDateCache.get(internalId);
            if (!hit || hit.expiresAt <= now) unread.push(internalId);
            else if (hit.found) joined.set(internalId, hit.joinedAt);
        }
        if (unread.length === 0) return joined;
        const res = await this.#deps.callDb('device.fn_device_join_dates', {
            p_ids: unread
        });
        const rows =
            (res?.rows as Array<{
                id: number;
                created: Date | string | null;
            }>) ?? [];
        const answered = new Set<number>();
        for (const row of rows) {
            const joinedAt = row.created ? new Date(row.created) : null;
            this.#storeJoinDate(row.id, true, joinedAt, now);
            joined.set(row.id, joinedAt);
            answered.add(row.id);
        }
        for (const internalId of unread) {
            if (!answered.has(internalId))
                this.#storeJoinDate(internalId, false, null, now);
        }
        return joined;
    }

    async queryEmSyncStatus(
        channels: readonly {device: number; channel: number}[]
    ): Promise<EmSyncStatusRow[]> {
        if (channels.length === 0) return [];
        const result = await this.#deps.callDb('device_em.fn_sync_status_v2', {
            p_devices: channels.map((item) => item.device),
            p_channels: channels.map((item) => item.channel)
        });
        return (result?.rows as EmSyncStatusRow[]) ?? [];
    }

    async queryRollupBacklogInScope(
        internalIds: readonly number[],
        from: Date,
        to: Date
    ): Promise<RollupBacklogInScope> {
        if (internalIds.length === 0)
            return {ready: 0, scheduled: 0, held: {}, abandoned: {}};
        const result = await this.#deps.callDb(
            'device_em.fn_rollup_backlog_in_scope',
            {
                p_devices: [...internalIds],
                p_from: from,
                p_to: to
            }
        );
        return parseRollupBacklog(result?.rows);
    }

    /** Open incomplete EM ranges overlapping [from, to), never as zero. */
    async queryEmIncompleteRanges(
        internalIds: readonly number[],
        from: Date,
        to: Date
    ): Promise<EmIncompleteRange[]> {
        if (internalIds.length === 0) return [];
        const result = await this.#deps.callDb(
            'device_em.fn_em_incomplete_ranges',
            {p_devices: [...internalIds], p_from: from, p_to: to}
        );
        return ((result?.rows ?? []) as EmIncompleteRangeRow[]).map((row) => ({
            device: row.device,
            channel: row.channel,
            kind: row.kind,
            tag: row.tag,
            from: new Date(row.range_from),
            to: new Date(row.range_to),
            expectedWh: row.expected_wh,
            storedWh: row.stored_wh
        }));
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

    /**
     * Average power per bucket as a DEVICE total, phases and channels summed.
     * queryEnergyStats cannot answer this: its sum_val/sample_count over
     * per-phase rows is a per-phase MEAN, about a third of a 3-phase meter.
     */
    async queryDevicePowerAvg(opts: {
        internalIds: readonly number[];
        from: Date;
        to: Date;
        bucket: string;
        /** Tag pair for the metric billed: active power or apparent power. */
        phaseTag: string;
        totalTag: string;
    }): Promise<DevicePowerAvgRow[]> {
        if (opts.internalIds.length === 0) return [];
        const method = bucketUsesRollup(opts.bucket)
            ? 'device_em.fn_device_power_avg'
            : 'device_em.fn_device_power_avg_raw';
        const res = await this.#deps.callDb(method, {
            p_devices: [...opts.internalIds],
            p_from: opts.from,
            p_to: opts.to,
            p_bucket: opts.bucket,
            p_phase_tag: opts.phaseTag,
            p_total_tag: opts.totalTag
        });
        return (res?.rows as DevicePowerAvgRow[]) ?? [];
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
        /** Optional clean-axis filters; omitted preserves report all-domain reads. */
        commodity?: string;
        electricalSource?: string;
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
                p_tags: [...opts.tags],
                p_commodity: opts.commodity ?? null,
                p_electrical_source: opts.electricalSource ?? null
            }
        );
        return (res?.rows as Energy15minByChannelRow[]) ?? [];
    }

    /** Per-channel instantaneous 15-minute values for operational verdicts. */
    async queryOperationalMetric15minByChannel(opts: {
        internalIds: readonly number[];
        from: Date;
        to: Date;
        tags: readonly string[];
        commodity?: string;
    }): Promise<OperationalMetric15minByChannelRow[]> {
        if (opts.internalIds.length === 0 || opts.tags.length === 0) return [];
        const res = await this.#deps.callDb(
            'device_em.fn_operational_metric_15min_by_channel',
            {
                p_devices: [...opts.internalIds],
                p_from: opts.from,
                p_to: opts.to,
                p_tags: [...opts.tags],
                p_commodity: opts.commodity ?? null
            }
        );
        return (res?.rows as OperationalMetric15minByChannelRow[]) ?? [];
    }

    /** Raw per-channel current history used to prove a sustained overload. */
    async queryCurrentHistoryByChannel(opts: {
        internalId: number;
        channel: number;
        from: Date;
        to: Date;
    }): Promise<CurrentHistoryByChannelRow[]> {
        const res = await this.#deps.callDb(
            'device_em.fn_current_history_by_channel',
            {
                p_device: opts.internalId,
                p_channel: opts.channel,
                p_from: opts.from,
                p_to: opts.to
            }
        );
        return (res?.rows as CurrentHistoryByChannelRow[]) ?? [];
    }

    /** SQL owns organization isolation and local-day/DST bucketing for daily point energy. */
    async queryDailyConsumption(opts: {
        organizationId: string;
        internalIds: readonly number[];
        from: Date;
        to: Date;
        tags: readonly string[];
        timezone: string;
    }): Promise<DailyConsumptionRow[]> {
        if (opts.internalIds.length === 0 || opts.tags.length === 0) {
            return [];
        }
        const res = await this.#deps.callDb('device_em.fn_daily_consumption', {
            p_organization_id: opts.organizationId,
            p_devices: [...opts.internalIds],
            p_tags: [...opts.tags],
            p_from: opts.from,
            p_to: opts.to,
            p_tz: opts.timezone
        });
        return (res?.rows as DailyConsumptionRow[]) ?? [];
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

    /**
     * Avg + true min/max per tag over the window. Tags with no data are absent.
     * AC-electricity metrics (voltage, power_factor) — pinned to that source.
     */
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
                p_tags: [...opts.tags],
                p_commodity: 'electricity',
                p_electrical_source: 'ac_mains'
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
        // p_commodity / p_electrical_source omitted → the fn's NULL default
        // returns every commodity/source. Passed → filter to that value.
        // No hidden default: nothing is silently excluded.
        const args: Record<string, unknown> = {
            p_devices: [...opts.internalIds],
            p_from: opts.from,
            p_to: opts.to,
            p_tags: [...opts.tags],
            p_bucket: opts.bucket,
            p_per_device: opts.perDevice
        };
        if (opts.commodity !== undefined) args.p_commodity = opts.commodity;
        if (opts.electricalSource !== undefined)
            args.p_electrical_source = opts.electricalSource;
        if (usePaged) {
            args.p_limit = opts.limit;
            args.p_offset = opts.offset ?? 0;
        }
        const res = await this.#deps.callDb(usePaged ? pagedFn : baseFn, args);
        return (res?.rows as T[]) ?? [];
    }

    // Waits only for ready work; held or abandoned work never finishes alone.
    async waitForRollup(
        internalIds: readonly number[],
        from: Date,
        to: Date
    ): Promise<RollupBacklogInScope> {
        const config = this.#rollupReadConfig;
        const none: RollupBacklogInScope = {
            ready: 0,
            scheduled: 0,
            held: {},
            abandoned: {}
        };
        if (!config || internalIds.length === 0) return none;
        const deadline = this.#rollupReadScheduler.now() + config.waitMs;
        let observed = false;
        while (true) {
            const backlog = await this.queryRollupBacklogInScope(
                internalIds,
                from,
                to
            );
            if (backlog.ready <= 0 || hasBlockedRollup(backlog)) return backlog;
            if (!observed) {
                Observability.incrementCounter('em_report_waiting_for_rollup');
                observed = true;
            }
            if (this.#rollupReadScheduler.now() >= deadline) {
                Observability.incrementCounter('em_report_rollup_timeout');
                throw new Error(
                    `energy report is waiting for ${backlog.ready} rollup buckets`
                );
            }
            await this.#rollupReadScheduler.sleep(config.pollMs);
        }
    }

    /**
     * Numeric sensor history from the forever rollup
     * (device_sensor.fn_numeric_history). `field` carries the sensor kind
     * (e.g. 'temperature', 'co2') — no source filter, so rows from every
     * source (internal/builtin/addon/blu/weather) for that kind come back
     * together, grouped by source.
     */
    async queryEnvironmental(opts: {
        organizationId: string | null;
        internalIds: readonly number[];
        field: string;
        from: Date;
        to: Date;
        bucket: string;
        limit?: number;
        offset?: number;
    }): Promise<EnvironmentalStatsRow[]> {
        if (opts.internalIds.length === 0) {
            return [];
        }
        const paged = opts.offset !== undefined;
        const res = await this.#deps.callDb(
            paged
                ? 'device_sensor.fn_numeric_history_paged'
                : 'device_sensor.fn_numeric_history',
            {
                p_organization_id: opts.organizationId,
                p_device_ids: [...opts.internalIds],
                p_kind: opts.field,
                p_source: null,
                p_from: opts.from.toISOString(),
                p_to: opts.to.toISOString(),
                p_bucket: opts.bucket,
                p_limit: opts.limit ?? null,
                ...(paged ? {p_offset: opts.offset} : {})
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
        this.#joinDateCache.clear();
    }

    #storeJoinDate(
        internalId: number,
        found: boolean,
        joinedAt: Date | null,
        now: number
    ): void {
        if (this.#joinDateCache.size >= this.#cacheConfig.idMapMaxEntries) {
            // Same FIFO eviction as the id map — Map iterates in insertion
            // order, so the first key is the oldest.
            const firstKey = this.#joinDateCache.keys().next().value;
            if (firstKey !== undefined) this.#joinDateCache.delete(firstKey);
        }
        this.#joinDateCache.set(internalId, {
            found,
            joinedAt,
            expiresAt: now + this.#cacheConfig.idMapTtlMs
        });
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
                },
                rollupReadConfig: {
                    waitMs: t.energy.rollupReportWaitMs,
                    pollMs: t.energy.rollupReportPollMs
                }
            });
        })();
    }
    return defaultInstance;
}

export async function invalidateDefaultEnergyRepository(): Promise<void> {
    const instance = defaultInstance;
    if (!instance) return;
    (await instance).invalidate();
}
