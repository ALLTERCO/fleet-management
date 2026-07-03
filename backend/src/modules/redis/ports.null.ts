import {tuning} from '../../config/tuning';
import {mergeStatusObjects} from '../../model/statusMerge';
import * as Observability from '../Observability';
import type {
    BulkAcceptJobRecord,
    BulkAcceptJobStorePort,
    DeviceIngestPort,
    DeviceOwnershipPort,
    DeviceShadowPort,
    DeviceSignalsPort,
    DeviceTrustCachePort,
    DeviceTrustSignalsPort,
    EventReplayCacheParams,
    EventReplayCachePort,
    EventReplayResult,
    ExportOwnershipPort,
    IngressAuditPort,
    KvStorePort,
    LeadershipFactory,
    LeadershipOptions,
    LeadershipPort,
    OrgSignalsPort,
    RateLimiterPort,
    Reservation,
    ReservationPort,
    SessionSignalsPort,
    UploadSessionPort,
    WaitingEntry,
    WaitingStorePort
} from './ports';
import {RATE_LIMITER_TTL_MS} from './ports';

export const nullOrgSignals: OrgSignalsPort = {
    async publish() {},
    async onAny() {}
};

export const nullDeviceSignals: DeviceSignalsPort = {
    async publish() {},
    async on() {}
};

export const nullSessionSignals: SessionSignalsPort = {
    async publish() {},
    async on() {}
};

export const nullDeviceTrustSignals: DeviceTrustSignalsPort = {
    async publish() {},
    async on() {}
};

interface NullTrustEntry {
    value: string;
    expiresAt: number;
}
const nullTrustCache = new Map<string, NullTrustEntry>();

export const nullDeviceTrustCache: DeviceTrustCachePort = {
    async get(key) {
        const entry = nullTrustCache.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            nullTrustCache.delete(key);
            return null;
        }
        return entry.value;
    },
    async set(key, value, ttlSec) {
        sweepExpiredMap(nullTrustCache);
        nullTrustCache.set(key, {value, expiresAt: Date.now() + ttlSec * 1000});
    },
    async del(key) {
        nullTrustCache.delete(key);
    }
};

export function clearNullDeviceTrustCacheForTests(): void {
    nullTrustCache.clear();
}

export const nullDeviceIngest: DeviceIngestPort = {
    async appendFrame() {
        Observability.incrementCounter('device_ingest_bypassed');
    }
};

export const nullIngressAudit: IngressAuditPort = {
    async push() {
        Observability.incrementCounter('ingress_audit_bypassed');
    },
    async drain() {
        return [];
    },
    async size() {
        return 0;
    }
};

export function makeNullEventReplayCache<T>(): EventReplayCachePort<T> {
    return {
        async get(
            _orgId: string,
            _params: EventReplayCacheParams,
            fetcher: () => Promise<EventReplayResult<T>>
        ): Promise<EventReplayResult<T>> {
            Observability.incrementCounter('event_replay_cache_bypassed_total');
            return fetcher();
        }
    };
}

class AlwaysLeader implements LeadershipPort {
    readonly #onAcquire?: () => void | Promise<void>;
    #started = false;
    constructor(opts: LeadershipOptions) {
        this.#onAcquire = opts.onAcquire;
    }
    async start(): Promise<void> {
        if (this.#started) return;
        this.#started = true;
        await this.#onAcquire?.();
    }
    async stop(): Promise<void> {
        this.#started = false;
    }
    isLeader(): boolean {
        return this.#started;
    }
}

export const nullLeadershipFactory: LeadershipFactory = {
    create(opts) {
        return new AlwaysLeader(opts);
    }
};

interface Bucket {
    tokens: number;
    updated: number;
}
const nullBuckets = new Map<string, Bucket>();

function refilledBucket(
    key: string,
    capacity: number,
    refillPerSec: number,
    now: number
): Bucket {
    let b = nullBuckets.get(key);
    if (!b) {
        b = {tokens: capacity, updated: now};
        nullBuckets.set(key, b);
        return b;
    }
    const dtSec = Math.max(0, now - b.updated) / 1000;
    b.tokens = Math.min(capacity, b.tokens + dtSec * refillPerSec);
    b.updated = now;
    return b;
}

export const nullRateLimiter: RateLimiterPort = {
    // consume is the n=1 case of consumeMany — one home for the algorithm.
    async consume(
        key: string,
        capacity: number,
        refillPerSec: number
    ): Promise<boolean> {
        const result = await nullRateLimiter.consumeMany([
            {key, capacity, refillPerSec}
        ]);
        return result.allowed;
    },
    // Refill all, check all, then decrement all — a denial consumes nothing.
    async consumeMany(buckets) {
        const now = Date.now();
        const refilled = buckets.map((spec) =>
            refilledBucket(spec.key, spec.capacity, spec.refillPerSec, now)
        );
        const deniedIndex = refilled.findIndex((b) => b.tokens < 1);
        if (deniedIndex !== -1) return {allowed: false, deniedIndex};
        for (const b of refilled) b.tokens -= 1;
        return {allowed: true};
    }
};

interface NullSlot {
    count: number;
    expiresAt: number;
}
const nullSlots = new Map<string, NullSlot>();

export const nullReservation: ReservationPort = {
    async reserve(
        key: string,
        capacity: number,
        ttlSec: number
    ): Promise<Reservation> {
        const now = Date.now();
        const existing = nullSlots.get(key);
        const slot =
            existing && existing.expiresAt > now
                ? existing
                : {count: 0, expiresAt: now + ttlSec * 1000};
        if (slot.count >= capacity) {
            nullSlots.set(key, slot);
            return {ok: false, reason: 'at_capacity'};
        }
        slot.count += 1;
        nullSlots.set(key, slot);
        return {
            ok: true,
            release: async () => {
                const cur = nullSlots.get(key);
                if (!cur) return;
                cur.count = Math.max(0, cur.count - 1);
            }
        };
    }
};

// Drop idle buckets / expired reservations to keep the maps bounded.
// An idle bucket equals a fresh full one, so dropping it is lossless.
function sweepRateLimiterMaps(): void {
    const now = Date.now();
    for (const [key, bucket] of nullBuckets) {
        if (now - bucket.updated > RATE_LIMITER_TTL_MS) nullBuckets.delete(key);
    }
    for (const [key, slot] of nullSlots) {
        if (slot.expiresAt <= now) nullSlots.delete(key);
    }
    sweepWaitingMaps(now);
}

function sweepWaitingMaps(now: number): void {
    for (const [key, expiresAt] of nullRejectedCooldown) {
        if (expiresAt <= now) nullRejectedCooldown.delete(key);
    }
    for (const [orgId, org] of nullWaitingByOrg) {
        if (nullWaitingLiveCount(org, now) === 0)
            nullWaitingByOrg.delete(orgId);
    }
}
setInterval(sweepRateLimiterMaps, RATE_LIMITER_TTL_MS).unref();

// Single-process: this instance owns everything it has claimed.
const nullOwned = new Set<string>();

export const nullDeviceOwnership: DeviceOwnershipPort = {
    async claim(shellyID: string): Promise<boolean> {
        nullOwned.add(shellyID);
        return true;
    },
    async heartbeat(): Promise<void> {},
    async release(shellyID: string): Promise<void> {
        nullOwned.delete(shellyID);
    },
    async owner(shellyID: string): Promise<string | null> {
        return nullOwned.has(shellyID) ? 'local' : null;
    }
};

const nullExportOwners = new Map<string, {userId: string; expiresAt: number}>();
const nullUploadTicketStore = new Map<
    string,
    {value: string; expiresAt: number}
>();
const nullUploadSessionStore = new Map<
    string,
    {value: string; expiresAt: number}
>();

function sweepExpiredMap<T extends {expiresAt: number}>(
    store: Map<string, T>,
    now = Date.now()
): void {
    for (const [key, value] of store) {
        if (value.expiresAt <= now) store.delete(key);
    }
}

export const nullExportOwnership: ExportOwnershipPort = {
    async set(filename, userId, ttlSec) {
        const now = Date.now();
        sweepExpiredMap(nullExportOwners, now);
        nullExportOwners.set(filename, {
            userId,
            expiresAt: now + ttlSec * 1000
        });
    },
    async get(filename) {
        const entry = nullExportOwners.get(filename);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            nullExportOwners.delete(filename);
            return null;
        }
        return entry.userId;
    }
};

export const nullUploadTickets: import('./ports').UploadTicketPort = {
    async set(token, value, ttlSec) {
        const now = Date.now();
        sweepExpiredMap(nullUploadTicketStore, now);
        nullUploadTicketStore.set(token, {
            value,
            expiresAt: now + ttlSec * 1000
        });
    },
    async consume(token) {
        const entry = nullUploadTicketStore.get(token);
        if (!entry) return null;
        nullUploadTicketStore.delete(token);
        if (entry.expiresAt <= Date.now()) return null;
        return entry.value;
    }
};

export const nullUploadSessions: UploadSessionPort = {
    async set(sessionId, value, ttlSec) {
        const now = Date.now();
        sweepExpiredMap(nullUploadSessionStore, now);
        nullUploadSessionStore.set(sessionId, {
            value,
            expiresAt: now + ttlSec * 1000
        });
    },
    async get(sessionId) {
        const entry = nullUploadSessionStore.get(sessionId);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            nullUploadSessionStore.delete(sessionId);
            return null;
        }
        return entry.value;
    },
    async delete(sessionId) {
        nullUploadSessionStore.delete(sessionId);
    }
};

interface NullKvEntry {
    value: string;
    expiresAt: number | null;
}
const nullKvStore = new Map<string, NullKvEntry>();

function nullKvExpired(entry: NullKvEntry, nowMs: number): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= nowMs;
}

export const nullKv: KvStorePort = {
    async get(key) {
        const entry = nullKvStore.get(key);
        if (!entry) return null;
        if (nullKvExpired(entry, Date.now())) {
            nullKvStore.delete(key);
            return null;
        }
        return entry.value;
    },
    async set(key, value, ttlSec) {
        const expiresAt =
            ttlSec !== undefined ? Date.now() + ttlSec * 1000 : null;
        nullKvStore.set(key, {value, expiresAt});
    }
};

// No-op: callers fall back to in-memory device state for cold hydrate.
export const nullDeviceShadow: DeviceShadowPort = {
    async write(): Promise<void> {},
    async read(): Promise<Record<string, string> | null> {
        return null;
    },
    async drop(): Promise<void> {}
};

// claim is a synchronous delete-and-return — Node's single thread makes
// it atomic, so two concurrent claims can't both win.
type NullWaitingEntry = WaitingEntry & {expiresAt: number};
const nullWaitingByOrg = new Map<string, Map<string, NullWaitingEntry>>();

// Mutate a live entry then refresh its TTL; no-op if gone or expired. Mirrors
// the redis port's updateExistingEntry so heartbeat/mergeStatus stay in sync.
function mutateLiveNullEntry(
    organizationId: string,
    shellyID: string,
    mutate: (entry: NullWaitingEntry) => void
): boolean {
    const entry = nullWaitingByOrg.get(organizationId)?.get(shellyID);
    if (!entry || entry.expiresAt <= Date.now()) return false;
    mutate(entry);
    entry.lastSeenAt = Date.now();
    entry.expiresAt = entry.lastSeenAt + tuning.waitingRoom.redisTtlSec * 1000;
    return true;
}

function nullWaitingOrg(organizationId: string): Map<string, NullWaitingEntry> {
    let org = nullWaitingByOrg.get(organizationId);
    if (!org) {
        org = new Map();
        nullWaitingByOrg.set(organizationId, org);
    }
    return org;
}

function nullWaitingLiveCount(
    org: Map<string, NullWaitingEntry>,
    now: number
): number {
    let live = 0;
    for (const [id, entry] of org) {
        if (entry.expiresAt <= now) org.delete(id);
        else live++;
    }
    return live;
}

function stripExpiry(entry: NullWaitingEntry): WaitingEntry {
    const {expiresAt: _drop, ...rest} = entry;
    return rest;
}

const nullRejectedCooldown = new Map<string, number>();

function rejectedCooldownKey(organizationId: string, shellyID: string): string {
    return `${organizationId}:${shellyID}`;
}

export const nullWaitingStore: WaitingStorePort = {
    async upsert(entry: WaitingEntry): Promise<boolean> {
        const org = nullWaitingOrg(entry.organizationId);
        const now = Date.now();
        const live = nullWaitingLiveCount(org, now);
        const isNew = !org.has(entry.shellyID);
        if (isNew && live >= tuning.waitingRoom.maxPerOrg) return false;
        org.set(entry.shellyID, {
            ...entry,
            expiresAt: now + tuning.waitingRoom.redisTtlSec * 1000
        });
        return true;
    },
    async get(
        organizationId: string,
        shellyID: string
    ): Promise<WaitingEntry | null> {
        const entry = nullWaitingByOrg.get(organizationId)?.get(shellyID);
        if (!entry || entry.expiresAt <= Date.now()) return null;
        return stripExpiry(entry);
    },
    async restoreClaimed(entry: WaitingEntry): Promise<void> {
        nullWaitingOrg(entry.organizationId).set(entry.shellyID, {
            ...entry,
            expiresAt: Date.now() + tuning.waitingRoom.redisTtlSec * 1000
        });
    },
    async isPending(
        organizationId: string,
        shellyID: string
    ): Promise<boolean> {
        const entry = nullWaitingByOrg.get(organizationId)?.get(shellyID);
        return entry !== undefined && entry.expiresAt > Date.now();
    },
    async heartbeat(organizationId: string, shellyID: string): Promise<void> {
        mutateLiveNullEntry(organizationId, shellyID, () => {});
    },
    async mergeStatus(
        organizationId: string,
        shellyID: string,
        status: Record<string, unknown>
    ): Promise<boolean> {
        // Deep merge — keep parity with the redis port so a partial enrichment
        // tops up sys instead of wiping device.model/ver.
        return mutateLiveNullEntry(organizationId, shellyID, (entry) => {
            entry.jdoc = mergeStatusObjects(entry.jdoc, status);
        });
    },
    async listByOrg(organizationId: string): Promise<WaitingEntry[]> {
        const org = nullWaitingByOrg.get(organizationId);
        if (!org) return [];
        const now = Date.now();
        const out: WaitingEntry[] = [];
        for (const [id, entry] of org) {
            if (entry.expiresAt <= now) org.delete(id);
            else out.push(stripExpiry(entry));
        }
        return out;
    },
    async countByOrg(organizationId: string): Promise<number> {
        const org = nullWaitingByOrg.get(organizationId);
        if (!org) return 0;
        return nullWaitingLiveCount(org, Date.now());
    },
    async claim(
        organizationId: string,
        shellyID: string
    ): Promise<WaitingEntry | null> {
        const org = nullWaitingByOrg.get(organizationId);
        if (!org) return null;
        const entry = org.get(shellyID);
        if (!entry) return null;
        org.delete(shellyID);
        if (entry.expiresAt <= Date.now()) return null;
        return stripExpiry(entry);
    },
    async remove(organizationId: string, shellyID: string): Promise<void> {
        nullWaitingByOrg.get(organizationId)?.delete(shellyID);
    },
    async markRejected(
        organizationId: string,
        shellyID: string,
        ttlSec: number
    ): Promise<void> {
        const key = rejectedCooldownKey(organizationId, shellyID);
        nullRejectedCooldown.set(key, Date.now() + ttlSec * 1000);
    },
    async isRejected(
        organizationId: string,
        shellyID: string
    ): Promise<boolean> {
        const key = rejectedCooldownKey(organizationId, shellyID);
        const expiresAt = nullRejectedCooldown.get(key);
        if (expiresAt === undefined) return false;
        if (expiresAt <= Date.now()) {
            nullRejectedCooldown.delete(key);
            return false;
        }
        return true;
    }
};

export function sweepNullWaitingMapsForTests(now = Date.now()): void {
    sweepWaitingMaps(now);
}

export function nullRejectedCooldownSizeForTests(): number {
    return nullRejectedCooldown.size;
}

const nullBulkAcceptJobs = new Map<string, BulkAcceptJobRecord>();
const nullBulkAcceptCancels = new Set<string>();

function bulkAcceptMapKey(organizationId: string, jobId: string): string {
    return `${organizationId}:${jobId}`;
}

// Snapshot, including failed[], so a read mid-run can't observe later mutation.
function copyJob(record: BulkAcceptJobRecord): BulkAcceptJobRecord {
    return {...record, failed: [...record.failed]};
}

export const nullBulkAcceptJobStore: BulkAcceptJobStorePort = {
    async set(record: BulkAcceptJobRecord): Promise<void> {
        nullBulkAcceptJobs.set(
            bulkAcceptMapKey(record.organizationId, record.jobId),
            copyJob(record)
        );
    },
    async recordProgress(ref, progress): Promise<void> {
        const key = bulkAcceptMapKey(ref.organizationId, ref.jobId);
        const record = nullBulkAcceptJobs.get(key);
        if (!record) return;
        record.processed += progress.processed;
        record.accepted += progress.accepted;
        record.failed.push(...progress.failed);
        record.updatedAt = progress.updatedAt;
    },
    async get(
        organizationId: string,
        jobId: string
    ): Promise<BulkAcceptJobRecord | null> {
        const record = nullBulkAcceptJobs.get(
            bulkAcceptMapKey(organizationId, jobId)
        );
        return record ? copyJob(record) : null;
    },
    async markCancel(organizationId: string, jobId: string): Promise<void> {
        nullBulkAcceptCancels.add(bulkAcceptMapKey(organizationId, jobId));
    },
    async isCancelRequested(
        organizationId: string,
        jobId: string
    ): Promise<boolean> {
        return nullBulkAcceptCancels.has(
            bulkAcceptMapKey(organizationId, jobId)
        );
    }
};

export function resetNullBulkAcceptJobsForTests(): void {
    nullBulkAcceptJobs.clear();
    nullBulkAcceptCancels.clear();
}
