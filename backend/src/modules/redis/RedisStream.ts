// Typed wrapper over ioredis XADD/XREADGROUP/XACK/XTRIM/XLEN/PEXPIRE.
import type {Redis} from 'ioredis';
import log4js from 'log4js';
import * as Observability from '../Observability';
import {
    isRedisWriteBackpressureError,
    runWithRedisWriteCapacity
} from './commandBackpressure';

const logger = log4js.getLogger('redis-stream');

export interface AppendOptions {
    /** Approx MAXLEN trim — uses XADD MAXLEN ~. */
    maxlen?: number;
    /** TTL on the stream key, refreshed on every append. */
    ttlMs?: number;
    /** Pre-flight gate. Returning false skips XADD + bumps `fm_xadd_rate_limited_total`. */
    rateCheck?: () => Promise<boolean>;
    /** Short label for the rate-limit counter; defaults to the stream key. */
    rateLabel?: string;
}

export interface RedisStreamOptions {
    /** Bound pending ioredis writes. 0 disables write backpressure. */
    maxPendingWrites?: number;
    /** Count the bytes the stream holds; required by byte-budget appends. */
    byteLedger?: ByteLedgerKeys;
}

export interface ByteLedgerKeys {
    /** Hash: entry id -> bytes accounted for that entry. */
    ledgerKey: string;
    /** String: bytes of every entry plus every shared value. */
    bytesKey: string;
    /** Hash of values many entries refer to, stored and counted once. */
    sharedKey: string;
}

export interface ByteBudgetAppendOptions extends Omit<AppendOptions, 'maxlen'> {
    /** Refuse the append when the accounted bytes would pass this budget. */
    budgetBytes: number;
    /** Refuse the append when the stream would hold more entries. 0 = none. */
    cap: number;
    /** A value the entries refer to, stored once in the shared hash. */
    shared?: {field: string; value: string};
}

/** Entries admitted whole or refused whole, with the value they refer to. */
export interface ByteBudgetGroup {
    entries: ReadonlyArray<Record<string, string>>;
    shared?: {field: string; value: string};
}

export type ByteBudgetGroupOptions = Omit<ByteBudgetAppendOptions, 'shared'>;

export interface CappedAppendOptions extends Omit<AppendOptions, 'maxlen'> {
    /** Refuse the append when XLEN is already at this cap. Never trims. */
    cap: number;
}

export interface HighWaterMark {
    /** Redis hash key that owns the durable progress markers. */
    key: string;
    /** Hash field for one independently ordered producer lane. */
    field: string;
    /** Monotonic progress value. Lower retries never move it backwards. */
    value: number;
}

export interface TrimmingAppendOptions extends Omit<AppendOptions, 'maxlen'> {
    /** Keep at most this many entries, trimming the oldest entries exactly. */
    maxlen: number;
}

export interface TrimmingAppendResult {
    id: string;
    length: number;
    trimmed: number;
}

const ACK_AND_DELETE_LUA = `
local acked = redis.call('XACK', KEYS[1], ARGV[1], unpack(ARGV, 2))
redis.call('XDEL', KEYS[1], unpack(ARGV, 2))
return acked
`;

export interface ReadGroupOptions {
    /** Consumer group name. */
    group: string;
    /** Consumer name within the group. */
    consumer: string;
    /** Max entries per read. */
    count: number;
    /** Block ms (0 = no block). */
    blockMs: number;
}

export interface StreamEntry {
    id: string;
    fields: Record<string, string>;
}

export interface StreamPendingSummary {
    count: number;
    oldestId: string | null;
    newestId: string | null;
}

export class RedisStream {
    readonly #client: Redis;
    readonly #key: string;
    readonly #maxPendingWrites: number;
    readonly #byteLedger: ByteLedgerKeys | undefined;

    constructor(client: Redis, key: string, opts: RedisStreamOptions = {}) {
        this.#client = client;
        this.#key = key;
        this.#maxPendingWrites = opts.maxPendingWrites ?? 0;
        this.#byteLedger = opts.byteLedger;
    }

    get key(): string {
        return this.#key;
    }

    #runAppend<T>(
        opts: AppendOptions,
        append: () => Promise<T>
    ): Promise<T | null> {
        return runWithRedisWriteCapacity(
            this.#client,
            this.#maxPendingWrites,
            opts.rateLabel ?? 'stream',
            async () => {
                if (!opts.rateCheck || (await opts.rateCheck())) {
                    return append();
                }
                Observability.incrementLabeledCounter(
                    'xadd_rate_limited_total',
                    {
                        stream: opts.rateLabel ?? this.#key
                    }
                );
                return null;
            }
        );
    }

    #flattenFields(fields: Record<string, string>): string[] {
        return Object.entries(fields).flat();
    }

    async append(
        fields: Record<string, string>,
        opts: AppendOptions = {}
    ): Promise<string | null> {
        const flat = this.#flattenFields(fields);
        try {
            return await this.#runAppend(opts, async () => {
                let id: string;
                if (opts.maxlen) {
                    id = (await this.#client.xadd(
                        this.#key,
                        'MAXLEN',
                        '~',
                        String(opts.maxlen),
                        '*',
                        ...flat
                    )) as string;
                } else {
                    id = (await this.#client.xadd(
                        this.#key,
                        '*',
                        ...flat
                    )) as string;
                }
                // Best-effort: a TTL-refresh failure must not fail the append.
                if (opts.ttlMs) {
                    await this.#refreshTtl(opts.ttlMs);
                }
                return id;
            });
        } catch (err) {
            // Backpressure is already counted by the capacity gate, and every
            // caller swallows it. Logging it here defeated that: a log line is
            // itself appended to the ws stream, so one shed event logged, that
            // log sheds, and it never stops.
            if (isRedisWriteBackpressureError(err)) throw err;
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('xadd failed key=%s: %s', this.#key, err);
            throw err;
        }
    }

    /**
     * Lossless bounded append. The XLEN check and XADD execute in one Redis
     * script, so concurrent producers cannot all race through the final slot.
     * At capacity this returns null and leaves every existing entry intact.
     */
    async appendIfBelowCap(
        fields: Record<string, string>,
        opts: CappedAppendOptions
    ): Promise<string | null> {
        const flat = this.#flattenFields(fields);
        try {
            const result = await this.#runAppend(opts, () =>
                this.#client.eval(
                    CAPPED_XADD_LUA,
                    1,
                    this.#key,
                    String(opts.cap),
                    String(opts.ttlMs ?? 0),
                    ...flat
                )
            );
            return result === false || result === null ? null : String(result);
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('capped xadd failed key=%s: %s', this.#key, err);
            throw err;
        }
    }

    /**
     * Lossless bounded append with durable producer progress. The stream entry
     * and its monotonic high-water mark change in one Redis script.
     */
    async appendIfBelowCapAndAdvanceHighWater(
        fields: Record<string, string>,
        opts: CappedAppendOptions & {highWater: HighWaterMark}
    ): Promise<string | null> {
        const flat = this.#flattenFields(fields);
        try {
            const result = await this.#runAppend(opts, () =>
                this.#client.eval(
                    CAPPED_XADD_AND_HIGH_WATER_LUA,
                    2,
                    this.#key,
                    opts.highWater.key,
                    String(opts.cap),
                    String(opts.ttlMs ?? 0),
                    opts.highWater.field,
                    String(opts.highWater.value),
                    ...flat
                )
            );
            return result === false || result === null ? null : String(result);
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn(
                'capped xadd with high-water failed key=%s: %s',
                this.#key,
                err
            );
            throw err;
        }
    }

    /**
     * Lossless append bounded in bytes. The budget check, every XADD, the
     * per-entry ledger and the byte total change in one Redis script, so
     * concurrent producers can never pass the budget together. All entries
     * are admitted or none. Returns the new ids, or null when refused.
     */
    async appendWithinByteBudget(
        entries: ReadonlyArray<Record<string, string>>,
        opts: ByteBudgetAppendOptions
    ): Promise<string[] | null> {
        const [ids] = await this.appendGroupsWithinByteBudget(
            [{entries, shared: opts.shared}],
            opts
        );
        return ids;
    }

    /**
     * Several byte-budget appends in one script and one round trip. Groups
     * are taken in order, each admitted whole or refused whole exactly as if
     * appended one by one, so a refused group does not refuse the next.
     * Returns each group's new ids, or null where it was refused.
     */
    async appendGroupsWithinByteBudget(
        groups: ReadonlyArray<ByteBudgetGroup>,
        opts: ByteBudgetGroupOptions
    ): Promise<Array<string[] | null>> {
        const ledger = this.#requireByteLedger();
        const args = [
            String(opts.budgetBytes),
            String(opts.cap),
            String(opts.ttlMs ?? 0),
            String(groups.length),
            ...groups.flatMap((group) => [
                group.shared?.field ?? '',
                group.shared?.value ?? '',
                String(group.entries.length),
                ...group.entries.flatMap((fields) => {
                    const flat = this.#flattenFields(fields);
                    return [String(flat.length), ...flat];
                })
            ])
        ];
        try {
            const result = await this.#runAppend(opts, () =>
                this.#client.eval(
                    BYTE_BUDGET_XADD_LUA,
                    4,
                    this.#key,
                    ledger.ledgerKey,
                    ledger.bytesKey,
                    ledger.sharedKey,
                    ...args
                )
            );
            return groups.map((_, i) => {
                const ids = Array.isArray(result) ? result[i] : null;
                return Array.isArray(ids) ? ids.map(String) : null;
            });
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('byte-budget xadd failed key=%s: %s', this.#key, err);
            throw err;
        }
    }

    /** Bytes the ledger accounts for: entries plus shared values. */
    async accountedBytes(): Promise<number> {
        const raw = await this.#client.get(this.#requireByteLedger().bytesKey);
        return raw === null ? 0 : Number(raw);
    }

    /** Values from the shared hash, in field order; null when absent. */
    async sharedValues(
        fields: readonly string[]
    ): Promise<Array<string | null>> {
        if (fields.length === 0) return [];
        return this.#client.hmget(
            this.#requireByteLedger().sharedKey,
            ...fields
        );
    }

    #requireByteLedger(): ByteLedgerKeys {
        if (!this.#byteLedger) {
            throw new Error(`stream ${this.#key} has no byte ledger`);
        }
        return this.#byteLedger;
    }

    /**
     * Bounded telemetry append. XADD, XLEN and trim accounting execute in one
     * Redis script, so `trimmed` is exact even with concurrent producers.
     */
    async appendAndCountTrim(
        fields: Record<string, string>,
        opts: TrimmingAppendOptions
    ): Promise<TrimmingAppendResult | null> {
        const flat = this.#flattenFields(fields);
        try {
            const result = await this.#runAppend(opts, () =>
                this.#client.eval(
                    TRACKED_TRIMMING_XADD_LUA,
                    1,
                    this.#key,
                    String(opts.maxlen),
                    String(opts.ttlMs ?? 0),
                    ...flat
                )
            );
            if (!Array.isArray(result) || result.length !== 3) {
                throw new Error(
                    'tracked trimming XADD returned invalid result'
                );
            }
            return {
                id: String(result[0]),
                length: Number(result[1]),
                trimmed: Number(result[2])
            };
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn(
                'tracked trimming xadd failed key=%s: %s',
                this.#key,
                err
            );
            throw err;
        }
    }

    /** Slide the key TTL forward — keeps a stream alive while its owner is
     *  connected. Best-effort: a failure must not throw (same as append). */
    async touch(ttlMs: number): Promise<void> {
        await this.#refreshTtl(ttlMs);
    }

    async #refreshTtl(ttlMs: number): Promise<void> {
        try {
            await this.#client.pexpire(this.#key, ttlMs);
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('pexpire failed key=%s: %s', this.#key, err);
        }
    }

    /** Idempotent — succeeds if group already exists. */
    async ensureGroup(group: string, startId = '$'): Promise<void> {
        try {
            await this.#client.xgroup(
                'CREATE',
                this.#key,
                group,
                startId,
                'MKSTREAM'
            );
        } catch (err: any) {
            if (String(err?.message ?? err).includes('BUSYGROUP')) return;
            // Redis at maxmemory refuses XGROUP CREATE before it looks at the
            // stream, even for an existing group; reading the group still works.
            if (await this.#hasGroup(group)) return;
            Observability.incrementCounter('redis_cmd_errors_total');
            throw err;
        }
    }

    async #hasGroup(group: string): Promise<boolean> {
        try {
            const groups = (await this.#client.xinfo(
                'GROUPS',
                this.#key
            )) as unknown[];
            return groups.some((info) => groupInfoName(info) === group);
        } catch {
            return false;
        }
    }

    async setGroupId(group: string, streamId: string): Promise<void> {
        try {
            await this.#client.xgroup('SETID', this.#key, group, streamId);
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('xgroup setid failed key=%s: %s', this.#key, err);
            throw err;
        }
    }

    async rangeAfter(streamId: string, count = 100): Promise<StreamEntry[]> {
        try {
            const reply = await this.#client.xrange(
                this.#key,
                `(${streamId}`,
                '+',
                'COUNT',
                count
            );
            return decodeRangeReply(reply);
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('xrange failed key=%s: %s', this.#key, err);
            throw err;
        }
    }

    async rangeFromStart(count = 100): Promise<StreamEntry[]> {
        try {
            const reply = await this.#client.xrange(
                this.#key,
                '-',
                '+',
                'COUNT',
                count
            );
            return decodeRangeReply(reply);
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('xrange from start failed key=%s: %s', this.#key, err);
            throw err;
        }
    }

    async deleteEntries(ids: readonly string[]): Promise<number> {
        if (ids.length === 0) return 0;
        try {
            return await this.#client.xdel(this.#key, ...ids);
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn(
                'xdel failed key=%s count=%d: %s',
                this.#key,
                ids.length,
                err
            );
            throw err;
        }
    }

    /** Read this consumer's pending (un-acked) entries from id '0' forward.
     *  Used at session resume to replay entries delivered to us before a
     *  crash / disconnect that didn't get acked. */
    async readPending(
        group: string,
        consumer: string,
        count = 100
    ): Promise<StreamEntry[]> {
        try {
            const reply = await this.#client.xreadgroup(
                'GROUP',
                group,
                consumer,
                'COUNT',
                String(count),
                'STREAMS',
                this.#key,
                '0'
            );
            return decodeReadReply(reply);
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('xreadgroup pending failed key=%s: %s', this.#key, err);
            return [];
        }
    }

    async readGroup(opts: ReadGroupOptions): Promise<StreamEntry[]> {
        try {
            const reply = await this.#client.xreadgroup(
                'GROUP',
                opts.group,
                opts.consumer,
                'COUNT',
                String(opts.count),
                'BLOCK',
                String(opts.blockMs),
                'STREAMS',
                this.#key,
                '>'
            );
            return decodeReadReply(reply);
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('xreadgroup failed key=%s: %s', this.#key, err);
            throw err;
        }
    }

    async ack(group: string, ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        try {
            await this.#client.xack(this.#key, group, ...ids);
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('xack failed key=%s: %s', this.#key, err);
            throw err;
        }
    }

    /**
     * Atomically acknowledge and remove entries for a single-consumer-group
     * work queue. EM-sync uses a hard XLEN cap, so retaining successful,
     * acknowledged entries would eventually fill that cap forever.
     */
    async ackAndDelete(group: string, ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        const ledger = this.#byteLedger;
        try {
            if (ledger) {
                await this.#client.eval(
                    LEDGER_ACK_AND_DELETE_LUA,
                    4,
                    this.#key,
                    ledger.ledgerKey,
                    ledger.bytesKey,
                    ledger.sharedKey,
                    group,
                    ...ids
                );
                return;
            }
            await this.#client.eval(
                ACK_AND_DELETE_LUA,
                1,
                this.#key,
                group,
                ...ids
            );
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn(
                'atomic xack+xdel failed key=%s count=%d: %s',
                this.#key,
                ids.length,
                err
            );
            throw err;
        }
    }

    async length(): Promise<number> {
        return (await this.#client.xlen(this.#key)) ?? 0;
    }

    async pendingSummary(group: string): Promise<StreamPendingSummary> {
        try {
            const reply = await (this.#client as Redis).call(
                'XPENDING',
                this.#key,
                group
            );
            if (!Array.isArray(reply)) {
                return {count: 0, oldestId: null, newestId: null};
            }
            return {
                count: Number(reply[0]) || 0,
                oldestId: typeof reply[1] === 'string' ? reply[1] : null,
                newestId: typeof reply[2] === 'string' ? reply[2] : null
            };
        } catch (err) {
            if (isNoGroupError(err)) {
                return {count: 0, oldestId: null, newestId: null};
            }
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('xpending summary failed key=%s: %s', this.#key, err);
            return {count: 0, oldestId: null, newestId: null};
        }
    }

    /** Returns ms-resolution age of the oldest entry, or null if empty. */
    async oldestAgeMs(): Promise<number | null> {
        const id = await this.oldestId();
        if (!id) return null;
        const ms = Number(id.split('-')[0]);
        if (!Number.isFinite(ms)) return null;
        return Date.now() - ms;
    }

    async oldestId(): Promise<string | null> {
        const first = await this.#client.xrange(
            this.#key,
            '-',
            '+',
            'COUNT',
            1
        );
        const head = (first as unknown as Array<[string, string[]]>)[0];
        return head?.[0] ?? null;
    }

    async delete(): Promise<void> {
        await this.#client.del(this.#key);
    }

    /** XPENDING summary for a specific set of ids. Returns delivery count
     *  per id; missing entries are no longer pending. Used to detect
     *  poison entries before they loop forever via autoclaim. */
    async pendingDeliveryCounts(
        group: string,
        ids: string[]
    ): Promise<Map<string, number>> {
        const counts = new Map<string, number>();
        if (ids.length === 0) return counts;
        try {
            // Use '-' and '+' as the range so we capture every pending
            // entry; the local `wanted` Set filters down. Numeric range
            // on stream ids would need ms+seq parsing — lex sort would
            // misorder '1500-10' before '1500-5'.
            const reply = await (this.#client as Redis).call(
                'XPENDING',
                this.#key,
                group,
                '-',
                '+',
                String(ids.length)
            );
            if (!Array.isArray(reply)) return counts;
            const wanted = new Set(ids);
            for (const entry of reply as Array<
                [string, string, number, number] | null
            >) {
                if (!entry) continue;
                const [id, , , deliveryCount] = entry;
                if (wanted.has(id)) {
                    counts.set(id, Number(deliveryCount) || 0);
                }
            }
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('xpending lookup failed key=%s: %s', this.#key, err);
        }
        return counts;
    }

    /** Reclaim entries idle longer than minIdleMs back to `consumer`.
     *  Wraps XAUTOCLAIM (Redis 6.2+). Caller treats reclaimed entries
     *  the same as fresh ones — they replay the original payload. */
    async autoclaim(
        group: string,
        consumer: string,
        minIdleMs: number,
        count: number
    ): Promise<StreamEntry[]> {
        try {
            // XAUTOCLAIM <key> <group> <consumer> <min-idle-ms> <start-id> COUNT <n>
            const reply = await (this.#client as Redis).call(
                'XAUTOCLAIM',
                this.#key,
                group,
                consumer,
                String(minIdleMs),
                '0-0',
                'COUNT',
                String(count)
            );
            return decodeAutoclaimReply(reply);
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('xautoclaim failed key=%s: %s', this.#key, err);
            return [];
        }
    }
}

const CAPPED_XADD_LUA = `
local cap = tonumber(ARGV[1])
if cap > 0 and redis.call('XLEN', KEYS[1]) >= cap then
  return false
end
local args = {'*'}
for i = 3, #ARGV do
  args[#args + 1] = ARGV[i]
end
local id = redis.call('XADD', KEYS[1], unpack(args))
local ttl = tonumber(ARGV[2])
if ttl > 0 then
  redis.call('PEXPIRE', KEYS[1], ttl)
end
return id
`;

const CAPPED_XADD_AND_HIGH_WATER_LUA = `
local cap = tonumber(ARGV[1])
if cap > 0 and redis.call('XLEN', KEYS[1]) >= cap then
  return false
end
local accepted = tonumber(ARGV[4])
if accepted == nil then
  return redis.error_reply('high-water value must be numeric')
end
local previous_raw = redis.call('HGET', KEYS[2], ARGV[3])
local previous = nil
if previous_raw then
  previous = tonumber(previous_raw)
  if previous == nil then
    return redis.error_reply('stored high-water value must be numeric')
  end
end
local args = {'*'}
for i = 5, #ARGV do
  args[#args + 1] = ARGV[i]
end
local id = redis.call('XADD', KEYS[1], unpack(args))
if previous == nil or accepted > previous then
  redis.call('HSET', KEYS[2], ARGV[3], ARGV[4])
end
local ttl = tonumber(ARGV[2])
if ttl > 0 then
  redis.call('PEXPIRE', KEYS[1], ttl)
  redis.call('PEXPIRE', KEYS[2], ttl)
end
return id
`;

// KEYS: stream, ledger hash, byte total, shared hash. ARGV: budget, cap, ttl,
// shared field, shared value, entry count, then per entry its field count and
// field/value pairs. An empty stream owns no bytes, so its ledger restarts.
// Groups in order; each is checked against the budget and the entry cap as
// the stream stands after the groups before it, and kept whole or refused
// whole. A refused group is a nil in the reply.
const BYTE_BUDGET_XADD_LUA = `
local budget = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local groups = tonumber(ARGV[4])
local len = redis.call('XLEN', KEYS[1])
if len == 0 then
  redis.call('DEL', KEYS[2], KEYS[3], KEYS[4])
end
local used = tonumber(redis.call('GET', KEYS[3]) or '0')
local added = 0
local results = {}
local pos = 5
for g = 1, groups do
  local shared_field = ARGV[pos]
  local shared_value = ARGV[pos + 1]
  local count = tonumber(ARGV[pos + 2])
  pos = pos + 3
  local entries = {}
  local need = 0
  for i = 1, count do
    local n = tonumber(ARGV[pos])
    pos = pos + 1
    local fields = {'*'}
    local size = 0
    for j = 1, n do
      fields[#fields + 1] = ARGV[pos]
      size = size + #ARGV[pos]
      pos = pos + 1
    end
    entries[i] = {fields, size}
    need = need + size
  end
  local shared_new = shared_field ~= '' and redis.call('HEXISTS', KEYS[4], shared_field) == 0
  if shared_new then
    need = need + #shared_field + #shared_value
  end
  if (cap > 0 and len + count > cap) or used + need > budget then
    results[g] = false
  else
    if shared_new then
      redis.call('HSET', KEYS[4], shared_field, shared_value)
    end
    local ids = {}
    for i = 1, count do
      local id = redis.call('XADD', KEYS[1], unpack(entries[i][1]))
      redis.call('HSET', KEYS[2], id, entries[i][2])
      ids[i] = id
    end
    len = len + count
    used = used + need
    added = added + need
    results[g] = ids
  end
end
if added > 0 then
  redis.call('INCRBY', KEYS[3], added)
end
if added > 0 and ttl > 0 then
  for k = 1, 4 do
    redis.call('PEXPIRE', KEYS[k], ttl)
  end
end
return results
`;

// KEYS as above. ARGV: group, ids. Frees exactly the bytes the ledger holds
// for the deleted ids; entries written without a ledger free nothing.
const LEDGER_ACK_AND_DELETE_LUA = `
local acked = redis.call('XACK', KEYS[1], ARGV[1], unpack(ARGV, 2))
local freed = 0
for i = 2, #ARGV do
  local size = redis.call('HGET', KEYS[2], ARGV[i])
  if size then
    freed = freed + tonumber(size)
    redis.call('HDEL', KEYS[2], ARGV[i])
  end
end
redis.call('XDEL', KEYS[1], unpack(ARGV, 2))
if redis.call('XLEN', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[2], KEYS[3], KEYS[4])
elseif freed > 0 then
  redis.call('DECRBY', KEYS[3], freed)
end
return acked
`;

const TRACKED_TRIMMING_XADD_LUA = `
local cap = tonumber(ARGV[1])
local before = redis.call('XLEN', KEYS[1])
local args = {}
if cap > 0 then
  args = {'MAXLEN', '=', tostring(cap), '*'}
else
  args = {'*'}
end
for i = 3, #ARGV do
  args[#args + 1] = ARGV[i]
end
local id = redis.call('XADD', KEYS[1], unpack(args))
local after = redis.call('XLEN', KEYS[1])
local ttl = tonumber(ARGV[2])
if ttl > 0 then
  redis.call('PEXPIRE', KEYS[1], ttl)
end
return {id, tostring(after), tostring(before + 1 - after)}
`;

// XINFO GROUPS answers each group as a flat [field, value, ...] list.
function groupInfoName(info: unknown): string | undefined {
    if (!Array.isArray(info)) return undefined;
    const at = info.indexOf('name');
    return at >= 0 ? String(info[at + 1]) : undefined;
}

/** Redis at maxmemory with noeviction answers `OOM command not allowed ...`
 *  to every command flagged DENYOOM. */
export function isRedisOomError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return message.startsWith('OOM ');
}

/** Redis answers `NOGROUP No such key ... or consumer group ...` when the
 *  stream key (and its groups) expired or was evicted. Lets callers self-heal
 *  by recreating the group instead of spinning on the error. */
export function isNoGroupError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return message.includes('NOGROUP');
}

export interface GroupRecovery {
    /** Short, searchable label for the recovery metric, e.g. 'ws-session'. */
    source: string;
    /** Recreate the missing group (plus any per-site keep-alive). */
    recreate: () => Promise<void>;
}

/** Self-heal a vanished consumer group. On NOGROUP, recreate the group and
 *  count it, then report handled so the caller continues its loop. A recreate
 *  failure is logged and reported NOT handled, so the caller falls back to its
 *  normal retry instead of the loop dying. */
export async function recoverMissingGroup(
    err: unknown,
    recovery: GroupRecovery
): Promise<boolean> {
    if (!isNoGroupError(err)) return false;
    try {
        await recovery.recreate();
    } catch (recreateErr) {
        logger.warn(
            'group recreate failed source=%s: %s',
            recovery.source,
            recreateErr
        );
        return false;
    }
    Observability.incrementLabeledCounter('redis_group_recreated_total', {
        source: recovery.source
    });
    return true;
}

function decodeAutoclaimReply(reply: unknown): StreamEntry[] {
    // [next-cursor, [[id, [k, v, ...]], ...], [deleted-ids...]]
    if (!Array.isArray(reply) || reply.length < 2) return [];
    const claimed = reply[1] as Array<[string, string[]] | null>;
    if (!Array.isArray(claimed)) return [];
    const out: StreamEntry[] = [];
    for (const entry of claimed) {
        if (!entry) continue;
        const [id, flatFields] = entry;
        out.push({id, fields: decodeFields(flatFields)});
    }
    return out;
}

function decodeRangeReply(reply: unknown): StreamEntry[] {
    if (!Array.isArray(reply)) return [];
    const out: StreamEntry[] = [];
    for (const entry of reply as Array<[string, string[]] | null>) {
        if (!entry) continue;
        const [id, flat] = entry;
        out.push({id, fields: decodeFields(flat)});
    }
    return out;
}

function decodeReadReply(reply: unknown): StreamEntry[] {
    if (!Array.isArray(reply) || reply.length === 0) return [];
    const out: StreamEntry[] = [];
    for (const streamReply of reply) {
        const entries = (streamReply as [string, Array<[string, string[]]>])[1];
        if (!Array.isArray(entries)) continue;
        for (const [id, flatFields] of entries) {
            out.push({id, fields: decodeFields(flatFields)});
        }
    }
    return out;
}

function decodeFields(flatFields: string[]): Record<string, string> {
    const fields: Record<string, string> = {};
    for (let i = 0; i + 1 < flatFields.length; i += 2) {
        fields[flatFields[i]] = flatFields[i + 1];
    }
    return fields;
}
