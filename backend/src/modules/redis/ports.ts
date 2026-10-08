import type {user_t} from '../../types';

// Shared lifetime for rate-limiter entries across both adapters.
export const RATE_LIMITER_TTL_MS = 60 * 60_000;

export type OrgSignalKind =
    | 'groups-bumped'
    | 'access-changed'
    | 'policy-changed'
    | 'blu-inventory-changed'
    | 'alert-state-changed';
export interface OrgSignal {
    instanceId: string;
    kind: OrgSignalKind;
    orgId: string;
    gatewayExternalId?: string;
    /** Exact BLU row changed. Older peers omit it, which deliberately
     *  degrades the receiver to a full inventory refresh. */
    externalId?: string;
    /** blu-inventory-changed: every BLU row one gateway pass changed.
     *  access-changed, groups-bumped: devices whose access changed; absent
     *  means the whole org, which is what older peers send. */
    externalIds?: string[];
    /** blu-inventory-changed: shared route generation after the change, so a
     *  peer can skip an older signal and detect a missed one. */
    gatewayGeneration?: number;
    /** access-changed: 'inventory' means devices were added or changed with
     *  no grant or virtual binding change. Absent means a full refresh. */
    accessScope?: 'inventory';
    /** alert-state-changed: one alert's state key; absent (with no
     *  offlineFireKeys) drops the tenant. */
    alertKey?: string;
    /** alert-state-changed: sender's per-tenant sequence, so a peer can see a
     *  missed signal. Older peers omit it, which makes the receiver reload. */
    alertSeq?: number;
    /** alert-state-changed: offline fire jobs just scheduled, by job key. */
    offlineFireKeys?: string[];
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

export interface BluetoothRouteCacheRead {
    generation: string;
    payload: string | null;
}

export interface BluetoothRouteCacheWrite {
    gatewayExternalId: string;
    generation: string;
    payload: string;
}

// Shared read-through cache for gateway-component → promoted BLU routing.
// PostgreSQL remains authoritative. The generation fence makes a concurrent
// inventory mutation reject a stale cache fill atomically.
export interface BluetoothRouteCachePort {
    read(
        organizationId: string,
        gatewayExternalId: string
    ): Promise<BluetoothRouteCacheRead>;
    readMany(
        organizationId: string,
        gatewayExternalIds: readonly string[]
    ): Promise<ReadonlyMap<string, BluetoothRouteCacheRead>>;
    setIfCurrent(
        organizationId: string,
        gatewayExternalId: string,
        generation: string,
        payload: string,
        ttlSec: number
    ): Promise<boolean>;
    setManyIfCurrent(
        organizationId: string,
        entries: readonly BluetoothRouteCacheWrite[],
        ttlSec: number
    ): Promise<readonly boolean[]>;
    invalidateGateway(
        organizationId: string,
        gatewayExternalId: string
    ): Promise<number>;
    invalidateOrg(organizationId: string): Promise<number>;
}

export interface BluetoothTelemetrySourceClaim {
    organizationId: string;
    bluetoothDeviceListId: number;
    gatewayExternalId: string;
    primary: boolean;
}

// One live telemetry owner per promoted BLU device. The configured primary
// always takes ownership; when it is silent past the TTL, one secondary may
// claim the lane. This prevents duplicate history from multi-gateway hearing.
export interface BluetoothTelemetryArbiterPort {
    acceptMany(
        claims: readonly BluetoothTelemetrySourceClaim[],
        ttlMs: number
    ): Promise<readonly boolean[]>;
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
    /** Atomic claim: true when this caller wrote the key, false when it was
     *  already held. The only way two nodes can agree on one owner. */
    setIfAbsent(key: string, value: string, ttlSec?: number): Promise<boolean>;
    /** Atomic hand-over: replace the value only while it still equals
     *  `expected`, so two callers cannot both take a key from its last owner. */
    compareAndSet(
        key: string,
        expected: string,
        value: string,
        ttlSec?: number
    ): Promise<boolean>;
    /** Atomic release: drop the key only while this caller still holds it. */
    compareAndDelete(key: string, expected: string): Promise<boolean>;
    delete(key: string): Promise<void>;
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

export interface DeviceOwnershipLease {
    shellyID: string;
    ownerId: string;
    leaseId: string;
}

// claim() succeeds only when no other instance holds the key. A reconnect on
// the same instance replaces the prior connection lease atomically.
export interface DeviceOwnershipPort {
    claim(lease: DeviceOwnershipLease, ttlMs: number): Promise<boolean>;
    heartbeatMany(
        leases: readonly DeviceOwnershipLease[],
        ttlMs: number
    ): Promise<readonly boolean[]>;
    release(lease: DeviceOwnershipLease): Promise<void>;
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
    delete(filename: string): Promise<void>;
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

export interface McpStreamPrincipal {
    username: string;
    userId?: string;
    organizationId: string | null;
    credentialId: string;
    credentialExpiresAtMs?: number;
}

export interface McpStreamSession extends McpStreamPrincipal {
    id: string;
    expiresAtMs: number;
}

export interface McpStreamSubscription {
    uri: string;
    cursor?: string;
}

export interface McpStreamFrame {
    id: string;
    payload: unknown;
}

export interface McpReplay {
    frames: McpStreamFrame[];
    gap: boolean;
}

export interface McpEventStreamsPort {
    createSession(principal: McpStreamPrincipal, id?: string): Promise<string>;
    getSession(
        id: string | undefined,
        principal: McpStreamPrincipal,
        touch?: boolean
    ): Promise<McpStreamSession | undefined>;
    deleteSession(id: string, principal: McpStreamPrincipal): Promise<boolean>;
    subscribe(
        id: string,
        principal: McpStreamPrincipal,
        subscription: McpStreamSubscription
    ): Promise<void>;
    unsubscribe(
        id: string,
        principal: McpStreamPrincipal,
        uri: string
    ): Promise<boolean>;
    listSubscriptions(
        id: string,
        principal: McpStreamPrincipal
    ): Promise<McpStreamSubscription[]>;
    updateCursor(
        id: string,
        principal: McpStreamPrincipal,
        uri: string,
        cursor: string,
        readerOwner?: string
    ): Promise<boolean>;
    appendFrame(
        id: string,
        principal: McpStreamPrincipal,
        payload: unknown,
        readerOwner?: string
    ): Promise<string>;
    replay(
        id: string,
        principal: McpStreamPrincipal,
        afterId: string | undefined
    ): Promise<McpReplay>;
    acquireReader(
        id: string,
        principal: McpStreamPrincipal,
        owner: string
    ): Promise<boolean>;
    renewReader(id: string, owner: string): Promise<boolean>;
    ownsReader(id: string, owner: string): Promise<boolean>;
    releaseReader(id: string, owner: string): Promise<void>;
    /** False when no shared store backs event streams (no Redis). */
    available(): boolean;
}

/** A remembered "yes, stop asking" for one action of one person. */
export interface McpStandingApprovalRecord {
    /** Digest of the full binding; the only handle a caller ever sees. */
    id: string;
    organizationId: string;
    userId: string;
    username: string;
    method: string;
    /** Readable target, e.g. `shellyID=aa&id=0`; empty when there is none. */
    subject: string;
    scope: 'ttl' | 'forever';
    grantedAtMs: number;
    expiresAtMs: number;
}

/** Whose approvals a list or revoke may touch: one person, or a whole org. */
export interface McpStandingApprovalScope {
    organizationId: string;
    userId?: string;
}

export interface McpStandingApprovalsPort {
    /** False when the store already holds `maxTotal` live approvals. */
    grant(
        record: McpStandingApprovalRecord,
        maxTotal: number
    ): Promise<boolean>;
    get(id: string): Promise<McpStandingApprovalRecord | null>;
    list(scope: McpStandingApprovalScope): Promise<McpStandingApprovalRecord[]>;
    revoke(id: string, scope: McpStandingApprovalScope): Promise<boolean>;
}

export interface McpConfirmationClaim {
    /** Digest of the token; the token itself is never stored. */
    tokenDigest: string;
    issuedAtMs: number;
    expiresAtMs: number;
}

/**
 * `predates_store`: the token was issued before the claim store last started,
 * so a claim it made may have been lost with the store's memory.
 */
export type McpConfirmationClaimOutcome =
    | 'claimed'
    | 'already_used'
    | 'predates_store';

export interface McpConfirmationClaimsPort {
    claim(claim: McpConfirmationClaim): Promise<McpConfirmationClaimOutcome>;
}

/** An MCP session that may receive `elicitation/create` prompts. */
export interface McpElicitationSession {
    id: string;
    /** Digest of the owning principal; only that principal may use it. */
    binding: string;
    elicitation: boolean;
}

/** A prompt a tool call is waiting on, and the instance holding the call. */
export interface McpElicitationWait {
    sessionId: string;
    requestId: string;
    binding: string;
    instanceId: string;
    expiresAtMs: number;
}

export interface McpElicitationDelivery {
    instanceId: string;
    sessionId: string;
    requestId: string;
    result: unknown;
}

export interface McpElicitationsPort {
    /** False when `maxSessions` live sessions already exist. */
    createSession(
        session: McpElicitationSession,
        limits: {ttlMs: number; maxSessions: number}
    ): Promise<boolean>;
    /** Reads and renews the session's idle expiry. */
    getSession(
        id: string,
        ttlMs: number
    ): Promise<McpElicitationSession | null>;
    /** Removes the owner's session and returns what was still waiting on it. */
    deleteSession(
        id: string,
        binding: string
    ): Promise<McpElicitationWait[] | null>;
    registerWait(wait: McpElicitationWait): Promise<void>;
    /** Removes and returns the wait, only for its owner and before expiry. */
    takeWait(
        wait: Pick<McpElicitationWait, 'sessionId' | 'requestId' | 'binding'>
    ): Promise<McpElicitationWait | null>;
    /** True only when the instance holding the call received the answer. */
    deliver(delivery: McpElicitationDelivery): Promise<boolean>;
    onDelivery(
        instanceId: string,
        handler: (delivery: McpElicitationDelivery) => void
    ): Promise<void>;
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

/** One Node-RED editor session, stored under the hash of its id. */
export interface NodeRedEditorSessionRecord {
    userId: string;
    username: string;
    displayName?: string;
    organizationId: string;
    createdAt: number;
    /** Hard end; sliding never moves the session past it. */
    maxExpiresAt: number;
    /** The user as signed in when the session was opened or refreshed. */
    principal: user_t;
}

export interface NodeRedEditorSessionWrite {
    key: string;
    record: NodeRedEditorSessionRecord;
    ttlMs: number;
    /** Older sessions of the same user beyond this count are dropped. */
    perUserMax: number;
}

// Keys are hashes of the browser's session id; the id itself is never stored.
export interface NodeRedEditorSessionPort {
    put(write: NodeRedEditorSessionWrite): Promise<void>;
    /** The live record, or null once it expired or was revoked. */
    get(key: string): Promise<NodeRedEditorSessionRecord | null>;
    delete(key: string): Promise<void>;
    /** Deletes every session of the user and returns how many there were. */
    deleteForUser(userId: string): Promise<number>;
}
