// Typed wrapper over ioredis XADD/XREADGROUP/XACK/XTRIM/XLEN/PEXPIRE.
import type {Redis} from 'ioredis';
import log4js from 'log4js';
import * as Observability from '../Observability';

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

    constructor(client: Redis, key: string) {
        this.#client = client;
        this.#key = key;
    }

    get key(): string {
        return this.#key;
    }

    async append(
        fields: Record<string, string>,
        opts: AppendOptions = {}
    ): Promise<string | null> {
        if (opts.rateCheck && !(await opts.rateCheck())) {
            Observability.incrementLabeledCounter('xadd_rate_limited_total', {
                stream: opts.rateLabel ?? this.#key
            });
            return null;
        }
        const flat: string[] = [];
        for (const [k, v] of Object.entries(fields)) {
            flat.push(k, v);
        }
        try {
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
        } catch (err) {
            Observability.incrementCounter('redis_cmd_errors_total');
            logger.warn('xadd failed key=%s: %s', this.#key, err);
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
            if (!String(err?.message ?? err).includes('BUSYGROUP')) {
                Observability.incrementCounter('redis_cmd_errors_total');
                throw err;
            }
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
