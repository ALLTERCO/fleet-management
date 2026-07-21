import type {IncomingMessage} from 'node:http';
import log4js from 'log4js';
import type WebSocket from 'ws';
import {tuning} from '../../../../config/tuning';
import ShellyDeviceFactory from '../../../../model/ShellyDeviceFactory';
import WebSocketTransport from '../../../../model/transport/WebsocketTransport';
import * as AuditLogger from '../../../../modules/AuditLogger';
import * as DeviceCollector from '../../../../modules/DeviceCollector';
import {
    claimDeviceRuntimeOwnership,
    releaseDeviceRuntimeOwnership
} from '../../../../modules/deviceIdentityRuntime';
import {markConnectionDisconnected} from '../../../../modules/deviceIngress/deviceIngressRepository';
import {
    dropGatheredData,
    gatherDeviceDataOnce,
    takeGatheredData
} from '../../../../modules/deviceIngress/gatheredDeviceData';
import {
    ingressClosed,
    ingressConnect,
    ingressDropped,
    ingressStage
} from '../../../../modules/deviceIngress/ingressTrace';
import {recordMessageRateLimited} from '../../../../modules/deviceIngress/metrics';
import {
    runBoundedGather,
    runBoundedProbe
} from '../../../../modules/deviceIngress/probeConcurrency';
import {
    registerWaitingRoomProbe,
    unregisterWaitingRoomProbe,
    type WaitingRoomProbeRegistration
} from '../../../../modules/deviceIngress/waitingRoomProbeRegistry';
import {enrichOpenWaitingRoomSnapshot} from '../../../../modules/deviceIngress/waitingRoomSnapshotEnrichment';
import * as Observability from '../../../../modules/Observability';
import {
    keepWaitingEntryOnDisconnect,
    wakeupPeriodFromStatus
} from '../../../../modules/redis/waitingTtl';
import {statusSelectivePush} from '../../../../modules/ShellyMessageHandler';
import {sendRpcOverDeviceSocket} from '../../../../modules/util/deviceSocketRpc';
import {guardListener} from '../../../../modules/util/faultGuard';
import * as WaitingRoom from '../../../../modules/WaitingRoom';
import {DeviceInitFailureTracker} from '../../../../modules/WaitingRoom/DeviceInitFailureTracker';
import {gatelessDeviceOrg} from '../../../../modules/WaitingRoom/defaultOrg';
import {
    dropPending,
    heartbeatPending,
    isRejected,
    type PendingDevice,
    recordPending,
    type WaitingAuthMethod
} from '../../../../modules/WaitingRoom/redisWaitingStore';
import {sanitizeStatus} from '../../../../modules/WaitingRoom/sanitize';
import {execInternal} from '../../../Commander';
import {
    CLOSE_DEVICE_INVALID_FRAME,
    CLOSE_DEVICE_INVALID_INIT,
    CLOSE_TRY_AGAIN_LATER
} from '../closeCodes';
import AbstractWebsocketHandler from './AbstractWebsocketHandler';
import {acquireClusterInitSlot, releaseClusterSlot} from './clusterInitSlot';
import {
    INIT_QUEUE_STALE_REASON,
    INIT_SLOT_RECLAIMED_REASON,
    InitSlotRegistry,
    type SlotHandle
} from './initSlotRegistry';
import {
    type AdmissionDeps,
    performAdmittedRegistration
} from './shellyAdmissionFlow';
import {
    evaluateShellyIngressGate,
    unregisterShellyIngressConnection
} from './shellyIngressGate';
import {
    hashRemoteAddress,
    recordShellyIngressAccepted,
    recordShellyIngressQueued,
    recordShellyIngressRejected
} from './shellyIngressRecorder';
import {type InitMessage, isInitMessage} from './shellyInitMessage';
import {clientAddress} from './shellyProxyTrust';

const logger = log4js.getLogger('shelly-ws');

// Thrown so auto-admit aborts DB intent consume + audit (WS already closed by caller).
export class ApproveRejectedError extends Error {
    constructor(
        public readonly shellyID: string,
        public readonly reason: string
    ) {
        super(`approve rejected for ${shellyID}: ${reason}`);
        this.name = 'ApproveRejectedError';
    }
}

// Init concurrency limiter. Lifecycle-tracked so a hung init is reclaimed by
// the watchdog rather than leaking its slot (see initSlotRegistry.ts).
const initSlotRegistry = new InitSlotRegistry(
    {
        maxConcurrent: tuning.rpc.maxConcurrentInits,
        queueMax: tuning.device.initQueueMax,
        queueHighWaterPct: tuning.device.initQueueHighWaterPct,
        queueMaxWaitMs: tuning.device.initQueueMaxWaitMs,
        maxHoldMs: tuning.device.initSlotMaxHoldMs
    },
    {
        now: () => Date.now(),
        metrics: {
            incrementCounter: (name, delta) =>
                Observability.incrementCounter(name, delta),
            incrementLabeledCounter: (name, labels) =>
                Observability.incrementLabeledCounter(name, labels),
            setGauge: (name, value) => Observability.setGauge(name, value)
        },
        log: (message) => logger.error(message)
    }
);

const initSlotWatchdog = setInterval(
    () => initSlotRegistry.sweep(),
    tuning.device.initSlotWatchdogIntervalMs
);
initSlotWatchdog.unref?.();

// Refuses devices whose previous init failed or ran too slow, so a small
// batch of unreachable devices cannot saturate the init slots.
export const deviceInitFailureTracker = new DeviceInitFailureTracker({
    maxKeys: tuning.device.initFailureTrackerMaxKeys,
    cooldownLadderMs: tuning.device.initFailureCooldownLadderMs,
    stableConnectionMs: tuning.device.initFailureStableMs
});

interface AdmissionContext {
    session: SessionState;
    shellyID: string;
    message: InitMessage;
    handle: SlotHandle;
}

export function getInitStats() {
    return initSlotRegistry.stats();
}

// A successful init taking longer than 3/4 of the probe timeout indicates
// the device was on the edge of failing — count it as a failure so the
// cooldown ladder catches flapping devices.
function isInitDurationSlow(durationMs: number): boolean {
    return durationMs >= (tuning.rpc.initProbeTimeoutMs * 3) / 4;
}

function recordInitOutcome(shellyID: string, durationMs: number): void {
    if (isInitDurationSlow(durationMs)) {
        deviceInitFailureTracker.recordFailure(shellyID);
        Observability.incrementCounter('device_inits_slow_call_counted');
        return;
    }
    deviceInitFailureTracker.recordSuccess(shellyID);
    Observability.incrementCounter('device_inits_succeeded');
}

// On reclaim, close the socket so the orphaned init's pending RPCs reject at
// once (the transport rejects them on close). Returns a detach for the
// normal path.
export function closeSocketOnReclaim(
    ws: WebSocket,
    signal: AbortSignal
): () => void {
    const onReclaim = (): void => {
        if (ws.readyState === ws.OPEN) {
            ws.close(CLOSE_TRY_AGAIN_LATER, INIT_SLOT_RECLAIMED_REASON);
        }
    };
    signal.addEventListener('abort', onReclaim, {once: true});
    return () => signal.removeEventListener('abort', onReclaim);
}

const UNSET_WS_CONFIG = JSON.stringify({
    id: 998,
    method: 'WS.SetConfig',
    params: {
        config: {
            server: '#',
            enable: false
        }
    }
});

const REBOOT_SHELLY = JSON.stringify({
    id: 999,
    method: 'Shelly.Reboot'
});

const defaultAdmissionDeps: AdmissionDeps = {
    buildTransport: (ws) => new WebSocketTransport(ws),
    factory: ShellyDeviceFactory,
    takeGatheredData,
    deviceCollector: DeviceCollector,
    auditLogger: AuditLogger,
    observability: Observability,
    statusSelectivePush,
    claimRuntimeOwnership: claimDeviceRuntimeOwnership,
    releaseRuntimeOwnership: releaseDeviceRuntimeOwnership,
    logger
};

export type ShellyWebsocketHandlerDeps = {
    execInternal?: typeof execInternal;
    admission?: AdmissionDeps;
    evaluateIngressGate?: typeof evaluateShellyIngressGate;
};

interface SessionState {
    ws: WebSocket;
    request: IncomingMessage;
    // Per-connection only: this socket has finished its init hello. Not
    // "trusted" (allowed past the waiting room) and not "seen before"
    // (device history). See docs/architecture/waiting-room-and-device-admission.
    identified: boolean;
    listener: (rawData: WebSocket.RawData) => void;
    ingressConnectionId: string | null;
    ingressOrganizationId: string | null;
    ingressWaitingRoomRecorded: boolean;
    ingressWaitingRoomProbe: WaitingRoomProbeRegistration | null;
    waitingStoreKey: {organizationId: string; shellyID: string} | null;
    // Sleeper wake interval (sec) if this device sleeps — keep its entry on close.
    waitingStoreWakeupSec: number | undefined;
    waitingStoreHeartbeat: (() => void) | null;
    admissionPromise: Promise<void> | null;
    // Built for the gather, reused at accept — one parser per socket.
    transport: WebSocketTransport | null;
    rateWindowStartedAt: number;
    rateWindowMessages: number;
    rateListener: (rawData: WebSocket.RawData) => void;
}

interface AdmissionRequest {
    session: SessionState;
    shellyID: string;
    initialStatus: unknown;
    callbacks: {
        onApprove: (intent?: WaitingRoom.AdmissionIntent) => Promise<void>;
        onDeny: () => void;
        onEvict: () => void;
        onQuarantine: () => void;
    };
    needsFullStatus: boolean;
}

function parseInitMessage(rawData: WebSocket.RawData): unknown | null {
    try {
        return JSON.parse(rawDataBuffer(rawData).toString('utf-8'));
    } catch {
        return null;
    }
}

function rawDataBuffer(rawData: WebSocket.RawData): Buffer {
    if (Buffer.isBuffer(rawData)) return rawData;
    if (Array.isArray(rawData)) return Buffer.concat(rawData);
    return Buffer.from(rawData);
}

function closeReason(code: number, reason: Buffer): string {
    const text = reason.toString('utf8').trim();
    return text ? `${code}:${text}` : `${code}`;
}

function isWellFormedShellyFrame(message: unknown): message is {
    method: string;
    src: string;
    params?: unknown;
} {
    return (
        typeof message === 'object' &&
        message !== null &&
        typeof (message as any).method === 'string' &&
        typeof (message as any).src === 'string'
    );
}

// A reply to FM's read-only discovery probe (sendRpcOverDeviceSocket) rides the
// same socket and can arrive before the device is marked identified. Its own
// listener consumes it, so skip it here instead of closing the socket. The id
// must be in FM's reserved request range so a malformed frame still gets closed.
const FM_RPC_ID_MIN = 0x40000000;
const FM_RPC_ID_MAX = 0x7ffffffe;
function isRpcResponseFrame(message: unknown): boolean {
    if (typeof message !== 'object' || message === null) return false;
    const frame = message as Record<string, unknown>;
    return (
        typeof frame.id === 'number' &&
        frame.id >= FM_RPC_ID_MIN &&
        frame.id <= FM_RPC_ID_MAX &&
        typeof frame.method !== 'string' &&
        ('result' in frame || 'error' in frame)
    );
}

function admissionQueue(
    request: AdmissionRequest
): Promise<WaitingRoom.AdmissionResult> {
    const input = {
        shellyID: request.shellyID,
        onApprove: request.callbacks.onApprove,
        onDeny: request.callbacks.onDeny,
        onEvict: request.callbacks.onEvict,
        onQuarantine: request.callbacks.onQuarantine
    };
    return request.session.ingressWaitingRoomRecorded
        ? WaitingRoom.queueDevice(input)
        : WaitingRoom.addDevice(
              input.shellyID,
              input.onApprove,
              input.onDeny,
              input.onEvict,
              input.onQuarantine
          );
}

export default class ShellyWebsocketHandler extends AbstractWebsocketHandler {
    readonly #execInternal: typeof execInternal;
    readonly #admissionDeps: AdmissionDeps;
    readonly #evaluateIngressGate: typeof evaluateShellyIngressGate;

    constructor(deps: ShellyWebsocketHandlerDeps = {}) {
        super();
        this.#execInternal = deps.execInternal ?? execInternal;
        this.#admissionDeps = deps.admission ?? defaultAdmissionDeps;
        this.#evaluateIngressGate =
            deps.evaluateIngressGate ?? evaluateShellyIngressGate;
    }

    protected override _handleWebsocket(
        ws: WebSocket,
        request: IncomingMessage
    ): void {
        const session: SessionState = {
            ws,
            request,
            identified: false,
            listener: () => {},
            ingressConnectionId: null,
            ingressOrganizationId: null,
            ingressWaitingRoomRecorded: false,
            ingressWaitingRoomProbe: null,
            waitingStoreKey: null,
            waitingStoreWakeupSec: undefined,
            waitingStoreHeartbeat: null,
            admissionPromise: null,
            transport: null,
            rateWindowStartedAt: Date.now(),
            rateWindowMessages: 0,
            rateListener: () => {}
        };
        session.rateListener = guardListener('shelly-rate', () =>
            this.#recordMessageRate(session)
        );
        ws.on('message', session.rateListener);
        session.listener = (rawData) => {
            void this.#onMessage(session, rawData).catch((err) =>
                this.#onMessageError(session, err)
            );
        };
        ws.on('message', session.listener);
        ws.once('close', (code, reason) =>
            this.#onSocketClose(session, code, reason)
        );
    }

    #onMessageError(session: SessionState, err: unknown): void {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof ApproveRejectedError) {
            logger.warn('Shelly admission rejected: %s', message);
            return;
        }
        logger.error('Unhandled Shelly websocket message error: %s', message);
        if (session.ws.readyState === session.ws.OPEN) {
            session.ws.close(CLOSE_TRY_AGAIN_LATER, 'message_handler_error');
        }
    }

    #recordMessageRate(session: SessionState): void {
        const now = Date.now();
        if (now - session.rateWindowStartedAt >= 60_000) {
            session.rateWindowStartedAt = now;
            session.rateWindowMessages = 0;
        }
        session.rateWindowMessages++;
        if (
            session.rateWindowMessages <=
            tuning.deviceIngress.maxMessagesPerMinute
        ) {
            return;
        }
        const reason = 'message_rate_limited';
        recordMessageRateLimited();
        void this.#markRateLimitedConnection(session, reason);
        if (session.ws.readyState === session.ws.OPEN) {
            session.ws.close(1008, reason);
        }
    }

    async #markRateLimitedConnection(
        session: SessionState,
        reason: string
    ): Promise<void> {
        if (!session.ingressConnectionId || !session.ingressOrganizationId) {
            return;
        }
        try {
            await markConnectionDisconnected({
                organizationId: session.ingressOrganizationId,
                id: session.ingressConnectionId,
                reason
            });
        } catch (err) {
            logger.warn(
                'failed to mark ingress connection rate-limited: %s',
                err
            );
        }
    }

    async #onMessage(
        session: SessionState,
        rawData: WebSocket.RawData
    ): Promise<void> {
        // Once identified, the device's RPC handler owns subsequent frames.
        if (session.identified) return;

        const parsed = parseInitMessage(rawData);
        if (parsed === null) {
            logger.warn('Cannot parse message on /shelly');
            session.ws.close(CLOSE_DEVICE_INVALID_INIT);
            return;
        }
        if (!isWellFormedShellyFrame(parsed)) {
            if (isRpcResponseFrame(parsed)) return;
            logger.warn(
                'bad message on /shelly msg:[%s]',
                JSON.stringify(parsed)
            );
            session.ws.close(CLOSE_DEVICE_INVALID_FRAME);
            return;
        }

        Observability.recordWsMessage(`device:${parsed.method}`);
        if (!isInitMessage(parsed)) return;

        await this.#handleInitMessage(session, parsed, rawDataBuffer(rawData));
    }

    async #handleInitMessage(
        session: SessionState,
        message: InitMessage,
        rawData: Buffer
    ): Promise<void> {
        if (session.admissionPromise) {
            await session.admissionPromise;
            return;
        }
        // Shelly can send NotifyStatus and NotifyFullStatus together.
        session.admissionPromise = this.#admitInitFrame(
            session,
            message,
            rawData
        );
        await session.admissionPromise;
    }

    async #admitInitFrame(
        session: SessionState,
        parsed: InitMessage,
        rawData: Buffer
    ): Promise<void> {
        // First init frame — the device has identified itself. Start its trace.
        ingressConnect(parsed.src);
        const ingress = await this.#evaluateIngress(session, parsed, rawData);
        if (ingress === 'rejected') return;

        session.identified = true;
        await this.#admitDevice(session, parsed);
    }

    #onSocketClose(session: SessionState, code: number, reason: Buffer): void {
        session.ws.removeListener('message', session.rateListener);
        if (session.ingressWaitingRoomProbe) {
            unregisterWaitingRoomProbe(session.ingressWaitingRoomProbe);
        }
        this.#dropWaitingStoreEntry(session);
        if (!session.ingressConnectionId) return;
        void this.#markIngressSocketClosed(session, code, reason);
        unregisterShellyIngressConnection(session.ingressConnectionId);
    }

    #dropWaitingStoreEntry(session: SessionState): void {
        if (session.waitingStoreHeartbeat) {
            session.ws.removeListener('pong', session.waitingStoreHeartbeat);
            session.waitingStoreHeartbeat = null;
        }
        const key = session.waitingStoreKey;
        if (!key) return;
        session.waitingStoreKey = null;
        // Socket gone — free the trace clock; a reconnect starts a fresh one.
        ingressClosed(key.shellyID);
        // Free pre-warmed discovery if the device left unaccepted; the
        // transport self-tears-down on ws close.
        dropGatheredData(key.shellyID);
        // A sleeper reports then disconnects to sleep — keep its entry so it
        // survives the sleep cycle; its extended TTL evicts it if it never
        // returns. Always-on devices are dropped immediately.
        if (keepWaitingEntryOnDisconnect(session.waitingStoreWakeupSec)) return;
        void dropPending(key.organizationId, key.shellyID).catch((err) =>
            logger.warn(
                'Waiting store drop failed for %s: %s',
                key.shellyID,
                err
            )
        );
    }

    async #markIngressSocketClosed(
        session: SessionState,
        code: number,
        reason: Buffer
    ): Promise<void> {
        if (!session.ingressConnectionId || !session.ingressOrganizationId) {
            return;
        }
        try {
            await markConnectionDisconnected({
                organizationId: session.ingressOrganizationId,
                id: session.ingressConnectionId,
                reason: closeReason(code, reason)
            });
        } catch (err) {
            logger.warn('failed to mark ingress connection closed: %s', err);
        }
    }

    async #evaluateIngress(
        session: SessionState,
        message: InitMessage,
        rawData: Buffer
    ): Promise<'continue' | 'rejected'> {
        const decision = await this.#evaluateIngressGate({
            request: session.request,
            rawData,
            reportedExternalId: message.src,
            closeConnection: (reason) => {
                if (session.ws.readyState === session.ws.OPEN) {
                    session.ws.close(1008, reason);
                }
            }
        });
        if (decision.action === 'trusted') {
            session.ingressConnectionId = decision.connectionId;
            session.ingressOrganizationId = decision.context.organizationId;
            ingressStage(message.src, 'handshake:trusted');
            return 'continue';
        }
        if (decision.action === 'waiting_room') {
            if (await this.#inRejectCooldown(decision, message.src)) {
                ingressDropped(message.src, 'reject_cooldown');
                this.#closeRejected(session, 'reject_cooldown');
                return 'rejected';
            }
            const recorded = await this.#recordWaitingStoreEntry(
                session,
                decision,
                message.src
            );
            if (!recorded) {
                ingressDropped(message.src, 'waiting_room_full');
                this.#closeRejected(session, 'waiting_room_full');
                return 'rejected';
            }
            session.ingressWaitingRoomRecorded = true;
            ingressStage(message.src, 'waiting-room');
            this.#beginWaitingRoomProbe(session, decision, message.src);
            return 'continue';
        }
        if (decision.action === 'record_only') {
            // The legacy path skips the gate, so it pays the same
            // cluster-wide per-IP handshake budget the gate enforces.
            if (!(await legacyIpHandshakeAllowed(session.request))) {
                Observability.incrementCounter(
                    'shelly_legacy_ip_handshake_limited'
                );
                ingressDropped(message.src, 'rate_limit_exceeded');
                this.#closeRejected(session, 'rate_limit_exceeded');
                return 'rejected';
            }
            // Legacy pre-gate admit — no handshake/waiting-room, so mark it here.
            ingressStage(message.src, 'handshake:record_only');
            return 'continue';
        }

        ingressStage(message.src, 'handshake:rejected', decision.reasonCode);
        this.#closeRejected(session, decision.reasonCode);
        return 'rejected';
    }

    async #inRejectCooldown(
        decision: {organizationId: string | null},
        shellyID: string
    ): Promise<boolean> {
        const {organizationId} = decision;
        if (!organizationId) return false;
        try {
            return await isRejected(organizationId, shellyID);
        } catch (err) {
            logger.warn(
                'Reject-cooldown check failed for %s: %s',
                shellyID,
                err
            );
            return false;
        }
    }

    // Legacy path: cooldown keyed by the configured default org.
    async #legacyInRejectCooldown(shellyID: string): Promise<boolean> {
        const organizationId = gatelessDeviceOrg() ?? '';
        return this.#inRejectCooldown({organizationId}, shellyID);
    }

    #closeRejected(session: SessionState, reason: string): void {
        session.ws.removeListener('message', session.listener);
        if (session.ws.readyState === session.ws.OPEN) {
            session.ws.close(1008, reason);
        }
    }

    // Bring a waiting device's probe online: register the operator handle
    // (cleared in #onSocketClose) and take the initial read-only snapshot that
    // fills the card. The single enrichment path for gate and legacy admits.
    #beginWaitingRoomProbe(
        session: SessionState,
        decision: {organizationId: string | null},
        reportedExternalId: string
    ): void {
        const {organizationId} = decision;
        if (!organizationId) return;
        const registration: WaitingRoomProbeRegistration = {
            organizationId,
            reportedExternalId,
            probe: {
                sendRpc: (method) =>
                    sendRpcOverDeviceSocket(session.ws, {
                        method,
                        label: reportedExternalId,
                        timeoutMs: tuning.waitingRoom.enrichTimeoutMs
                    })
            }
        };
        registerWaitingRoomProbe(registration);
        session.ingressWaitingRoomProbe = registration;
        // Bounded so a mass arrival can't fan out into unbounded parallel probes.
        void runBoundedProbe(async () => {
            await enrichOpenWaitingRoomSnapshot({
                organizationId,
                reportedExternalId,
                probe: registration.probe
            });
        }).catch((err) => {
            logger.warn(
                'Waiting Room ingress enrichment failed for %s: %s',
                reportedExternalId,
                err
            );
        });
        // Pre-warm full discovery in the background for a faster accept.
        this.#beginDeviceGather(session, reportedExternalId);
    }

    // One transport per connection (reused at accept); own budget; best-effort.
    #beginDeviceGather(session: SessionState, shellyID: string): void {
        if (session.transport === null) {
            session.transport = new WebSocketTransport(session.ws);
        }
        const transport = session.transport;
        const startedAt = Date.now();
        void runBoundedGather(async () => {
            const bundle = await gatherDeviceDataOnce(shellyID, () =>
                ShellyDeviceFactory.gatherDeviceData(transport)
            );
            ingressStage(
                shellyID,
                'gather-done',
                `${Date.now() - startedAt}ms gather, ${bundle.componentPages ?? 0} pages`
            );
        }).catch((err) => {
            logger.debug(
                'Waiting Room gather failed for %s: %s',
                shellyID,
                err
            );
        });
    }

    // Returns false when the org is at its size cap (the entry was refused).
    async #recordWaitingStoreEntry(
        session: SessionState,
        decision: {
            organizationId: string | null;
            authMethod: WaitingAuthMethod;
            status: Record<string, unknown>;
        },
        shellyID: string
    ): Promise<boolean> {
        const {organizationId} = decision;
        if (!organizationId) return true;
        return this.#trackWaitingStoreEntry(session, {
            shellyID,
            organizationId,
            authMethod: decision.authMethod,
            status: 'queued',
            jdoc: decision.status
        });
    }

    async #trackWaitingStoreEntry(
        session: SessionState,
        entry: PendingDevice
    ): Promise<boolean> {
        const recorded = await recordPending(entry);
        if (!recorded) return false;
        session.waitingStoreKey = {
            organizationId: entry.organizationId,
            shellyID: entry.shellyID
        };
        session.waitingStoreWakeupSec = wakeupPeriodFromStatus(entry.jdoc);
        session.waitingStoreHeartbeat = () => {
            void heartbeatPending(entry.organizationId, entry.shellyID).catch(
                (err) =>
                    logger.warn(
                        'Waiting store heartbeat failed for %s: %s',
                        entry.shellyID,
                        err
                    )
            );
        };
        session.ws.on('pong', session.waitingStoreHeartbeat);
        return true;
    }

    // Legacy in-memory queue path: no gate identity, so authMethod is none
    // and the org is the configured default.
    async #recordLegacyWaitingStoreEntry(
        request: AdmissionRequest
    ): Promise<void> {
        const organizationId = gatelessDeviceOrg();
        if (!organizationId) {
            // No org to file the entry under means no operator can ever see
            // or admit this device — say so instead of dropping it silently.
            logger.warn(
                'Waiting Room cannot list device %s: FM_DEVICE_INGRESS_DEFAULT_ORGANIZATION_ID is empty',
                request.shellyID
            );
            return;
        }
        try {
            await this.#trackWaitingStoreEntry(request.session, {
                shellyID: request.shellyID,
                organizationId,
                authMethod: 'none',
                status: 'queued',
                jdoc: sanitizeStatus(request.initialStatus)
            });
        } catch (err) {
            logger.warn(
                'Waiting store record failed for %s: %s',
                request.shellyID,
                err
            );
        }
    }

    async #admitDevice(
        session: SessionState,
        message: InitMessage
    ): Promise<void> {
        const shellyID = message.src;
        const initialStatus =
            message.method === 'NotifyFullStatus' ? message.params : null;

        const callbacks = {
            onApprove: (intent?: WaitingRoom.AdmissionIntent) =>
                this.#onApprove(session, shellyID, message, intent),
            onDeny: () => this.#onDeny(session, shellyID),
            onEvict: () => this.#onEvict(session, shellyID),
            onQuarantine: () => this.#onQuarantine(session, shellyID)
        };

        if (session.ingressConnectionId) {
            await this.#onApprove(session, shellyID, message, {
                organization_id: session.ingressOrganizationId ?? '',
                group_id: null
            });
            return;
        }
        // Register pendingDevices so accept admits the live socket.
        if (session.ingressWaitingRoomRecorded) {
            this.#requestAdmission({
                session,
                shellyID,
                initialStatus,
                callbacks,
                needsFullStatus: initialStatus === null
            });
            return;
        }

        if (await this.#legacyInRejectCooldown(shellyID)) {
            ingressDropped(shellyID, 'reject_cooldown');
            this.#closeRejected(session, 'reject_cooldown');
            return;
        }

        const config = await this.#loadWaitingRoomConfig(shellyID);
        if (config === null) {
            // Fail-closed: WaitingRoom config unreadable. Close with 1013
            // so the device backs off + retries; do NOT silently admit.
            logger.warn(
                'WaitingRoom config unavailable — refusing %s for retry',
                shellyID
            );
            ingressDropped(shellyID, 'waiting_room_config_unavailable');
            session.ws.close(
                CLOSE_TRY_AGAIN_LATER,
                'waiting_room_config_unavailable'
            );
            return;
        }
        if (
            !session.ingressWaitingRoomRecorded &&
            typeof config.enable === 'boolean' &&
            !config.enable
        ) {
            void callbacks
                .onApprove()
                .catch((err) =>
                    logger.error('onApprove failed for %s: %s', shellyID, err)
                );
            return;
        }

        // GetStatus only needed when the init was a NotifyStatus (Wall Display);
        // NotifyFullStatus already carries the full snapshot.
        const needsFullStatus = initialStatus === null;
        this.#requestAdmission({
            session,
            shellyID,
            initialStatus,
            callbacks,
            needsFullStatus
        });
    }

    async #loadWaitingRoomConfig(
        shellyID: string
    ): Promise<Record<string, any> | null> {
        try {
            return await this.#execInternal('WaitingRoom.GetConfig');
        } catch (err) {
            // null → caller fails-closed (refuse upgrade with 1013 retry).
            Observability.incrementCounter('waiting_room_config_errors');
            logger.error(
                'WaitingRoom.GetConfig failed for %s: %s',
                shellyID,
                err
            );
            return null;
        }
    }

    #requestAdmission(request: AdmissionRequest): void {
        admissionQueue(request)
            .then(async (admission) => {
                if (admission.status === 'rate_limited') {
                    logger.warn(
                        'Closing throttled Waiting Room socket for %s retryAfterMs=%d',
                        request.shellyID,
                        admission.retryAfterMs
                    );
                    void recordIngressRejectedSafe({
                        shellyID: request.shellyID,
                        reasonCode: 'rate_limit_exceeded',
                        detail: {retryAfterMs: admission.retryAfterMs}
                    });
                    request.session.ws.close(
                        CLOSE_TRY_AGAIN_LATER,
                        'waiting_room_reconnect_limited'
                    );
                    return;
                }
                if (
                    admission.status !== 'queued' ||
                    request.session.ws.readyState !== request.session.ws.OPEN
                )
                    return;
                request.session.ws.once('close', () => {
                    WaitingRoom.dropPendingDevice(request.shellyID);
                });
                // Legacy path records + enriches; ingress already did.
                if (request.session.ingressWaitingRoomRecorded) return;
                void recordQueuedSafe({
                    shellyID: request.shellyID,
                    detail: {needsFullStatus: request.needsFullStatus}
                });
                // Await the record before enriching so the probe's merge lands
                // on a present entry — same ordering as the gate path.
                await this.#recordLegacyWaitingStoreEntry(request);
                this.#beginWaitingRoomProbe(
                    request.session,
                    {organizationId: gatelessDeviceOrg()},
                    request.shellyID
                );
                return;
            })
            .catch((err) => {
                logger.warn(
                    'Waiting Room enrichment failed for %s: %s',
                    request.shellyID,
                    err
                );
            });
    }

    async #onApprove(
        session: SessionState,
        shellyID: string,
        message: InitMessage,
        intent?: WaitingRoom.AdmissionIntent
    ): Promise<void> {
        try {
            this.#refuseIfClosed(session, shellyID);
            this.#refuseIfInCooldown(session, shellyID);
            const handle = await this.#waitForLocalSlot(session, shellyID);
            // Slot in hand — time up to here is init-queue wait, not build work.
            ingressStage(shellyID, 'slot-acquired');
            const detachReclaim = closeSocketOnReclaim(
                session.ws,
                handle.signal
            );
            try {
                await this.#runAdmittedRegistration({
                    session,
                    shellyID,
                    message,
                    handle
                });
                if (!session.ingressConnectionId) {
                    void recordIngressAcceptedSafe({shellyID, intent});
                }
            } finally {
                detachReclaim();
                initSlotRegistry.release(handle);
            }
        } catch (err) {
            // Dropped after accept/trust — the queue, cooldown, or a closed
            // socket stopped it before it went live.
            const reasonCode = reasonCodeForApproveError(err);
            ingressDropped(shellyID, reasonCode);
            void recordIngressRejectedSafe({
                shellyID,
                intent,
                reasonCode,
                detail: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
    }

    #refuseIfClosed(session: SessionState, shellyID: string): void {
        if (session.ws.readyState === session.ws.OPEN) return;
        throw new ApproveRejectedError(shellyID, 'socket_already_closed');
    }

    #refuseIfInCooldown(session: SessionState, shellyID: string): void {
        const gate = deviceInitFailureTracker.check(shellyID);
        if (gate.allowed) return;
        Observability.incrementCounter('device_inits_cooldown_rejected');
        session.ws.close(CLOSE_TRY_AGAIN_LATER, 'init_cooldown');
        throw new ApproveRejectedError(shellyID, 'init_cooldown');
    }

    async #waitForLocalSlot(
        session: SessionState,
        shellyID: string
    ): Promise<SlotHandle> {
        const acquiring = initSlotRegistry.acquire(shellyID);
        if (acquiring === null) {
            session.ws.close(CLOSE_TRY_AGAIN_LATER, 'init_queue_full');
            throw new ApproveRejectedError(shellyID, 'init_queue_full');
        }
        let handle: SlotHandle;
        try {
            handle = await acquiring;
        } catch (err) {
            // The slot wait was pruned for sitting in the queue too long.
            if (
                err instanceof Error &&
                err.message === INIT_QUEUE_STALE_REASON
            ) {
                if (session.ws.readyState === session.ws.OPEN) {
                    session.ws.close(
                        CLOSE_TRY_AGAIN_LATER,
                        INIT_QUEUE_STALE_REASON
                    );
                }
                throw new ApproveRejectedError(
                    shellyID,
                    INIT_QUEUE_STALE_REASON
                );
            }
            throw err;
        }
        if (session.ws.readyState === session.ws.OPEN) return handle;
        // Socket died while we waited — give the slot straight back.
        initSlotRegistry.release(handle);
        throw new ApproveRejectedError(shellyID, 'socket_closed_after_queue');
    }

    async #runAdmittedRegistration(ctx: AdmissionContext): Promise<void> {
        const clusterSlot = await acquireClusterInitSlot();
        if (!clusterSlot.ok) {
            Observability.incrementCounter('cluster_inits_full');
            ctx.session.ws.close(CLOSE_TRY_AGAIN_LATER, 'cluster_inits_full');
            throw new ApproveRejectedError(ctx.shellyID, 'cluster_inits_full');
        }
        if (ctx.session.ws.readyState !== ctx.session.ws.OPEN) {
            await releaseClusterSlot(clusterSlot);
            throw new ApproveRejectedError(
                ctx.shellyID,
                'socket_closed_after_cluster_wait'
            );
        }
        try {
            await this.#performAndRecord(ctx);
        } finally {
            await releaseClusterSlot(clusterSlot);
        }
    }

    async #performAndRecord(ctx: AdmissionContext): Promise<void> {
        const startMs = Date.now();
        try {
            ctx.session.listener &&
                ctx.session.ws.removeListener('message', ctx.session.listener);
            const registered = await performAdmittedRegistration(
                {
                    session: ctx.session,
                    admittedShellyID: ctx.shellyID,
                    message: ctx.message,
                    setStage: ctx.handle.setStage
                },
                this.#admissionDeps
            );
            if (!registered) {
                throw new ApproveRejectedError(ctx.shellyID, 'register_failed');
            }
        } catch (err) {
            deviceInitFailureTracker.recordFailure(ctx.shellyID);
            Observability.incrementCounter('device_inits_failed');
            throw err;
        }
        recordInitOutcome(ctx.shellyID, Date.now() - startMs);
    }

    // Polite close. DB DENIED state prevents re-entry; device flash
    // untouched. Reversible — admin can un-deny without site visit.
    #onDeny(session: SessionState, shellyID: string): void {
        session.ws.removeListener('message', session.listener);
        void recordIngressRejectedSafe({
            shellyID,
            reasonCode: 'identity_disabled',
            detail: 'wr_denied'
        });
        if (session.ws.readyState === session.ws.OPEN) {
            session.ws.close(1008, 'wr_denied');
        }
    }

    // TTL / capacity eviction. Same as onDeny — polite close.
    #onEvict(session: SessionState, shellyID: string): void {
        session.ws.removeListener('message', session.listener);
        void recordIngressRejectedSafe({
            shellyID,
            reasonCode: 'connection_cap_reached',
            detail: 'wr_evicted'
        });
        if (session.ws.readyState === session.ws.OPEN) {
            session.ws.close(1000, 'wr_evicted');
        }
    }

    // Destructive. Rewrites device WS config + reboots. Recovery requires
    // factory-reset on the device. Admin opt-in only.
    #onQuarantine(session: SessionState, shellyID: string): void {
        session.ws.removeListener('message', session.listener);
        if (session.ws.readyState !== session.ws.OPEN) {
            logger.warn(
                'Quarantine skipped — socket already closed for %s',
                shellyID
            );
            return;
        }
        void recordIngressRejectedSafe({
            shellyID,
            reasonCode: 'operator_quarantine',
            detail: 'wr_quarantined'
        });
        session.ws.send(UNSET_WS_CONFIG);
        session.ws.send(REBOOT_SHELLY);
        session.ws.close(1008, 'wr_quarantined');
    }
}

function reasonCodeForApproveError(
    err: unknown
): 'connection_cap_reached' | 'malformed_handshake' {
    if (!(err instanceof ApproveRejectedError)) return 'malformed_handshake';
    if (err.reason.includes('queue') || err.reason.includes('cluster')) {
        return 'connection_cap_reached';
    }
    return 'malformed_handshake';
}

async function recordIngressAcceptedSafe(
    input: Parameters<typeof recordShellyIngressAccepted>[0]
): Promise<void> {
    try {
        await recordShellyIngressAccepted(input);
    } catch (err) {
        logger.debug('device ingress accepted record failed: %s', err);
    }
}

async function recordIngressRejectedSafe(
    input: Parameters<typeof recordShellyIngressRejected>[0]
): Promise<void> {
    try {
        await recordShellyIngressRejected(input);
    } catch (err) {
        logger.debug('device ingress rejected record failed: %s', err);
    }
}

async function recordQueuedSafe(
    input: Parameters<typeof recordShellyIngressQueued>[0]
): Promise<void> {
    try {
        await recordShellyIngressQueued(input);
    } catch (err) {
        logger.debug('device ingress waiting-room record failed: %s', err);
    }
}

// Fail-open on Redis outage (consume default): an infra blip must not lock
// the fleet out; the per-instance AdmissionGate still bounds the burst.
// Exported for test: the per-IP throttle is a trust-boundary gate.
export async function legacyIpHandshakeAllowed(
    request: IncomingMessage
): Promise<boolean> {
    const hash = hashRemoteAddress(
        clientAddress(request, tuning.deviceIngress.trustedProxyCidrs)
    );
    // Lazy import keeps pure tests off the Redis barrel.
    const {rateLimiter} = await import('../../../../modules/redis/services.js');
    const perMinute = tuning.deviceIngress.handshakesPerIpPerMinute;
    return rateLimiter.consume(
        `device-ingress:ip:${hash ?? 'unknown'}`,
        perMinute,
        perMinute / 60
    );
}
