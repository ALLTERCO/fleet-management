import {randomUUID, X509Certificate} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {TLSSocket} from 'node:tls';
import {tuning} from '../../../../config/tuning';
import {certificateChainsToFmCa} from '../../../../modules/certificate/fmCaSigner';
import {extractLeafSubject} from '../../../../modules/certificate/parser';
import {logDeviceIngressAudit} from '../../../../modules/deviceIngress/audit';
import {
    closeIdentityDeviceConnections,
    countIdentityConnections,
    countOrganizationConnections,
    countRemoteAddressConnections,
    registerConnection,
    unregisterConnection
} from '../../../../modules/deviceIngress/connectionRegistry';
import {
    approveOpenWaitingRoomForTrustedDevice,
    consumeEnrollmentTokenForWaitingRoom,
    countOpenWaitingRoom,
    deviceInIngressScope,
    ensureApprovedFleetDevice,
    findCertificateCredential,
    findEnrollmentTokenOrg,
    findTokenCredential,
    markSetupSessionConnected,
    recordRejection
} from '../../../../modules/deviceIngress/deviceIngressRepository';
import {
    type DeviceSeenRow,
    deviceSeenQueue
} from '../../../../modules/deviceIngress/deviceSeenQueue';
import {
    findCertificateCredentialCached,
    findTokenCredentialCached
} from '../../../../modules/deviceIngress/deviceTrustCache';
import {
    evaluateHandshake,
    type HandshakeEvaluation,
    type TrustedConnectionContext,
    type WaitingRoomCandidate
} from '../../../../modules/deviceIngress/handshake';
import {enqueueIngressConnection} from '../../../../modules/deviceIngress/ingressAuditBuffer';
import {ingressStage} from '../../../../modules/deviceIngress/ingressTrace';
import {
    recordConnectionMetric,
    recordHandshakeDuration,
    recordProvisioningSessionMetric,
    recordRejectionMetric
} from '../../../../modules/deviceIngress/metrics';
import {rejectionSeverityFor} from '../../../../modules/deviceIngress/rejectionReasons';
import {riskForIngress} from '../../../../modules/deviceIngress/riskPolicy';
import {settleRotationOnAcceptSafely} from '../../../../modules/deviceIngress/rotationHandshakeHook';
import {
    buildIngressSafeDetail,
    statusFromSafeDetail
} from '../../../../modules/deviceIngress/waitingRoomSafeDetail';
import {
    getDeviceOrg,
    publishDeviceOrgBinding
} from '../../../../modules/EventDistributor';
import * as Observability from '../../../../modules/Observability';
import type {WaitingAuthMethod} from '../../../../modules/redis/ports';
import {ReconnectLimiter} from '../../../../modules/WaitingRoom/ReconnectLimiter';
import type {
    DeviceIngressRejectionReason,
    DeviceIngressRiskLevel,
    DeviceIngressTransport
} from '../../../../types/api/deviceIngress';
import {hashRemoteAddress} from './shellyIngressRecorder';
import {
    certificateHeadersTrusted,
    clientAddress,
    observedTransport,
    proxyPeerTrusted
} from './shellyProxyTrust';

export interface ShellyIngressGateConfig {
    enabled: boolean;
    enforcementMode: 'record_only' | 'enforce_new' | 'enforce_all';
    waitingRoomEnabled: boolean;
    allowPlainWs: boolean;
    defaultOrganizationId: string;
    mtlsEnabled: boolean;
    maxPayloadBytes: number;
    maxConnectionsPerIdentity: number;
    maxConnectionsPerOrg: number;
    maxConnectionsPerIp: number;
    handshakesPerIpPerMinute: number;
    reconnectIpKeyMax: number;
    reconnectIpWindowMs: number;
    reconnectIpMaxPerWindow: number;
    reconnectIpBlockMs: number;
    handshakesPerOrgPerMinute: number;
    handshakesPerIdentityPerMinute: number;
    trustedCertFingerprintHeader: string;
    trustedCertPemHeader: string;
    trustedProxyCidrs: string[];
    safeDetailBytes: number;
}

export type ShellyIngressGateDecision =
    | {action: 'record_only'}
    | {
          action: 'trusted';
          context: TrustedConnectionContext;
          connectionId: string;
      }
    | {
          action: 'waiting_room';
          organizationId: string | null;
          observedTransport: DeviceIngressTransport;
          authMethod: WaitingAuthMethod;
          status: Record<string, unknown>;
      }
    | {action: 'rejected'; reasonCode: DeviceIngressRejectionReason};

export interface ShellyIngressGateInput {
    request: IncomingMessage;
    rawData: Buffer;
    reportedExternalId: string;
    closeConnection: (reason: string) => void;
}

export interface ShellyIngressGateDeps {
    config: () => ShellyIngressGateConfig;
    evaluateHandshake: typeof evaluateHandshake;
    findTokenCredential: typeof findTokenCredential;
    findCertificateCredential: typeof findCertificateCredential;
    certificateChainsToFmCa: typeof certificateChainsToFmCa;
    certificateSubject: typeof extractLeafSubject;
    deviceInScope: typeof deviceInIngressScope;
    consumeEnrollmentTokenForWaitingRoom: typeof consumeEnrollmentTokenForWaitingRoom;
    findEnrollmentTokenOrg: typeof findEnrollmentTokenOrg;
    isPendingInWaitingRoom: (input: {
        organizationId: string;
        shellyID: string;
    }) => Promise<boolean>;
    approvedDeviceOrg: (reportedExternalId: string) => string | undefined;
    publishDeviceOrgBinding: typeof publishDeviceOrgBinding;
    // Write-behind: buffer the "seen" stamp, never touch the DB on connect.
    recordDeviceSeen: (row: DeviceSeenRow) => void;
    markSetupSessionConnected: typeof markSetupSessionConnected;
    countOpenWaitingRoom: (input: {organizationId: string}) => Promise<number>;
    enqueueIngressConnection: typeof enqueueIngressConnection;
    recordRejection: typeof recordRejection;
    registerConnection: typeof registerConnection;
    unregisterConnection: typeof unregisterConnection;
    closeIdentityDeviceConnections: typeof closeIdentityDeviceConnections;
    countIdentityConnections: typeof countIdentityConnections;
    countOrganizationConnections: typeof countOrganizationConnections;
    countRemoteAddressConnections: typeof countRemoteAddressConnections;
    ensureApprovedFleetDevice: typeof ensureApprovedFleetDevice;
    approveOpenWaitingRoomForTrustedDevice: typeof approveOpenWaitingRoomForTrustedDevice;
    consumeRateLimit: (
        key: string,
        capacityPerMinute: number
    ) => Promise<boolean>;
}

const defaultDeps: ShellyIngressGateDeps = {
    config: readShellyIngressGateConfig,
    evaluateHandshake,
    findTokenCredential: (input) =>
        findTokenCredentialCached(input, findTokenCredential),
    findCertificateCredential: (input) =>
        findCertificateCredentialCached(input, findCertificateCredential),
    certificateChainsToFmCa,
    certificateSubject: extractLeafSubject,
    deviceInScope: deviceInIngressScope,
    consumeEnrollmentTokenForWaitingRoom,
    findEnrollmentTokenOrg,
    approvedDeviceOrg: getDeviceOrg,
    publishDeviceOrgBinding,
    isPendingInWaitingRoom: isPendingInWaitingStore,
    recordDeviceSeen: (row) => deviceSeenQueue.enqueue(row),
    markSetupSessionConnected,
    enqueueIngressConnection,
    recordRejection,
    countOpenWaitingRoom,
    registerConnection,
    unregisterConnection,
    closeIdentityDeviceConnections,
    countIdentityConnections,
    countOrganizationConnections,
    countRemoteAddressConnections,
    ensureApprovedFleetDevice,
    approveOpenWaitingRoomForTrustedDevice,
    consumeRateLimit: consumeIngressRateLimit
};

export async function evaluateShellyIngressGate(
    input: ShellyIngressGateInput,
    deps: ShellyIngressGateDeps = defaultDeps
): Promise<ShellyIngressGateDecision> {
    const config = deps.config();
    const startMs = performance.now();
    noteUntrustedForwardedHeaders(input.request, config);
    // Keyed on the server-resolved peer IP, not the device-claimed src, so a
    // device rotating shellyIDs to evade the per-shellyID cap is still caught.
    // Runs before the legacy short-circuit: a record_only flood is bounded too.
    if (!ipReconnectAllowed(input, config)) {
        if (enforcementBehavior(config).useLegacyPath) {
            return {action: 'rejected', reasonCode: 'rate_limit_exceeded'};
        }
        await recordRejected(input, 'rate_limit_exceeded', config, deps);
        return {action: 'rejected', reasonCode: 'rate_limit_exceeded'};
    }
    if (enforcementBehavior(config).useLegacyPath) {
        recordObservedSeen(input, config, deps);
        return {action: 'record_only'};
    }
    try {
        if (payloadTooLarge(input.rawData, config)) {
            await recordRejected(input, 'malformed_handshake', config, deps);
            return {action: 'rejected', reasonCode: 'malformed_handshake'};
        }
        if (!(await ipHandshakeAllowed(input, config, deps))) {
            await recordRejected(input, 'rate_limit_exceeded', config, deps);
            return {action: 'rejected', reasonCode: 'rate_limit_exceeded'};
        }

        const result = await evaluateHandshakeForRequest(input, config, deps);
        return handleHandshakeResult(input, result, config, deps);
    } finally {
        recordHandshakeDuration(performance.now() - startMs);
    }
}

// One admission check for sockets Fleet recognizes without a credential: a
// waiting-room approval or a grandfathered known device. An approved row is
// not proof of identity, so such a socket gets no identity budget and shares
// nothing with the device it claims to be: its identity key is unique to the
// socket, and only the address and organization caps apply. record_only
// counts and never refuses; the enforce modes refuse on a full cap.
export interface RecognizedAdmissionInput {
    request: IncomingMessage;
    reportedExternalId: string;
    organizationId: string;
    closeConnection: (reason: string) => void;
}

export type RecognizedAdmission =
    | {reason: DeviceIngressRejectionReason; connectionId: null}
    | {reason: null; connectionId: string};

export function admitRecognizedConnection(
    input: RecognizedAdmissionInput,
    deps: ShellyIngressGateDeps = defaultDeps
): RecognizedAdmission {
    const config = deps.config();
    const remoteHash = remoteAddressHash(input.request, config);
    const orgFull =
        deps.countOrganizationConnections(input.organizationId) +
            reserved(reservedByOrganization, input.organizationId) >=
        config.maxConnectionsPerOrg;
    const addressFull =
        deps.countRemoteAddressConnections(remoteHash) +
            reserved(reservedByRemoteAddress, remoteHash) >=
        config.maxConnectionsPerIp;
    if (orgFull || addressFull) {
        if (!enforcementBehavior(config).useLegacyPath) {
            return {reason: 'connection_cap_reached', connectionId: null};
        }
        Observability.incrementCounter('device_ingress_cap_would_refuse_total');
    }
    const connectionId = `recognized:${randomUUID()}`;
    const transport = transportOf(input, config);
    deps.registerConnection({
        connectionId,
        organizationId: input.organizationId,
        // Unique per socket: a claimed id never fills a real device's identity cap.
        identityId: `unverified:${connectionId}`,
        credentialId: null,
        reportedExternalId: input.reportedExternalId,
        metricLabels: {
            securityModel: 'direct_token',
            transport,
            riskLevel: riskForIngress({
                securityModel: 'direct_token',
                transport
            })
        },
        remoteAddressHash: remoteHash,
        close: input.closeConnection
    });
    return {reason: null, connectionId};
}

export function unregisterShellyIngressConnection(
    connectionId: string,
    deps: Pick<ShellyIngressGateDeps, 'unregisterConnection'> = defaultDeps
): void {
    deps.unregisterConnection(connectionId);
}

// Single mapping from enforcement mode -> gate behavior. A new mode is added
// here, never via scattered `=== 'enforce_x'` checks. Disabled is treated as
// record_only so both legacy cases collapse to one rule.
interface EnforcementBehavior {
    useLegacyPath: boolean;
    grandfatherKnownDevices: boolean;
}

function enforcementBehavior(
    config: ShellyIngressGateConfig
): EnforcementBehavior {
    const mode = config.enabled ? config.enforcementMode : 'record_only';
    return {
        useLegacyPath: mode === 'record_only',
        grandfatherKnownDevices: mode === 'enforce_new'
    };
}

function payloadTooLarge(
    rawData: Buffer,
    config: ShellyIngressGateConfig
): boolean {
    return rawData.byteLength > config.maxPayloadBytes;
}

async function evaluateHandshakeForRequest(
    input: ShellyIngressGateInput,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps
): Promise<HandshakeEvaluation> {
    return deps.evaluateHandshake(
        {
            reportedExternalId: input.reportedExternalId,
            // Per-source fallback id: devices that report no id must not
            // share one 'unknown' key for caps and cooldown markers.
            fallbackExternalId: `unknown:${remoteAddressHash(input.request, config) ?? 'noip'}`,
            observedTransport: transportOf(input, config),
            token: tokenFromRequest(input.request),
            certificateFingerprint: certificateFingerprintFromRequest(
                input.request,
                config
            ),
            certificatePem: certificatePemFromRequest(input.request, config),
            waitingRoomEnabled: config.waitingRoomEnabled,
            deploymentPolicy: {allowPlainWs: config.allowPlainWs},
            safeDetail: safeDetail(input, config),
            grandfatherKnownDevices:
                enforcementBehavior(config).grandfatherKnownDevices
        },
        {
            findTokenCredential: (lookup) => deps.findTokenCredential(lookup),
            findCertificateCredential: (lookup) =>
                deps.findCertificateCredential(lookup),
            certificateChainsToFmCa: (lookup) =>
                deps.certificateChainsToFmCa(lookup.certificatePem),
            certificateSubject: (lookup) =>
                deps.certificateSubject(lookup.certificatePem),
            deviceInScope: (lookup) => deps.deviceInScope(lookup),
            consumeEnrollmentTokenForWaitingRoom: (lookup) =>
                deps.consumeEnrollmentTokenForWaitingRoom(lookup),
            findEnrollmentTokenOrg: (lookup) =>
                deps.findEnrollmentTokenOrg(lookup),
            isPendingInWaitingRoom: (lookup) =>
                deps.isPendingInWaitingRoom(lookup),
            approvedDeviceOrg: (id) => deps.approvedDeviceOrg(id)
        }
    );
}

async function handleHandshakeResult(
    input: ShellyIngressGateInput,
    result: HandshakeEvaluation,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps
): Promise<ShellyIngressGateDecision> {
    if (result.result === 'accepted') {
        return acceptTrustedConnection(input, result.context, config, deps);
    }
    if (result.result === 'known_device') {
        // Already-approved device: connect via the legacy admit, no identity.
        recordObservedSeen(input, config, deps);
        return {action: 'record_only'};
    }
    if (result.result === 'waiting_room') {
        await recordWaitingRoom(input, result.entry, config, deps);
        return {
            action: 'waiting_room',
            organizationId:
                result.entry.organizationId || config.defaultOrganizationId,
            observedTransport: transportOf(input, config),
            // The handshake declares what the device presented; a credential-less
            // device is 'none' so the default-org fan-out surfaces it.
            authMethod: result.entry.authMethod,
            status: statusFromSafeDetail(safeDetail(input, config))
        };
    }
    await recordRejected(input, result.rejection.reasonCode, config, deps);
    return {action: 'rejected', reasonCode: result.rejection.reasonCode};
}

// Stamp the device's last-observed posture + liveness onto device.list
// (write-behind, keyed on the reported id). The record_only and grandfather
// admits funnel here so real devices — not just credentialed ones — get a
// durable last_seen. Skipped when ingress is off or the device reports no id.
function recordObservedSeen(
    input: ShellyIngressGateInput,
    config: ShellyIngressGateConfig,
    deps: Pick<ShellyIngressGateDeps, 'recordDeviceSeen'>
): void {
    if (!config.enabled || !input.reportedExternalId) return;
    const transport = transportOf(input, config);
    deps.recordDeviceSeen({
        reportedExternalId: input.reportedExternalId,
        seenAtMs: Date.now(),
        posture: {
            transport,
            securityModel: 'direct_token',
            riskLevel: riskForIngress({
                securityModel: 'direct_token',
                transport
            }),
            credentialId: null
        }
    });
}

async function acceptTrustedConnection(
    input: ShellyIngressGateInput,
    context: TrustedConnectionContext,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps
): Promise<ShellyIngressGateDecision> {
    deps.closeIdentityDeviceConnections(
        context.identityId,
        input.reportedExternalId,
        'same_device_reconnect'
    );
    // Reserve the cap slot synchronously so concurrent handshakes can't all
    // pass at cap-1 across the awaits below. Released on any exit.
    const reservation = reserveConnectionSlot(input, context, config, deps);
    if (reservation.reason) {
        await recordRejected(input, reservation.reason, config, deps, context);
        return {action: 'rejected', reasonCode: reservation.reason};
    }
    return acceptReservedConnection(input, context, config, deps, reservation);
}

async function acceptReservedConnection(
    input: ShellyIngressGateInput,
    context: TrustedConnectionContext,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps,
    reservation: ConnectionReservation
): Promise<ShellyIngressGateDecision> {
    try {
        const rejection = await trustedConnectionRejection(
            input,
            context,
            config,
            deps
        );
        if (rejection) {
            await recordRejected(input, rejection, config, deps, context);
            return {action: 'rejected', reasonCode: rejection};
        }
        await settleTrustedSideEffects(input, context, config, deps);
        const connectionId = await recordTrustedConnection(
            input,
            context,
            config,
            deps
        );
        return {action: 'trusted', context, connectionId};
    } finally {
        reservation.release();
    }
}

// Guard phase — first failing gate wins. The cap is enforced earlier via the
// synchronous reservation; this phase covers the remaining async gates.
async function trustedConnectionRejection(
    input: ShellyIngressGateInput,
    context: TrustedConnectionContext,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps
): Promise<DeviceIngressRejectionReason | null> {
    if (!(await orgHandshakeAllowed(context, config, deps))) {
        return 'rate_limit_exceeded';
    }
    if (!(await identityHandshakeAllowed(context, config, deps))) {
        return 'rate_limit_exceeded';
    }
    if (!(await bindTrustedFleetDevice(input, context, deps))) {
        return 'device_not_bound';
    }
    return null;
}

async function settleTrustedSideEffects(
    input: ShellyIngressGateInput,
    context: TrustedConnectionContext,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps
): Promise<void> {
    await deps.approveOpenWaitingRoomForTrustedDevice({
        organizationId: context.organizationId,
        reportedExternalId: input.reportedExternalId,
        observedTransport: transportOf(input, config),
        identityId: context.identityId
    });
    // Buffer the "seen" stamp — the device's trusted posture + credential; the
    // flusher writes it to device.list in one bulk round-trip. No DB on connect.
    deps.recordDeviceSeen({
        reportedExternalId: input.reportedExternalId,
        seenAtMs: Date.now(),
        posture: {
            transport: context.transport,
            securityModel: context.securityModel,
            riskLevel: context.riskLevel,
            credentialId: context.credentialId
        }
    });
    // Durable presence queued; the flusher writes it in bulk (no DB on connect).
    ingressStage(input.reportedExternalId, 'seen-queued');
    const completedSessions = await deps.markSetupSessionConnected({
        organizationId: context.organizationId,
        reportedExternalId: input.reportedExternalId
    });
    if (completedSessions > 0) {
        recordProvisioningSessionMetric({
            outcome: 'connected',
            profile: 'unknown'
        });
    }
}

async function recordTrustedConnection(
    input: ShellyIngressGateInput,
    context: TrustedConnectionContext,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps
): Promise<string> {
    const connectionId = await deps.enqueueIngressConnection({
        organizationId: context.organizationId,
        identityId: context.identityId,
        credentialId: context.credentialId,
        reportedExternalId: input.reportedExternalId,
        observedTransport: transportOf(input, config),
        result: 'accepted',
        reasonCode: null,
        remoteAddressHash: remoteAddressHash(input.request, config),
        userAgent: userAgent(input.request),
        safeDetail: safeDetail(input, config)
    });
    recordConnectionMetric({
        result: 'accepted',
        labels: {
            securityModel: context.securityModel,
            transport: context.transport,
            riskLevel: context.riskLevel
        }
    });
    await logDeviceIngressAudit({
        kind: 'handshake_accepted',
        organizationId: context.organizationId,
        actor: 'device',
        subjectId: context.identityId,
        details: {
            credentialId: context.credentialId,
            // No credential => admitted by prior approval (enforce_new).
            grandfathered: context.credentialId === null,
            reportedExternalId: input.reportedExternalId,
            transport: transportOf(input, config),
            connectionId
        }
    });
    // Not awaited: settling a rotation must never delay or block the device.
    settleRotationOnAcceptSafely({
        organizationId: context.organizationId,
        identityId: context.identityId,
        credentialId: context.credentialId
    });
    deps.registerConnection({
        connectionId,
        organizationId: context.organizationId,
        identityId: context.identityId,
        credentialId: context.credentialId,
        reportedExternalId: input.reportedExternalId,
        metricLabels: {
            securityModel: context.securityModel,
            transport: context.transport,
            riskLevel: context.riskLevel
        },
        remoteAddressHash: remoteAddressHash(input.request, config),
        close: input.closeConnection
    });
    return connectionId;
}

async function bindTrustedFleetDevice(
    input: ShellyIngressGateInput,
    context: TrustedConnectionContext,
    deps: Pick<
        ShellyIngressGateDeps,
        | 'ensureApprovedFleetDevice'
        | 'approvedDeviceOrg'
        | 'publishDeviceOrgBinding'
    >
): Promise<boolean> {
    const bound = await deps.ensureApprovedFleetDevice({
        organizationId: context.organizationId,
        reportedExternalId: input.reportedExternalId,
        overrideDenied: false
    });
    // Null: another org owns the row, or an operator denied the device.
    if (bound === null) return false;
    // First admission to this org, as a waiting-room approval does it; a
    // known device's reconnect leaves the org's access cache alone.
    if (deps.approvedDeviceOrg(bound.externalId) !== bound.organizationId) {
        deps.publishDeviceOrgBinding(bound.externalId, bound.organizationId);
    }
    return true;
}

interface ConnectionReservation {
    reason: DeviceIngressRejectionReason | null;
    release(): void;
}

// Slots reserved but not yet registered. Added to live counts (no await
// between read and write) to close the check-to-register race at cap-1.
const reservedByIdentity = new Map<string, number>();
const reservedByOrganization = new Map<string, number>();
const reservedByRemoteAddress = new Map<string, number>();

// Atomic: verify every cap against live + reserved, then claim a slot on all
// three keys. No await may run between the reads and the writes.
function reserveConnectionSlot(
    input: ShellyIngressGateInput,
    context: TrustedConnectionContext,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps
): ConnectionReservation {
    const remoteHash = remoteAddressHash(input.request, config);
    const reason = connectionCapReason(input, context, config, deps);
    if (reason) return {reason, release: () => {}};
    bumpReservation(reservedByIdentity, context.identityId, 1);
    bumpReservation(reservedByOrganization, context.organizationId, 1);
    if (remoteHash) bumpReservation(reservedByRemoteAddress, remoteHash, 1);
    return {reason: null, release: () => releaseSlot(context, remoteHash)};
}

function releaseSlot(
    context: TrustedConnectionContext,
    remoteHash: string | null
): void {
    bumpReservation(reservedByIdentity, context.identityId, -1);
    bumpReservation(reservedByOrganization, context.organizationId, -1);
    if (remoteHash) bumpReservation(reservedByRemoteAddress, remoteHash, -1);
}

function connectionCapReason(
    input: ShellyIngressGateInput,
    context: TrustedConnectionContext,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps
): DeviceIngressRejectionReason | null {
    const remoteHash = remoteAddressHash(input.request, config);
    if (
        deps.countIdentityConnections(context.identityId) +
            reserved(reservedByIdentity, context.identityId) >=
        config.maxConnectionsPerIdentity
    ) {
        return 'connection_cap_reached';
    }
    if (
        deps.countOrganizationConnections(context.organizationId) +
            reserved(reservedByOrganization, context.organizationId) >=
        config.maxConnectionsPerOrg
    ) {
        return 'connection_cap_reached';
    }
    if (
        deps.countRemoteAddressConnections(remoteHash) +
            reserved(reservedByRemoteAddress, remoteHash) >=
        config.maxConnectionsPerIp
    ) {
        return 'connection_cap_reached';
    }
    return null;
}

function reserved(table: Map<string, number>, key: string | null): number {
    if (!key) return 0;
    return table.get(key) ?? 0;
}

function bumpReservation(
    table: Map<string, number>,
    key: string,
    delta: 1 | -1
): void {
    const next = (table.get(key) ?? 0) + delta;
    if (next <= 0) table.delete(key);
    else table.set(key, next);
}

// Pending reservations are process-local; tests must start from a clean tally.
export function clearShellyIngressReservationsForTests(): void {
    reservedByIdentity.clear();
    reservedByOrganization.clear();
    reservedByRemoteAddress.clear();
}

async function ipHandshakeAllowed(
    input: ShellyIngressGateInput,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps
): Promise<boolean> {
    return deps.consumeRateLimit(
        `device-ingress:ip:${remoteAddressHash(input.request, config) ?? 'unknown'}`,
        config.handshakesPerIpPerMinute
    );
}

// In-process per-IP reconnect cap. Spoof-proof: the key is the server-resolved
// peer IP, not the device-claimed src. Lazily built so config drives its limits.
let ipReconnectLimiter: ReconnectLimiter | null = null;
let ipReconnectLimiterConfig: {
    keyMax: number;
    windowMs: number;
    maxPerWindow: number;
    blockMs: number;
} | null = null;

function ipReconnectAllowed(
    input: ShellyIngressGateInput,
    config: ShellyIngressGateConfig
): boolean {
    const limiter = resolveIpReconnectLimiter(config);
    const key = remoteAddressHash(input.request, config) ?? 'unknown';
    return limiter.check(key).allowed;
}

function resolveIpReconnectLimiter(
    config: ShellyIngressGateConfig
): ReconnectLimiter {
    const wanted = {
        keyMax: config.reconnectIpKeyMax,
        windowMs: config.reconnectIpWindowMs,
        maxPerWindow: config.reconnectIpMaxPerWindow,
        blockMs: config.reconnectIpBlockMs
    };
    if (!ipReconnectLimiter || !sameLimiterConfig(wanted)) {
        ipReconnectLimiter = new ReconnectLimiter({
            maxKeys: wanted.keyMax,
            windowMs: wanted.windowMs,
            maxPerWindow: wanted.maxPerWindow,
            blockMs: wanted.blockMs
        });
        ipReconnectLimiterConfig = wanted;
    }
    return ipReconnectLimiter;
}

function sameLimiterConfig(wanted: {
    keyMax: number;
    windowMs: number;
    maxPerWindow: number;
    blockMs: number;
}): boolean {
    const current = ipReconnectLimiterConfig;
    return (
        current !== null &&
        current.keyMax === wanted.keyMax &&
        current.windowMs === wanted.windowMs &&
        current.maxPerWindow === wanted.maxPerWindow &&
        current.blockMs === wanted.blockMs
    );
}

// The per-IP reconnect limiter is process-local; tests must start clean.
export function clearShellyIngressIpReconnectForTests(): void {
    ipReconnectLimiter?.clearAll();
    ipReconnectLimiter = null;
    ipReconnectLimiterConfig = null;
}

async function orgHandshakeAllowed(
    context: TrustedConnectionContext,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps
): Promise<boolean> {
    return deps.consumeRateLimit(
        `device-ingress:org:${context.organizationId}`,
        config.handshakesPerOrgPerMinute
    );
}

async function identityHandshakeAllowed(
    context: TrustedConnectionContext,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps
): Promise<boolean> {
    return deps.consumeRateLimit(
        `device-ingress:identity:${context.identityId}`,
        config.handshakesPerIdentityPerMinute
    );
}

async function recordWaitingRoom(
    input: ShellyIngressGateInput,
    entry: WaitingRoomCandidate,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps
): Promise<void> {
    // Enrollment-token devices land in the TOKEN's org (carried on the entry);
    // everything else uses the configured default. Never the device-claimed id.
    const organizationId = entry.organizationId || config.defaultOrganizationId;
    if (!organizationId) return;
    // A new open device lives in the Redis waiting store, not the durable
    // device_ingress_waiting_room table — only the connection/audit trail is
    // kept here, and off the hot path: the row is buffered in Redis and flushed
    // to Postgres in batches, so connect no longer blocks on an INSERT or COUNT.
    await deps.enqueueIngressConnection({
        organizationId,
        identityId: null,
        credentialId: null,
        reportedExternalId: input.reportedExternalId,
        observedTransport: transportOf(input, config),
        result: 'waiting_room',
        reasonCode: null,
        remoteAddressHash: remoteAddressHash(input.request, config),
        safeDetail: safeDetail(input, config),
        userAgent: userAgent(input.request)
    });
    recordConnectionMetric({
        result: 'waiting_room',
        labels: {
            securityModel: entry.securityModel,
            transport: transportOf(input, config),
            riskLevel: entry.riskLevel
        }
    });
    await logDeviceIngressAudit({
        kind: 'handshake_waiting_room',
        organizationId,
        actor: 'device',
        subjectId: input.reportedExternalId,
        details: {
            reportedExternalId: input.reportedExternalId,
            transport: transportOf(input, config)
        }
    });
}

// Transient infra throttles must not cool a device out — it should retry soon,
// and the cooldown key is a spoofable src. Terminal reasons still cool down.
const COOLDOWN_EXEMPT_REASONS = new Set<DeviceIngressRejectionReason>([
    'rate_limit_exceeded',
    'connection_cap_reached'
]);

async function recordRejected(
    input: ShellyIngressGateInput,
    reasonCode: DeviceIngressRejectionReason,
    config: ShellyIngressGateConfig,
    deps: ShellyIngressGateDeps,
    context?: TrustedConnectionContext
): Promise<void> {
    const organizationId =
        context?.organizationId ?? config.defaultOrganizationId;
    if (!organizationId) return;
    const connectionId = await deps.enqueueIngressConnection({
        organizationId,
        identityId: context?.identityId ?? null,
        credentialId: context?.credentialId ?? null,
        reportedExternalId: input.reportedExternalId,
        observedTransport: transportOf(input, config),
        result: 'rejected',
        reasonCode,
        remoteAddressHash: remoteAddressHash(input.request, config),
        userAgent: userAgent(input.request),
        safeDetail: safeDetail(input, config)
    });
    recordConnectionMetric({
        result: 'rejected',
        labels: {
            securityModel: context?.securityModel ?? 'direct_token',
            transport: transportOf(input, config),
            riskLevel: context?.riskLevel ?? fallbackRiskLevel(input, config)
        }
    });
    await deps.recordRejection({
        organizationId,
        identityId: context?.identityId ?? null,
        credentialId: context?.credentialId ?? null,
        reasonCode,
        severity: rejectionSeverityFor(reasonCode),
        reportedExternalId: input.reportedExternalId,
        observedTransport: transportOf(input, config),
        safeDetail: safeDetail(input, config)
    });
    recordRejectionMetric({
        reason: reasonCode,
        severity: rejectionSeverityFor(reasonCode),
        transport: transportOf(input, config)
    });
    await markRejectedInStore(
        organizationId,
        input.reportedExternalId,
        remoteAddressHash(input.request, config) ?? 'noip',
        !COOLDOWN_EXEMPT_REASONS.has(reasonCode)
    );
    await logDeviceIngressAudit({
        kind: 'handshake_rejected',
        organizationId,
        actor: 'device',
        subjectId: context?.identityId ?? input.reportedExternalId,
        details: {
            credentialId: context?.credentialId,
            reportedExternalId: input.reportedExternalId,
            transport: transportOf(input, config),
            reasonCode,
            connectionId
        },
        success: false
    });
}

function fallbackRiskLevel(
    input: ShellyIngressGateInput,
    config: ShellyIngressGateConfig
): DeviceIngressRiskLevel {
    return transportOf(input, config) === 'ws' ? 'legacy' : 'compatible';
}

async function markRejectedInStore(
    organizationId: string,
    shellyID: string,
    sourceKey: string,
    withCooldown: boolean
): Promise<void> {
    // Lazy import keeps pure tests off the Redis barrel.
    const {dropPending, markRejected} = await import(
        '../../../../modules/WaitingRoom/redisWaitingStore.js'
    );
    if (withCooldown) await markRejected(organizationId, shellyID, sourceKey);
    await dropPending(organizationId, shellyID);
}

async function isPendingInWaitingStore(input: {
    organizationId: string;
    shellyID: string;
}): Promise<boolean> {
    // Lazy import keeps pure tests off the Redis barrel.
    const {isPending} = await import(
        '../../../../modules/WaitingRoom/redisWaitingStore.js'
    );
    return isPending(input.organizationId, input.shellyID);
}

async function consumeIngressRateLimit(
    key: string,
    capacityPerMinute: number
): Promise<boolean> {
    // Lazy import avoids pulling full Redis/runtime config into pure tests.
    const {rateLimiter} = await import('../../../../modules/redis/services.js');
    return rateLimiter.consume(key, capacityPerMinute, capacityPerMinute / 60);
}

function tokenFromRequest(request: IncomingMessage): string | null {
    return queryValue(request, 'token') ?? bearerToken(request);
}

function queryValue(request: IncomingMessage, name: string): string | null {
    const url = new URL(request.url ?? '/', 'ws://fleet-manager.local');
    const value = url.searchParams.get(name);
    return value && value.length > 0 ? value : null;
}

function bearerToken(request: IncomingMessage): string | null {
    const header = request.headers.authorization;
    if (typeof header !== 'string') return null;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match?.[1] ?? null;
}

function certificateFingerprintFromRequest(
    request: IncomingMessage,
    config: ShellyIngressGateConfig
): string | null {
    return (
        certificateFingerprintFromHeader(request, config) ??
        certificateFingerprintFromPemHeader(request, config) ??
        peerCertificateFingerprint(request)
    );
}

function certificateFingerprintFromHeader(
    request: IncomingMessage,
    config: ShellyIngressGateConfig
): string | null {
    if (!config.trustedCertFingerprintHeader) return null;
    // A forwarded cert is believed only from the trusted proxy and only
    // when this install runs device mTLS at all.
    if (
        !certificateHeadersTrusted(
            request,
            config.trustedProxyCidrs,
            config.mtlsEnabled
        )
    ) {
        return null;
    }
    const value =
        request.headers[config.trustedCertFingerprintHeader.toLowerCase()];
    if (Array.isArray(value)) return normalizeFingerprint(value[0]);
    return normalizeFingerprint(value);
}

function certificateFingerprintFromPemHeader(
    request: IncomingMessage,
    config: ShellyIngressGateConfig
): string | null {
    return fingerprintFromPem(certificatePemFromHeader(request, config));
}

function peerCertificateFingerprint(request: IncomingMessage): string | null {
    const socket = request.socket as TLSSocket;
    if (!socket.encrypted || typeof socket.getPeerCertificate !== 'function') {
        return null;
    }
    const certificate = socket.getPeerCertificate();
    return normalizeFingerprint(certificate?.fingerprint256);
}

// Leaf PEM from direct TLS or a trusted mTLS proxy.
function certificatePemFromRequest(
    request: IncomingMessage,
    config: ShellyIngressGateConfig
): string | null {
    return (
        certificatePemFromHeader(request, config) ?? peerCertificatePem(request)
    );
}

function certificatePemFromHeader(
    request: IncomingMessage,
    config: ShellyIngressGateConfig
): string | null {
    if (!config.trustedCertPemHeader) return null;
    if (
        !certificateHeadersTrusted(
            request,
            config.trustedProxyCidrs,
            config.mtlsEnabled
        )
    ) {
        return null;
    }
    const value = firstHeaderValue(
        request.headers[config.trustedCertPemHeader.toLowerCase()]
    );
    return normalizePemHeader(value);
}

function peerCertificatePem(request: IncomingMessage): string | null {
    const socket = request.socket as TLSSocket;
    if (!socket.encrypted || typeof socket.getPeerCertificate !== 'function') {
        return null;
    }
    const der = socket.getPeerCertificate()?.raw;
    if (!der || der.length === 0) return null;
    const base64 =
        der
            .toString('base64')
            .match(/.{1,64}/g)
            ?.join('\n') ?? '';
    return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

function normalizePemHeader(value: string | null): string | null {
    if (!value) return null;
    const decoded = safeDecodeURIComponent(value);
    return decoded.includes('-----BEGIN CERTIFICATE-----') ? decoded : null;
}

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function fingerprintFromPem(pem: string | null): string | null {
    if (!pem) return null;
    return parseFingerprintFromPem(pem);
}

function parseFingerprintFromPem(pem: string): string | null {
    try {
        return normalizeFingerprint(new X509Certificate(pem).fingerprint256);
    } catch {
        return null;
    }
}

function normalizeFingerprint(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replaceAll(':', '').trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
}

function remoteAddressHash(
    request: IncomingMessage,
    config: ShellyIngressGateConfig
): string | null {
    // Behind the trusted proxy the socket peer is the proxy; key on the device's
    // real IP so rate-limits and connection caps aren't shared across a fleet.
    return hashRemoteAddress(clientAddress(request, config.trustedProxyCidrs));
}

// Forwarded headers from a peer outside the trusted list are ignored. Count
// them: either a spoof, or a proxy the operator forgot to trust, in which
// case every device behind it shares one address budget.
function noteUntrustedForwardedHeaders(
    request: IncomingMessage,
    config: ShellyIngressGateConfig
): void {
    const forwarded =
        request.headers['x-forwarded-for'] ??
        request.headers['x-forwarded-proto'];
    if (forwarded === undefined) return;
    if (proxyPeerTrusted(request, config.trustedProxyCidrs)) return;
    Observability.incrementCounter('device_ingress_proxy_untrusted_total');
}

// The transport the server saw for this socket: TLS here, or a trusted proxy
// saying https or wss. Never a configured label.
function transportOf(
    input: Pick<ShellyIngressGateInput, 'request'>,
    config: ShellyIngressGateConfig
): DeviceIngressTransport {
    return observedTransport(input.request, config.trustedProxyCidrs);
}

function userAgent(request: IncomingMessage): string | null {
    const header = request.headers['user-agent'];
    if (Array.isArray(header)) return header[0] ?? null;
    return header ?? null;
}

function safeDetail(
    input: ShellyIngressGateInput,
    config: ShellyIngressGateConfig
): Record<string, unknown> {
    return buildIngressSafeDetail({
        reportedExternalId: input.reportedExternalId,
        requestSummary: {
            url: input.request.url,
            userAgent: userAgent(input.request)
        },
        rawData: input.rawData,
        maxBytes: config.safeDetailBytes
    });
}

function readShellyIngressGateConfig(): ShellyIngressGateConfig {
    return {
        enabled: tuning.deviceIngress.enabled,
        enforcementMode: tuning.deviceIngress.enforcementMode,
        waitingRoomEnabled: tuning.deviceIngress.waitingRoomEnabled,
        allowPlainWs: tuning.deviceIngress.allowPlainWs,
        defaultOrganizationId: tuning.deviceIngress.defaultOrganizationId,
        mtlsEnabled: tuning.deviceIngress.mtlsEnabled,
        maxPayloadBytes: tuning.deviceIngress.maxPayloadBytes,
        maxConnectionsPerIdentity:
            tuning.deviceIngress.maxConnectionsPerIdentity,
        maxConnectionsPerOrg: tuning.deviceIngress.maxConnectionsPerOrg,
        maxConnectionsPerIp: tuning.deviceIngress.maxConnectionsPerIp,
        handshakesPerIpPerMinute: tuning.deviceIngress.handshakesPerIpPerMinute,
        reconnectIpKeyMax: tuning.deviceIngress.reconnectIpKeyMax,
        reconnectIpWindowMs: tuning.deviceIngress.reconnectIpWindowMs,
        reconnectIpMaxPerWindow: tuning.deviceIngress.reconnectIpMaxPerWindow,
        reconnectIpBlockMs: tuning.deviceIngress.reconnectIpBlockMs,
        handshakesPerOrgPerMinute:
            tuning.deviceIngress.handshakesPerOrgPerMinute,
        handshakesPerIdentityPerMinute:
            tuning.deviceIngress.handshakesPerIdentityPerMinute,
        trustedCertFingerprintHeader:
            tuning.deviceIngress.trustedCertFingerprintHeader,
        trustedCertPemHeader: tuning.deviceIngress.trustedCertPemHeader,
        trustedProxyCidrs: tuning.deviceIngress.trustedProxyCidrs,
        safeDetailBytes: tuning.deviceIngress.rejectionDetailMaxBytes
    };
}
