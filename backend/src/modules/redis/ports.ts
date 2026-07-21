// Shared lifetime for rate-limiter entries across both adapters.
export const RATE_LIMITER_TTL_MS = 60 * 60_000;

export type OrgSignalKind = 'groups-bumped' | 'policy-changed';
export interface OrgSignal {
    instanceId: string;
    kind: OrgSignalKind;
    orgId: string;
}

export interface OrgSignalsPort {
    publish(signal: Omit<OrgSignal, 'instanceId'>): Promise<void>;
    onAny(handler: (signal: OrgSignal) => void): Promise<void>;
}

export interface DeviceSignal {
    instanceId: string;
    kind: 'connected' | 'disconnected' | 'deleted' | 'identity-changing';
    shellyID: string;
    previousShellyID?: string;
    operationId?: string;
}

export interface DeviceSignalsPort {
    publish(signal: Omit<DeviceSignal, 'instanceId'>): Promise<void>;
    on(handler: (signal: DeviceSignal) => void): Promise<void>;
}

// force-disconnect requires peers to close open sockets for the userId.
export type SessionSignalKind =
    | 'disconnect'
    | 'reconnect'
    | 'force-disconnect'
    | 'auth-changed'
    | 'credential-revoked';
export interface SessionSignal {
    instanceId: string;
    kind: SessionSignalKind;
    userId: string;
    reason?: string;
    // Set only when kind='credential-revoked'.
    credentialId?: string;
}

export interface SessionSignalsPort {
    publish(signal: Omit<SessionSignal, 'instanceId'>): Promise<void>;
    on(handler: (signal: SessionSignal) => void): Promise<void>;
}

export interface DeviceTrustSignal {
    instanceId: string;
    kind: 'credential-changed' | 'access-control-changed';
    credentialId?: string;
    identityId?: string;
    externalId?: string;
}

export interface DeviceTrustSignalsPort {
    publish(signal: Omit<DeviceTrustSignal, 'instanceId'>): Promise<void>;
    on(handler: (signal: DeviceTrustSignal) => void): Promise<void>;
}

// TTL-bounded read-through copy; DB stays the source of truth.
export interface DeviceTrustCachePort {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSec: number): Promise<void>;
    del(key: string): Promise<void>;
}

export interface DeviceIngestPort {
    appendFrame(
        shellyID: string,
        fields: Record<string, string>
    ): Promise<void>;
}

// Redis-buffered ingress audit records. Connect pushes here (fast) instead of
// writing Postgres inline; a worker drains and bulk-inserts them later.
export interface IngressAuditPort {
    // Append one JSON record. The list is capped to maxlen (drop-oldest) and its
    // TTL refreshed, so a stalled flush can never grow it without bound.
    push(record: string, maxlen: number, ttlMs: number): Promise<void>;
    // Atomically remove and return up to `max` oldest records (FIFO).
    drain(max: number): Promise<string[]>;
    // Current buffered depth — a backpressure gauge for the flush cadence.
    size(): Promise<number>;
}

export interface EventReplayCacheParams {
    from: string;
    to: string;
    eventTypes?: string[];
    maxDevices: number;
}

export interface EventReplayResult<T> {
    trips: T[];
}

export interface EventReplayCachePort<T = unknown> {
    get(
        orgId: string,
        params: EventReplayCacheParams,
        fetcher: () => Promise<EventReplayResult<T>>
    ): Promise<EventReplayResult<T>>;
}

export interface KvStorePort {
    get(key: string): Promise<string | null>;
    /** Omit ttlSec for a persistent entry. */
    set(key: string, value: string, ttlSec?: number): Promise<void>;
}

export interface LeadershipOptions {
    name: string;
    onAcquire?: () => void | Promise<void>;
    onLose?: () => void | Promise<void>;
}

export interface LeadershipPort {
    start(): Promise<void>;
    stop(): Promise<void>;
    isLeader(): boolean;
}

export interface LeadershipFactory {
    create(opts: LeadershipOptions): LeadershipPort;
}

// consume() is atomic: the caller takes a token or it's denied.
export interface RateLimiterConsumeOpts {
    /** On a Redis error, deny (return false) instead of failing open.
     *  Used by the delivery path so a Redis outage throttles sends rather
     *  than letting an unbounded burst bypass every limit. */
    failClosed?: boolean;
}

export interface RateLimitBucketSpec {
    key: string;
    capacity: number;
    refillPerSec: number;
}

export interface RateLimiterMultiConsumeResult {
    allowed: boolean;
    /** First denied bucket (0-based); unset when a backend error denied. */
    deniedIndex?: number;
}

export interface RateLimiterPort {
    consume(
        key: string,
        capacity: number,
        refillPerSec: number,
        opts?: RateLimiterConsumeOpts
    ): Promise<boolean>;
    /** All-or-nothing across buckets — a denial consumes nothing. */
    consumeMany(
        buckets: RateLimitBucketSpec[],
        opts?: RateLimiterConsumeOpts
    ): Promise<RateLimiterMultiConsumeResult>;
}

// Cluster-wide reservation slot: atomic INCR/DECR under TTL avoids
// read/check/write races across instances sharing one quota.
export interface ReservationPort {
    reserve(
        key: string,
        capacity: number,
        ttlSec: number
    ): Promise<Reservation>;
}

// Callers pick their own fail-open/closed policy per reason.
export type ReservationDenyReason = 'at_capacity' | 'backend_error';

export type Reservation =
    | {ok: true; release: () => Promise<void>}
    | {ok: false; reason: ReservationDenyReason};

// claim() succeeds only when no other instance holds the key.
export interface DeviceOwnershipPort {
    claim(shellyID: string, ttlMs: number): Promise<boolean>;
    heartbeat(shellyID: string, ttlMs: number): Promise<boolean>;
    release(shellyID: string): Promise<void>;
    owner(shellyID: string): Promise<string | null>;
}

export interface DeviceIdentityFencePort {
    acquire(
        shellyIDs: readonly string[],
        token: string,
        ttlMs: number
    ): Promise<boolean>;
    release(shellyIDs: readonly string[], token: string): Promise<void>;
}

// set THROWS on backend failure so the caller never returns a dead URL.
export interface ExportOwnershipPort {
    set(filename: string, userId: string, ttlSec: number): Promise<void>;
    get(filename: string): Promise<string | null>;
}

export interface UploadTicketPort {
    set(token: string, value: string, ttlSec: number): Promise<void>;
    consume(token: string): Promise<string | null>;
}

export interface UploadSessionPort {
    set(sessionId: string, value: string, ttlSec: number): Promise<void>;
    get(sessionId: string): Promise<string | null>;
    delete(sessionId: string): Promise<void>;
}

export interface DeviceGuiSessionPort {
    create(input: {
        slotId: string;
        sessionId: string;
        session: string;
        ttlSec: number;
    }): Promise<string | null>;
    get(sessionId: string): Promise<string | null>;
    isAttested(sessionId: string): Promise<boolean>;
    markAttested(sessionId: string, ttlSec: number): Promise<void>;
    delete(sessionId: string): Promise<void>;
    publishRevoked(sessionId: string): Promise<void>;
    onRevoked(handler: (sessionId: string) => void): Promise<void>;
}

export type WaitingAuthMethod = 'none' | 'token' | 'certificate';

export interface WaitingEntry {
    shellyID: string;
    organizationId: string;
    authMethod: WaitingAuthMethod;
    ownerInstanceId: string;
    firstSeenAt: number;
    lastSeenAt: number;
    status: string;
    jdoc: Record<string, unknown>;
    // Wake interval (s) for a sleeping device; extends this entry's TTL so it
    // isn't evicted between wakes. Absent for always-on devices.
    wakeupPeriodSec?: number;
}

export interface WaitingStorePort {
    /** Returns false when the org is at its cap and the device is new. */
    upsert(entry: WaitingEntry): Promise<boolean>;
    /** Single-entry lookup. Used on hot connect paths; must not scan the org. */
    get(organizationId: string, shellyID: string): Promise<WaitingEntry | null>;
    /** Restore an entry that this process already claimed. Bypasses new-entry cap. */
    restoreClaimed(entry: WaitingEntry): Promise<void>;
    /** True while a live entry exists. */
    isPending(organizationId: string, shellyID: string): Promise<boolean>;
    heartbeat(organizationId: string, shellyID: string): Promise<void>;
    /** Merge a status patch into an existing entry's jdoc. Returns false
     *  when the entry is gone — callers must surface that, not assume
     *  the enrichment landed. */
    mergeStatus(
        organizationId: string,
        shellyID: string,
        status: Record<string, unknown>
    ): Promise<boolean>;
    listByOrg(organizationId: string): Promise<WaitingEntry[]>;
    countByOrg(organizationId: string): Promise<number>;
    /** Atomic remove-and-return; only one concurrent caller wins. */
    claim(
        organizationId: string,
        shellyID: string
    ): Promise<WaitingEntry | null>;
    remove(organizationId: string, shellyID: string): Promise<void>;
    /** Write a short-TTL cooldown marker so a rejected device stays out. */
    markRejected(
        organizationId: string,
        shellyID: string,
        ttlSec: number
    ): Promise<void>;
    isRejected(organizationId: string, shellyID: string): Promise<boolean>;
}

// Write-through latest-status shadow so a fresh process can hydrate
// cold reads without waiting for the device to send again.
export interface DeviceShadowPort {
    write(
        shellyID: string,
        fields: Record<string, string>,
        ttlMs: number
    ): Promise<void>;
    read(shellyID: string): Promise<Record<string, string> | null>;
    drop(shellyID: string): Promise<void>;
}

export type BulkAcceptJobState = 'running' | 'done' | 'canceled' | 'error';

export interface BulkAcceptJobRecord {
    jobId: string;
    organizationId: string;
    total: number;
    processed: number;
    accepted: number;
    failed: string[];
    state: BulkAcceptJobState;
    startedAt: number;
    updatedAt: number;
}

// Cross-instance bulk-accept job state. Owner writes; cancel is a separate flag.
export interface BulkAcceptJobStorePort {
    set(record: BulkAcceptJobRecord, ttlSec: number): Promise<void>;
    recordProgress(
        ref: {organizationId: string; jobId: string},
        progress: {
            processed: number;
            accepted: number;
            failed: string[];
            updatedAt: number;
        },
        ttlSec: number
    ): Promise<void>;
    get(
        organizationId: string,
        jobId: string
    ): Promise<BulkAcceptJobRecord | null>;
    markCancel(
        organizationId: string,
        jobId: string,
        ttlSec: number
    ): Promise<void>;
    isCancelRequested(organizationId: string, jobId: string): Promise<boolean>;
}
