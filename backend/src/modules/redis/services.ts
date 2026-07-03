// Composition root: selects Redis-backed or null adapters once at boot so
// consumers depend on the port, not on whether Redis is wired.

import type {TripPath} from '../eventReplay';
import type {
    BulkAcceptJobStorePort,
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
    nullBulkAcceptJobStore,
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
    redisBulkAcceptJobStorePort,
    redisDeviceIngest,
    redisDeviceOwnership,
    redisDeviceShadow,
    redisDeviceSignals,
    redisDeviceTrustCache,
    redisDeviceTrustSignals,
    redisExportOwnership,
    redisIngressAudit,
    redisLeadershipFactory,
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
    sessionSignals: SessionSignalsPort;
    deviceIngest: DeviceIngestPort;
    eventReplayCache: EventReplayCachePort<TripPath>;
    leadership: LeadershipFactory;
    rateLimiter: RateLimiterPort;
    reservation: ReservationPort;
    deviceOwnership: DeviceOwnershipPort;
    deviceShadow: DeviceShadowPort;
    ingressAudit: IngressAuditPort;
    exportOwnership: ExportOwnershipPort;
    uploadTickets: UploadTicketPort;
    uploadSessions: UploadSessionPort;
    kv: KvStorePort;
    waitingStore: WaitingStorePort;
    bulkAcceptJobStore: BulkAcceptJobStorePort;
}

const nullSet = (): RedisServices => ({
    orgSignals: nullOrgSignals,
    deviceSignals: nullDeviceSignals,
    deviceTrustSignals: nullDeviceTrustSignals,
    deviceTrustCache: nullDeviceTrustCache,
    sessionSignals: nullSessionSignals,
    deviceIngest: nullDeviceIngest,
    eventReplayCache: makeNullEventReplayCache<TripPath>(),
    leadership: nullLeadershipFactory,
    rateLimiter: nullRateLimiter,
    reservation: nullReservation,
    deviceOwnership: nullDeviceOwnership,
    deviceShadow: nullDeviceShadow,
    ingressAudit: nullIngressAudit,
    exportOwnership: nullExportOwnership,
    uploadTickets: nullUploadTickets,
    uploadSessions: nullUploadSessions,
    kv: nullKv,
    waitingStore: nullWaitingStore,
    bulkAcceptJobStore: nullBulkAcceptJobStore
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
        sessionSignals: redisSessionSignals,
        deviceIngest: redisDeviceIngest,
        eventReplayCache: makeRedisEventReplayCache(),
        leadership: redisLeadershipFactory,
        rateLimiter: redisRateLimiter,
        reservation: redisReservation,
        deviceOwnership: redisDeviceOwnership,
        deviceShadow: redisDeviceShadow,
        ingressAudit: redisIngressAudit,
        exportOwnership: redisExportOwnership,
        uploadTickets: redisUploadTickets,
        uploadSessions: redisUploadSessions,
        kv: makeRedisKvStore(),
        waitingStore: redisWaitingStorePort,
        bulkAcceptJobStore: redisBulkAcceptJobStorePort
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
export const sessionSignals: SessionSignalsPort = {
    publish: (s) => services.sessionSignals.publish(s),
    on: (h) => services.sessionSignals.on(h)
};
export const deviceIngest: DeviceIngestPort = {
    appendFrame: (id, f) => services.deviceIngest.appendFrame(id, f)
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
    claim: (id, ttl) => services.deviceOwnership.claim(id, ttl),
    heartbeat: (id, ttl) => services.deviceOwnership.heartbeat(id, ttl),
    release: (id) => services.deviceOwnership.release(id),
    owner: (id) => services.deviceOwnership.owner(id)
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
    get: (f) => services.exportOwnership.get(f)
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
    set: (key, value, ttlSec) => services.kv.set(key, value, ttlSec)
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
