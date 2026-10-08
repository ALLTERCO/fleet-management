// Composition root: selects Redis-backed or null adapters once at boot so
// consumers depend on the port, not on whether Redis is wired.

import type {TripPath} from '../eventReplay';
import type {
    BluetoothRouteCachePort,
    BluetoothTelemetryArbiterPort,
    BulkAcceptJobStorePort,
    DeviceGuiSessionPort,
    DeviceIdentityFencePort,
    DeviceIngestPort,
    DeviceOwnershipPort,
    DeviceShadowPort,
    DeviceSignalsPort,
    DeviceTrustCachePort,
    DeviceTrustSignalsPort,
    EventReplayCachePort,
    ExportOwnershipPort,
    IngressAuditPort,
    KvStorePort,
    LeadershipFactory,
    McpConfirmationClaimsPort,
    McpElicitationsPort,
    McpEventStreamsPort,
    McpStandingApprovalsPort,
    NodeRedEditorSessionPort,
    OrgSignalsPort,
    RateLimiterPort,
    ReservationPort,
    SessionSignalsPort,
    UploadSessionPort,
    UploadTicketPort,
    WaitingStorePort
} from './ports';
import {
    makeNullEventReplayCache,
    nullBluetoothRouteCache,
    nullBluetoothTelemetryArbiter,
    nullBulkAcceptJobStore,
    nullDeviceGuiSessions,
    nullDeviceIdentityFence,
    nullDeviceIngest,
    nullDeviceOwnership,
    nullDeviceShadow,
    nullDeviceSignals,
    nullDeviceTrustCache,
    nullDeviceTrustSignals,
    nullExportOwnership,
    nullIngressAudit,
    nullKv,
    nullLeadershipFactory,
    nullMcpConfirmationClaims,
    nullMcpElicitations,
    nullMcpEventStreams,
    nullMcpStandingApprovals,
    nullNodeRedEditorSessions,
    nullOrgSignals,
    nullRateLimiter,
    nullReservation,
    nullSessionSignals,
    nullUploadSessions,
    nullUploadTickets,
    nullWaitingStore
} from './ports.null';
import {
    makeRedisEventReplayCache,
    makeRedisKvStore,
    redisBluetoothRouteCache,
    redisBluetoothTelemetryArbiter,
    redisBulkAcceptJobStorePort,
    redisDeviceGuiSessions,
    redisDeviceIdentityFence,
    redisDeviceIngest,
    redisDeviceOwnership,
    redisDeviceShadow,
    redisDeviceSignals,
    redisDeviceTrustCache,
    redisDeviceTrustSignals,
    redisExportOwnership,
    redisIngressAudit,
    redisLeadershipFactory,
    redisMcpConfirmationClaims,
    redisMcpElicitations,
    redisMcpEventStreams,
    redisMcpStandingApprovals,
    redisNodeRedEditorSessions,
    redisOrgSignals,
    redisRateLimiter,
    redisReservation,
    redisSessionSignals,
    redisUploadSessions,
    redisUploadTickets,
    redisWaitingStorePort
} from './ports.redis';

interface RedisServices {
    orgSignals: OrgSignalsPort;
    deviceSignals: DeviceSignalsPort;
    deviceTrustSignals: DeviceTrustSignalsPort;
    deviceTrustCache: DeviceTrustCachePort;
    bluetoothRouteCache: BluetoothRouteCachePort;
    bluetoothTelemetryArbiter: BluetoothTelemetryArbiterPort;
    sessionSignals: SessionSignalsPort;
    deviceIngest: DeviceIngestPort;
    deviceGuiSessions: DeviceGuiSessionPort;
    eventReplayCache: EventReplayCachePort<TripPath>;
    leadership: LeadershipFactory;
    rateLimiter: RateLimiterPort;
    reservation: ReservationPort;
    deviceOwnership: DeviceOwnershipPort;
    deviceIdentityFence: DeviceIdentityFencePort;
    deviceShadow: DeviceShadowPort;
    ingressAudit: IngressAuditPort;
    exportOwnership: ExportOwnershipPort;
    uploadTickets: UploadTicketPort;
    uploadSessions: UploadSessionPort;
    kv: KvStorePort;
    waitingStore: WaitingStorePort;
    bulkAcceptJobStore: BulkAcceptJobStorePort;
    mcpEventStreams: McpEventStreamsPort;
    mcpStandingApprovals: McpStandingApprovalsPort;
    mcpConfirmationClaims: McpConfirmationClaimsPort;
    mcpElicitations: McpElicitationsPort;
    nodeRedEditorSessions: NodeRedEditorSessionPort;
}

const nullSet = (): RedisServices => ({
    orgSignals: nullOrgSignals,
    deviceSignals: nullDeviceSignals,
    deviceTrustSignals: nullDeviceTrustSignals,
    deviceTrustCache: nullDeviceTrustCache,
    bluetoothRouteCache: nullBluetoothRouteCache,
    bluetoothTelemetryArbiter: nullBluetoothTelemetryArbiter,
    sessionSignals: nullSessionSignals,
    deviceIngest: nullDeviceIngest,
    deviceGuiSessions: nullDeviceGuiSessions,
    eventReplayCache: makeNullEventReplayCache<TripPath>(),
    leadership: nullLeadershipFactory,
    rateLimiter: nullRateLimiter,
    reservation: nullReservation,
    deviceOwnership: nullDeviceOwnership,
    deviceIdentityFence: nullDeviceIdentityFence,
    deviceShadow: nullDeviceShadow,
    ingressAudit: nullIngressAudit,
    exportOwnership: nullExportOwnership,
    uploadTickets: nullUploadTickets,
    uploadSessions: nullUploadSessions,
    kv: nullKv,
    waitingStore: nullWaitingStore,
    bulkAcceptJobStore: nullBulkAcceptJobStore,
    mcpEventStreams: nullMcpEventStreams,
    mcpStandingApprovals: nullMcpStandingApprovals,
    mcpConfirmationClaims: nullMcpConfirmationClaims,
    mcpElicitations: nullMcpElicitations,
    nodeRedEditorSessions: nullNodeRedEditorSessions
});

// Default to null adapters until boot wires Redis.
let services: RedisServices = nullSet();

/** Install Redis-backed adapters; called once at boot. */
export function installRedisServices(): void {
    services = {
        orgSignals: redisOrgSignals,
        deviceSignals: redisDeviceSignals,
        deviceTrustSignals: redisDeviceTrustSignals,
        deviceTrustCache: redisDeviceTrustCache,
        bluetoothRouteCache: redisBluetoothRouteCache,
        bluetoothTelemetryArbiter: redisBluetoothTelemetryArbiter,
        sessionSignals: redisSessionSignals,
        deviceIngest: redisDeviceIngest,
        deviceGuiSessions: redisDeviceGuiSessions,
        eventReplayCache: makeRedisEventReplayCache(),
        leadership: redisLeadershipFactory,
        rateLimiter: redisRateLimiter,
        reservation: redisReservation,
        deviceOwnership: redisDeviceOwnership,
        deviceIdentityFence: redisDeviceIdentityFence,
        deviceShadow: redisDeviceShadow,
        ingressAudit: redisIngressAudit,
        exportOwnership: redisExportOwnership,
        uploadTickets: redisUploadTickets,
        uploadSessions: redisUploadSessions,
        kv: makeRedisKvStore(),
        waitingStore: redisWaitingStorePort,
        bulkAcceptJobStore: redisBulkAcceptJobStorePort,
        mcpEventStreams: redisMcpEventStreams,
        mcpStandingApprovals: redisMcpStandingApprovals,
        mcpConfirmationClaims: redisMcpConfirmationClaims,
        mcpElicitations: redisMcpElicitations,
        nodeRedEditorSessions: redisNodeRedEditorSessions
    };
}

export function resetRedisServicesForTests(): void {
    services = nullSet();
}

export function setRedisServicesForTests(
    overrides: Partial<RedisServices>
): void {
    services = {...services, ...overrides};
}

export const orgSignals: OrgSignalsPort = {
    publish: (s) => services.orgSignals.publish(s),
    onAny: (h) => services.orgSignals.onAny(h)
};
export const deviceSignals: DeviceSignalsPort = {
    publish: (s) => services.deviceSignals.publish(s),
    on: (h) => services.deviceSignals.on(h)
};
export const deviceTrustSignals: DeviceTrustSignalsPort = {
    publish: (s) => services.deviceTrustSignals.publish(s),
    on: (h) => services.deviceTrustSignals.on(h)
};
export const deviceTrustCache: DeviceTrustCachePort = {
    get: (key) => services.deviceTrustCache.get(key),
    set: (key, value, ttlSec) =>
        services.deviceTrustCache.set(key, value, ttlSec),
    del: (key) => services.deviceTrustCache.del(key)
};
export const bluetoothRouteCache: BluetoothRouteCachePort = {
    read: (org, gateway) => services.bluetoothRouteCache.read(org, gateway),
    readMany: (org, gateways) =>
        services.bluetoothRouteCache.readMany(org, gateways),
    setIfCurrent: (org, gateway, generation, payload, ttlSec) =>
        services.bluetoothRouteCache.setIfCurrent(
            org,
            gateway,
            generation,
            payload,
            ttlSec
        ),
    setManyIfCurrent: (org, entries, ttlSec) =>
        services.bluetoothRouteCache.setManyIfCurrent(org, entries, ttlSec),
    invalidateGateway: (org, gateway) =>
        services.bluetoothRouteCache.invalidateGateway(org, gateway),
    invalidateOrg: (org) => services.bluetoothRouteCache.invalidateOrg(org)
};
export const bluetoothTelemetryArbiter: BluetoothTelemetryArbiterPort = {
    acceptMany: (claims, ttlMs) =>
        services.bluetoothTelemetryArbiter.acceptMany(claims, ttlMs)
};
export const sessionSignals: SessionSignalsPort = {
    publish: (s) => services.sessionSignals.publish(s),
    on: (h) => services.sessionSignals.on(h)
};
export const deviceIngest: DeviceIngestPort = {
    appendFrame: (id, f) => services.deviceIngest.appendFrame(id, f)
};
export const deviceGuiSessions: DeviceGuiSessionPort = {
    create: (input) => services.deviceGuiSessions.create(input),
    get: (sessionId) => services.deviceGuiSessions.get(sessionId),
    isAttested: (sessionId) => services.deviceGuiSessions.isAttested(sessionId),
    markAttested: (sessionId, ttlSec) =>
        services.deviceGuiSessions.markAttested(sessionId, ttlSec),
    delete: (sessionId) => services.deviceGuiSessions.delete(sessionId),
    publishRevoked: (sessionId) =>
        services.deviceGuiSessions.publishRevoked(sessionId),
    onRevoked: (handler) => services.deviceGuiSessions.onRevoked(handler)
};
export const eventReplayCache: EventReplayCachePort<TripPath> = {
    get: (orgId, params, fetcher) =>
        services.eventReplayCache.get(orgId, params, fetcher)
};
export const leadership: LeadershipFactory = {
    create: (opts) => services.leadership.create(opts)
};
export const rateLimiter: RateLimiterPort = {
    consume: (key, cap, rps, opts) =>
        services.rateLimiter.consume(key, cap, rps, opts),
    consumeMany: (buckets, opts) =>
        services.rateLimiter.consumeMany(buckets, opts)
};
export const reservation: ReservationPort = {
    reserve: (key, cap, ttl) => services.reservation.reserve(key, cap, ttl)
};
export const deviceOwnership: DeviceOwnershipPort = {
    claim: (lease, ttl) => services.deviceOwnership.claim(lease, ttl),
    heartbeatMany: (leases, ttl) =>
        services.deviceOwnership.heartbeatMany(leases, ttl),
    release: (lease) => services.deviceOwnership.release(lease),
    owner: (id) => services.deviceOwnership.owner(id)
};
export const deviceIdentityFence: DeviceIdentityFencePort = {
    acquire: (ids, token, ttl) =>
        services.deviceIdentityFence.acquire(ids, token, ttl),
    release: (ids, token) => services.deviceIdentityFence.release(ids, token)
};
export const deviceShadow: DeviceShadowPort = {
    write: (id, fields, ttl) => services.deviceShadow.write(id, fields, ttl),
    read: (id) => services.deviceShadow.read(id),
    drop: (id) => services.deviceShadow.drop(id)
};
export const ingressAudit: IngressAuditPort = {
    push: (record, maxlen, ttlMs) =>
        services.ingressAudit.push(record, maxlen, ttlMs),
    drain: (max) => services.ingressAudit.drain(max),
    size: () => services.ingressAudit.size()
};
export const exportOwnership: ExportOwnershipPort = {
    set: (f, u, t) => services.exportOwnership.set(f, u, t),
    get: (f) => services.exportOwnership.get(f),
    delete: (f) => services.exportOwnership.delete(f)
};
export const uploadTickets: UploadTicketPort = {
    set: (token, value, ttlSec) =>
        services.uploadTickets.set(token, value, ttlSec),
    consume: (token) => services.uploadTickets.consume(token)
};
export const uploadSessions: UploadSessionPort = {
    set: (sessionId, value, ttlSec) =>
        services.uploadSessions.set(sessionId, value, ttlSec),
    get: (sessionId) => services.uploadSessions.get(sessionId),
    delete: (sessionId) => services.uploadSessions.delete(sessionId)
};
export const kv: KvStorePort = {
    get: (key) => services.kv.get(key),
    set: (key, value, ttlSec) => services.kv.set(key, value, ttlSec),
    setIfAbsent: (key, value, ttlSec) =>
        services.kv.setIfAbsent(key, value, ttlSec),
    compareAndSet: (key, expected, value, ttlSec) =>
        services.kv.compareAndSet(key, expected, value, ttlSec),
    compareAndDelete: (key, expected) =>
        services.kv.compareAndDelete(key, expected),
    delete: (key) => services.kv.delete(key)
};
export const waitingStore: WaitingStorePort = {
    upsert: (entry) => services.waitingStore.upsert(entry),
    get: (org, id) => services.waitingStore.get(org, id),
    restoreClaimed: (entry) => services.waitingStore.restoreClaimed(entry),
    isPending: (org, id) => services.waitingStore.isPending(org, id),
    heartbeat: (org, id) => services.waitingStore.heartbeat(org, id),
    mergeStatus: (org, id, status) =>
        services.waitingStore.mergeStatus(org, id, status),
    listByOrg: (org) => services.waitingStore.listByOrg(org),
    countByOrg: (org) => services.waitingStore.countByOrg(org),
    claim: (org, id) => services.waitingStore.claim(org, id),
    remove: (org, id) => services.waitingStore.remove(org, id),
    markRejected: (org, id, ttlSec) =>
        services.waitingStore.markRejected(org, id, ttlSec),
    isRejected: (org, id) => services.waitingStore.isRejected(org, id)
};
export const bulkAcceptJobStore: BulkAcceptJobStorePort = {
    set: (record, ttlSec) => services.bulkAcceptJobStore.set(record, ttlSec),
    recordProgress: (ref, progress, ttlSec) =>
        services.bulkAcceptJobStore.recordProgress(ref, progress, ttlSec),
    get: (org, jobId) => services.bulkAcceptJobStore.get(org, jobId),
    markCancel: (org, jobId, ttlSec) =>
        services.bulkAcceptJobStore.markCancel(org, jobId, ttlSec),
    isCancelRequested: (org, jobId) =>
        services.bulkAcceptJobStore.isCancelRequested(org, jobId)
};
export const mcpEventStreams: McpEventStreamsPort = {
    createSession: (principal, id) =>
        services.mcpEventStreams.createSession(principal, id),
    getSession: (id, principal, touch) =>
        services.mcpEventStreams.getSession(id, principal, touch),
    deleteSession: (id, principal) =>
        services.mcpEventStreams.deleteSession(id, principal),
    subscribe: (id, principal, subscription) =>
        services.mcpEventStreams.subscribe(id, principal, subscription),
    unsubscribe: (id, principal, uri) =>
        services.mcpEventStreams.unsubscribe(id, principal, uri),
    listSubscriptions: (id, principal) =>
        services.mcpEventStreams.listSubscriptions(id, principal),
    updateCursor: (id, principal, uri, cursor, owner) =>
        services.mcpEventStreams.updateCursor(
            id,
            principal,
            uri,
            cursor,
            owner
        ),
    appendFrame: (id, principal, payload, owner) =>
        services.mcpEventStreams.appendFrame(id, principal, payload, owner),
    replay: (id, principal, afterId) =>
        services.mcpEventStreams.replay(id, principal, afterId),
    acquireReader: (id, principal, owner) =>
        services.mcpEventStreams.acquireReader(id, principal, owner),
    renewReader: (id, owner) => services.mcpEventStreams.renewReader(id, owner),
    ownsReader: (id, owner) => services.mcpEventStreams.ownsReader(id, owner),
    releaseReader: (id, owner) =>
        services.mcpEventStreams.releaseReader(id, owner),
    available: () => services.mcpEventStreams.available()
};
export const mcpStandingApprovals: McpStandingApprovalsPort = {
    grant: (record, maxTotal) =>
        services.mcpStandingApprovals.grant(record, maxTotal),
    get: (id) => services.mcpStandingApprovals.get(id),
    list: (scope) => services.mcpStandingApprovals.list(scope),
    revoke: (id, scope) => services.mcpStandingApprovals.revoke(id, scope)
};
export const mcpConfirmationClaims: McpConfirmationClaimsPort = {
    claim: (claim) => services.mcpConfirmationClaims.claim(claim)
};
export const mcpElicitations: McpElicitationsPort = {
    createSession: (session, limits) =>
        services.mcpElicitations.createSession(session, limits),
    getSession: (id, ttlMs) => services.mcpElicitations.getSession(id, ttlMs),
    deleteSession: (id, binding) =>
        services.mcpElicitations.deleteSession(id, binding),
    registerWait: (wait) => services.mcpElicitations.registerWait(wait),
    takeWait: (wait) => services.mcpElicitations.takeWait(wait),
    deliver: (delivery) => services.mcpElicitations.deliver(delivery),
    onDelivery: (instanceId, handler) =>
        services.mcpElicitations.onDelivery(instanceId, handler)
};
export const nodeRedEditorSessions: NodeRedEditorSessionPort = {
    put: (write) => services.nodeRedEditorSessions.put(write),
    get: (key) => services.nodeRedEditorSessions.get(key),
    delete: (key) => services.nodeRedEditorSessions.delete(key),
    deleteForUser: (userId) =>
        services.nodeRedEditorSessions.deleteForUser(userId)
};
