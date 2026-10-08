import {tuning} from '../../config/tuning';
import {mergeStatusObjects} from '../../model/statusMerge';
import {BoundedMap} from '../boundedMap';
import * as Observability from '../Observability';
import type {
    BluetoothRouteCachePort,
    BluetoothTelemetryArbiterPort,
    BulkAcceptJobRecord,
    BulkAcceptJobStorePort,
    DeviceGuiSessionPort,
    DeviceIdentityFencePort,
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
    McpConfirmationClaimsPort,
    McpElicitationSession,
    McpElicitationsPort,
    McpElicitationWait,
    McpEventStreamsPort,
    McpStandingApprovalRecord,
    McpStandingApprovalScope,
    McpStandingApprovalsPort,
    NodeRedEditorSessionPort,
    NodeRedEditorSessionRecord,
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

function mcpEventsUnavailable(): never {
    throw new Error('Durable MCP event streams require Redis');
}

export const nullMcpEventStreams: McpEventStreamsPort = {
    async createSession() {
        return mcpEventsUnavailable();
    },
    async getSession() {
        return mcpEventsUnavailable();
    },
    async deleteSession() {
        return mcpEventsUnavailable();
    },
    async subscribe() {
        return mcpEventsUnavailable();
    },
    async unsubscribe() {
        return mcpEventsUnavailable();
    },
    async listSubscriptions() {
        return mcpEventsUnavailable();
    },
    async updateCursor() {
        return mcpEventsUnavailable();
    },
    async appendFrame() {
        return mcpEventsUnavailable();
    },
    async replay() {
        return mcpEventsUnavailable();
    },
    async acquireReader() {
        return mcpEventsUnavailable();
    },
    async renewReader() {
        return mcpEventsUnavailable();
    },
    async ownsReader() {
        return mcpEventsUnavailable();
    },
    async releaseReader() {
        return mcpEventsUnavailable();
    },
    available() {
        return false;
    }
};

// In-process consent state for single-process deployments without Redis. A
// restart forgets it: approvals are asked again and older tokens are refused.
const nullApprovals = new Map<string, McpStandingApprovalRecord>();
const nullConfirmationClaims = new Map<string, number>();
// The process start, not module load: this module may load after a token was issued.
let nullConfirmationClaimsStartedAtMs = performance.timeOrigin;
const nullElicitationSessions = new Map<
    string,
    {session: McpElicitationSession; expiresAt: number}
>();
const nullElicitationWaits = new Map<string, Map<string, McpElicitationWait>>();

function liveNullApprovals(now = Date.now()): McpStandingApprovalRecord[] {
    for (const [id, record] of nullApprovals) {
        if (record.expiresAtMs <= now) nullApprovals.delete(id);
    }
    return [...nullApprovals.values()];
}

function approvalInScope(
    record: McpStandingApprovalRecord,
    scope: McpStandingApprovalScope
): boolean {
    return (
        record.organizationId === scope.organizationId &&
        (scope.userId === undefined || record.userId === scope.userId)
    );
}

export const nullMcpStandingApprovals: McpStandingApprovalsPort = {
    async grant(record, maxTotal) {
        const live = liveNullApprovals();
        if (!nullApprovals.has(record.id) && live.length >= maxTotal) {
            return false;
        }
        nullApprovals.set(record.id, {...record});
        return true;
    },
    async get(id) {
        const record = nullApprovals.get(id);
        if (!record || record.expiresAtMs <= Date.now()) return null;
        return {...record};
    },
    async list(scope) {
        return liveNullApprovals()
            .filter((record) => approvalInScope(record, scope))
            .sort((a, b) => a.grantedAtMs - b.grantedAtMs)
            .map((record) => ({...record}));
    },
    async revoke(id, scope) {
        const record = nullApprovals.get(id);
        if (!record || !approvalInScope(record, scope)) return false;
        return nullApprovals.delete(id);
    }
};

export const nullMcpConfirmationClaims: McpConfirmationClaimsPort = {
    async claim({tokenDigest, issuedAtMs, expiresAtMs}) {
        // Tokens carry whole seconds, so the start is compared at that grain.
        if (
            issuedAtMs <
            Math.floor(nullConfirmationClaimsStartedAtMs / 1000) * 1000
        ) {
            return 'predates_store';
        }
        const now = Date.now();
        for (const [seen, expiresAt] of nullConfirmationClaims) {
            if (expiresAt < now) nullConfirmationClaims.delete(seen);
        }
        if (nullConfirmationClaims.has(tokenDigest)) return 'already_used';
        nullConfirmationClaims.set(tokenDigest, expiresAtMs);
        return 'claimed';
    }
};

function liveNullElicitationSessions(now = Date.now()): number {
    for (const [id, entry] of nullElicitationSessions) {
        if (entry.expiresAt > now) continue;
        nullElicitationSessions.delete(id);
        nullElicitationWaits.delete(id);
    }
    return nullElicitationSessions.size;
}

export const nullMcpElicitations: McpElicitationsPort = {
    async createSession(session, {ttlMs, maxSessions}) {
        const now = Date.now();
        if (
            !nullElicitationSessions.has(session.id) &&
            liveNullElicitationSessions(now) >= maxSessions
        ) {
            return false;
        }
        nullElicitationSessions.set(session.id, {
            session: {...session},
            expiresAt: now + ttlMs
        });
        return true;
    },
    async getSession(id, ttlMs) {
        const entry = nullElicitationSessions.get(id);
        const now = Date.now();
        if (!entry || entry.expiresAt <= now) return null;
        entry.expiresAt = now + ttlMs;
        return {...entry.session};
    },
    async deleteSession(id, binding) {
        const entry = nullElicitationSessions.get(id);
        if (!entry || entry.session.binding !== binding) return null;
        nullElicitationSessions.delete(id);
        const waits = [...(nullElicitationWaits.get(id)?.values() ?? [])];
        nullElicitationWaits.delete(id);
        return waits;
    },
    async registerWait(wait) {
        const waits = nullElicitationWaits.get(wait.sessionId) ?? new Map();
        waits.set(wait.requestId, {...wait});
        nullElicitationWaits.set(wait.sessionId, waits);
    },
    async takeWait({sessionId, requestId, binding}) {
        const waits = nullElicitationWaits.get(sessionId);
        const wait = waits?.get(requestId);
        if (!waits || !wait || wait.binding !== binding) return null;
        waits.delete(requestId);
        if (waits.size === 0) nullElicitationWaits.delete(sessionId);
        return wait.expiresAtMs > Date.now() ? wait : null;
    },
    // One process, one instance: an answer for another instance has no taker.
    async deliver() {
        return false;
    },
    async onDelivery() {}
};

/** Test seam: the in-process consent state as a fresh process would have it. */
export function resetNullMcpConsentForTests(startedAtMs = Date.now()): void {
    nullApprovals.clear();
    nullConfirmationClaims.clear();
    nullConfirmationClaimsStartedAtMs = startedAtMs;
    nullElicitationSessions.clear();
    nullElicitationWaits.clear();
}

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

const nullBluetoothRouteGenerations = new Map<string, number>();
const nullBluetoothGatewayRouteGenerations = new Map<string, number>();
const nullBluetoothRoutes = new Map<
    string,
    {generation: string; payload: string; expiresAt: number}
>();

function nullBluetoothRouteKey(
    organizationId: string,
    gatewayExternalId: string
): string {
    return `${organizationId}\0${gatewayExternalId}`;
}

export const nullBluetoothRouteCache: BluetoothRouteCachePort = {
    async read(organizationId, gatewayExternalId) {
        const key = nullBluetoothRouteKey(organizationId, gatewayExternalId);
        const generation = `${nullBluetoothRouteGenerations.get(organizationId) ?? 0}:${nullBluetoothGatewayRouteGenerations.get(key) ?? 0}`;
        const entry = nullBluetoothRoutes.get(key);
        if (
            !entry ||
            entry.generation !== generation ||
            entry.expiresAt <= Date.now()
        ) {
            if (entry) nullBluetoothRoutes.delete(key);
            return {generation, payload: null};
        }
        return {generation, payload: entry.payload};
    },
    async readMany(organizationId, gatewayExternalIds) {
        return new Map(
            await Promise.all(
                gatewayExternalIds.map(
                    async (gatewayExternalId) =>
                        [
                            gatewayExternalId,
                            await nullBluetoothRouteCache.read(
                                organizationId,
                                gatewayExternalId
                            )
                        ] as const
                )
            )
        );
    },
    async setIfCurrent(
        organizationId,
        gatewayExternalId,
        generation,
        payload,
        ttlSec
    ) {
        const key = nullBluetoothRouteKey(organizationId, gatewayExternalId);
        const current = `${nullBluetoothRouteGenerations.get(organizationId) ?? 0}:${nullBluetoothGatewayRouteGenerations.get(key) ?? 0}`;
        if (current !== generation) return false;
        nullBluetoothRoutes.set(key, {
            generation,
            payload,
            expiresAt: Date.now() + ttlSec * 1000
        });
        return true;
    },
    async setManyIfCurrent(organizationId, entries, ttlSec) {
        return Promise.all(
            entries.map((entry) =>
                nullBluetoothRouteCache.setIfCurrent(
                    organizationId,
                    entry.gatewayExternalId,
                    entry.generation,
                    entry.payload,
                    ttlSec
                )
            )
        );
    },
    async invalidateGateway(organizationId, gatewayExternalId) {
        const key = nullBluetoothRouteKey(organizationId, gatewayExternalId);
        const generation =
            (nullBluetoothGatewayRouteGenerations.get(key) ?? 0) + 1;
        nullBluetoothGatewayRouteGenerations.set(key, generation);
        nullBluetoothRoutes.delete(key);
        return generation;
    },
    async invalidateOrg(organizationId) {
        const generation =
            (nullBluetoothRouteGenerations.get(organizationId) ?? 0) + 1;
        nullBluetoothRouteGenerations.set(organizationId, generation);
        return generation;
    }
};

const nullBluetoothTelemetryOwners = new BoundedMap<
    string,
    {gatewayExternalId: string; expiresAt: number}
>({
    maxSize: tuning.virtualDevice.bluTelemetryOwnerMaxEntries,
    ttlMs: tuning.virtualDevice.bluTelemetryFailoverMs * 2
});
const nullBluetoothTelemetryGrace = new BoundedMap<
    string,
    {readyAt: number; expiresAt: number}
>({
    maxSize: tuning.virtualDevice.bluTelemetryOwnerMaxEntries,
    ttlMs: tuning.virtualDevice.bluTelemetryFailoverMs * 2
});

export const nullBluetoothTelemetryArbiter: BluetoothTelemetryArbiterPort = {
    async acceptMany(claims, ttlMs) {
        const now = Date.now();
        return claims.map((claim) => {
            const key = `${claim.organizationId}\0${claim.bluetoothDeviceListId}`;
            const current = nullBluetoothTelemetryOwners.get(key);
            if (claim.primary) {
                nullBluetoothTelemetryOwners.set(key, {
                    gatewayExternalId: claim.gatewayExternalId,
                    expiresAt: now + ttlMs
                });
                nullBluetoothTelemetryGrace.set(key, {
                    readyAt: now,
                    expiresAt: now + ttlMs * 2
                });
                return true;
            }
            if (
                current &&
                current.expiresAt > now &&
                current.gatewayExternalId !== claim.gatewayExternalId
            ) {
                return false;
            }
            if (!current || current.expiresAt <= now) {
                nullBluetoothTelemetryOwners.delete(key);
                const grace = nullBluetoothTelemetryGrace.get(key);
                if (!grace || grace.expiresAt <= now) {
                    nullBluetoothTelemetryGrace.set(key, {
                        readyAt: now + ttlMs,
                        expiresAt: now + ttlMs * 2
                    });
                    return false;
                }
                if (grace.readyAt > now) return false;
            }
            nullBluetoothTelemetryOwners.set(key, {
                gatewayExternalId: claim.gatewayExternalId,
                expiresAt: now + ttlMs
            });
            return true;
        });
    }
};

export function clearNullBluetoothRouteCacheForTests(): void {
    nullBluetoothRouteGenerations.clear();
    nullBluetoothGatewayRouteGenerations.clear();
    nullBluetoothRoutes.clear();
}

export function clearNullBluetoothTelemetryArbiterForTests(): void {
    nullBluetoothTelemetryOwners.clear();
    nullBluetoothTelemetryGrace.clear();
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

// Single-process fallback still uses connection-scoped leases so reconnect
// behavior matches the Redis adapter.
const nullOwned = new Map<string, {ownerId: string; leaseId: string}>();
const nullIdentityFences = new Map<string, string>();

export const nullDeviceIdentityFence: DeviceIdentityFencePort = {
    async acquire(shellyIDs, token) {
        const ids = [...new Set(shellyIDs)].sort();
        if (ids.some((id) => nullIdentityFences.has(id))) return false;
        for (const id of ids) nullIdentityFences.set(id, token);
        return true;
    },
    async release(shellyIDs, token) {
        for (const id of new Set(shellyIDs)) {
            if (nullIdentityFences.get(id) === token) {
                nullIdentityFences.delete(id);
            }
        }
    }
};

export const nullDeviceOwnership: DeviceOwnershipPort = {
    async claim(lease): Promise<boolean> {
        if (nullIdentityFences.has(lease.shellyID)) return false;
        const current = nullOwned.get(lease.shellyID);
        if (current && current.ownerId !== lease.ownerId) return false;
        nullOwned.set(lease.shellyID, lease);
        return true;
    },
    async heartbeatMany(leases): Promise<readonly boolean[]> {
        return leases.map((lease) => {
            const current = nullOwned.get(lease.shellyID);
            return (
                current?.ownerId === lease.ownerId &&
                current.leaseId === lease.leaseId
            );
        });
    },
    async release(lease): Promise<void> {
        const current = nullOwned.get(lease.shellyID);
        if (
            current?.ownerId === lease.ownerId &&
            current.leaseId === lease.leaseId
        ) {
            nullOwned.delete(lease.shellyID);
        }
    },
    async owner(shellyID: string): Promise<string | null> {
        return nullOwned.get(shellyID)?.ownerId ?? null;
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
    },
    async delete(filename) {
        nullExportOwners.delete(filename);
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

interface NullDeviceGuiEntry {
    value: string;
    expiresAt: number;
}
const nullDeviceGuiSessionStore = new Map<string, NullDeviceGuiEntry>();
const nullDeviceGuiAttestations = new Map<string, NullDeviceGuiEntry>();
const nullDeviceGuiSlots = new Map<string, NullDeviceGuiEntry>();
const nullDeviceGuiRevocationHandlers = new Set<(sessionId: string) => void>();
const NULL_DEVICE_GUI_MAX = 10_000;

function readDeviceGuiEntry(
    store: Map<string, NullDeviceGuiEntry>,
    key: string,
    consume: boolean
): string | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (consume || entry.expiresAt <= Date.now()) store.delete(key);
    return entry.expiresAt > Date.now() ? entry.value : null;
}

export const nullDeviceGuiSessions: DeviceGuiSessionPort = {
    async create(input) {
        const now = Date.now();
        sweepExpiredMap(nullDeviceGuiSessionStore, now);
        sweepExpiredMap(nullDeviceGuiAttestations, now);
        sweepExpiredMap(nullDeviceGuiSlots, now);
        const replacedSessionId = readDeviceGuiEntry(
            nullDeviceGuiSlots,
            input.slotId,
            false
        );
        if (replacedSessionId) {
            nullDeviceGuiSessionStore.delete(replacedSessionId);
            nullDeviceGuiAttestations.delete(replacedSessionId);
        }
        if (nullDeviceGuiSessionStore.size >= NULL_DEVICE_GUI_MAX) {
            throw new Error('Device GUI session capacity reached');
        }
        nullDeviceGuiSessionStore.set(input.sessionId, {
            value: input.session,
            expiresAt: now + input.ttlSec * 1000
        });
        nullDeviceGuiSlots.set(input.slotId, {
            value: input.sessionId,
            expiresAt: now + input.ttlSec * 1000
        });
        return replacedSessionId;
    },
    async get(sessionId) {
        return readDeviceGuiEntry(nullDeviceGuiSessionStore, sessionId, false);
    },
    async isAttested(sessionId) {
        return (
            readDeviceGuiEntry(nullDeviceGuiAttestations, sessionId, false) !==
            null
        );
    },
    async markAttested(sessionId, ttlSec) {
        nullDeviceGuiAttestations.set(sessionId, {
            value: '1',
            expiresAt: Date.now() + ttlSec * 1000
        });
    },
    async delete(sessionId) {
        nullDeviceGuiSessionStore.delete(sessionId);
        nullDeviceGuiAttestations.delete(sessionId);
    },
    async publishRevoked(sessionId) {
        for (const handler of nullDeviceGuiRevocationHandlers) {
            handler(sessionId);
        }
    },
    async onRevoked(handler) {
        nullDeviceGuiRevocationHandlers.add(handler);
    }
};

interface NullEditorSessionEntry {
    record: NodeRedEditorSessionRecord;
    expiresAt: number;
}
const nullEditorSessions = new Map<string, NullEditorSessionEntry>();
const nullEditorSessionsByUser = new Map<string, Set<string>>();
export const NULL_EDITOR_SESSION_MAX = 10_000;

function forgetEditorSession(key: string, userId: string): void {
    nullEditorSessions.delete(key);
    const keys = nullEditorSessionsByUser.get(userId);
    keys?.delete(key);
    if (keys?.size === 0) nullEditorSessionsByUser.delete(userId);
}

function liveEditorSession(key: string): NullEditorSessionEntry | undefined {
    const entry = nullEditorSessions.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > Date.now()) return entry;
    forgetEditorSession(key, entry.record.userId);
    return undefined;
}

function sweepEditorSessions(now: number): void {
    for (const [key, entry] of nullEditorSessions) {
        if (entry.expiresAt <= now)
            forgetEditorSession(key, entry.record.userId);
    }
}

function reserveEditorSessionSlot(key: string, now: number): void {
    if (nullEditorSessions.has(key)) return;
    if (nullEditorSessions.size < NULL_EDITOR_SESSION_MAX) return;
    sweepEditorSessions(now);
    if (nullEditorSessions.size >= NULL_EDITOR_SESSION_MAX) {
        throw new Error('Node-RED editor session capacity reached');
    }
}

function trimUserEditorSessions(userId: string, keep: number): void {
    const keys = [...(nullEditorSessionsByUser.get(userId) ?? [])];
    const excess = keys.length - keep;
    if (excess <= 0) return;
    const createdAt = (key: string) =>
        nullEditorSessions.get(key)?.record.createdAt ?? 0;
    keys.sort((a, b) => createdAt(a) - createdAt(b));
    for (const key of keys.slice(0, excess)) forgetEditorSession(key, userId);
}

export const nullNodeRedEditorSessions: NodeRedEditorSessionPort = {
    async put({key, record, ttlMs, perUserMax}) {
        const now = Date.now();
        reserveEditorSessionSlot(key, now);
        nullEditorSessions.set(key, {record, expiresAt: now + ttlMs});
        const keys = nullEditorSessionsByUser.get(record.userId) ?? new Set();
        keys.add(key);
        nullEditorSessionsByUser.set(record.userId, keys);
        trimUserEditorSessions(record.userId, perUserMax);
    },
    async get(key) {
        return liveEditorSession(key)?.record ?? null;
    },
    async delete(key) {
        const entry = nullEditorSessions.get(key);
        if (entry) forgetEditorSession(key, entry.record.userId);
    },
    async deleteForUser(userId) {
        const keys = [...(nullEditorSessionsByUser.get(userId) ?? [])];
        for (const key of keys) forgetEditorSession(key, userId);
        return keys.length;
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
    },
    async setIfAbsent(key, value, ttlSec) {
        const entry = nullKvStore.get(key);
        if (entry && !nullKvExpired(entry, Date.now())) return false;
        const expiresAt =
            ttlSec !== undefined ? Date.now() + ttlSec * 1000 : null;
        nullKvStore.set(key, {value, expiresAt});
        return true;
    },
    async compareAndSet(key, expected, value, ttlSec) {
        const entry = nullKvStore.get(key);
        if (!entry || nullKvExpired(entry, Date.now())) return false;
        if (entry.value !== expected) return false;
        const expiresAt =
            ttlSec !== undefined ? Date.now() + ttlSec * 1000 : null;
        nullKvStore.set(key, {value, expiresAt});
        return true;
    },
    async compareAndDelete(key, expected) {
        const entry = nullKvStore.get(key);
        if (!entry || nullKvExpired(entry, Date.now())) return false;
        if (entry.value !== expected) return false;
        nullKvStore.delete(key);
        return true;
    },
    async delete(key) {
        nullKvStore.delete(key);
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
