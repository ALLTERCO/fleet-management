// /shelly post-admission registration flow.
//
// The handler class owns WebSocket session lifecycle (open/close,
// admission, queue). This module owns what happens AFTER the
// WaitingRoom approves a device: build the device from the live
// socket, verify its self-reported identity matches the admitted id,
// then commit the registration and run post-register tasks.
//
// All side effects route through the `AdmissionDeps` object so the
// flow is unit-testable with spies — no DB, no transports, no real
// WebSockets in tests.

import type log4js from 'log4js';
import type WebSocket from 'ws';
import type ShellyDeviceType from '../../../../model/ShellyDevice';
import type ShellyDeviceFactory from '../../../../model/ShellyDeviceFactory';
import type {DeviceDataBundle} from '../../../../model/ShellyDeviceFactory';
import type WebSocketTransport from '../../../../model/transport/WebsocketTransport';
import type * as AuditLogger from '../../../../modules/AuditLogger';
import type * as DeviceCollector from '../../../../modules/DeviceCollector';
import {
    ingressDropped,
    ingressRegistered
} from '../../../../modules/deviceIngress/ingressTrace';
import {assessDeviceHealth} from '../../../../modules/deviceIngress/postAcceptHealth';
import type * as Observability from '../../../../modules/Observability';
import type {statusSelectivePush as StatusSelectivePush} from '../../../../modules/ShellyMessageHandler';
import type {ShellyMessageIncoming} from '../../../../types';
import {CLOSE_TRY_AGAIN_LATER} from '../closeCodes';
import {
    checkAdmittedIdentity,
    type IdentityMismatchError,
    identityMismatchAuditEntry
} from './admittedIdentity';
import type {InitStage} from './initSlotRegistry';
import {type InitMessage, initialStatusFor} from './shellyInitMessage';

export interface AdmissionSession {
    ws: WebSocket;
    // Reused from the waiting-room gather so the socket keeps one parser.
    transport?: InstanceType<typeof WebSocketTransport> | null;
}

export interface AdmissionDeps {
    buildTransport: (ws: WebSocket) => InstanceType<typeof WebSocketTransport>;
    factory: Pick<typeof ShellyDeviceFactory, 'fromWebsocket'> &
        Partial<Pick<typeof ShellyDeviceFactory, 'assembleFromGathered'>>;
    // Data gathered while the device waited, if any. Present → accept assembles
    // from it (no re-fetch); absent → build over the socket, as before.
    takeGatheredData?: (
        shellyID: string
    ) => Promise<DeviceDataBundle | undefined>;
    deviceCollector: Pick<typeof DeviceCollector, 'register'>;
    auditLogger: Pick<typeof AuditLogger, 'log'>;
    observability: Pick<
        typeof Observability,
        'incrementCounter' | 'recordInitDuration' | 'recordInitFailure'
    >;
    statusSelectivePush: typeof StatusSelectivePush;
    logger: log4js.Logger;
    claimRuntimeOwnership: (shellyID: string) => Promise<boolean>;
    releaseRuntimeOwnership: (shellyID: string) => Promise<void>;
}

export interface AdmittedRegistrationInput {
    session: AdmissionSession;
    admittedShellyID: string;
    message: InitMessage;
    // Marks init phase for the slot watchdog, so a reclaim names where it stuck.
    setStage?: (stage: InitStage) => void;
}

// Top-level error wrapper. Pure error handling — no business logic.
export async function performAdmittedRegistration(
    input: AdmittedRegistrationInput,
    deps: AdmissionDeps
): Promise<boolean> {
    let ownershipHeld = false;
    try {
        ownershipHeld = await deps.claimRuntimeOwnership(
            input.admittedShellyID
        );
        if (!ownershipHeld) {
            throw new Error('device connection is owned by another server');
        }
        const registered = await runRegistration(input, deps);
        if (!registered) {
            await deps.releaseRuntimeOwnership(input.admittedShellyID);
        }
        return registered;
    } catch (err) {
        if (ownershipHeld) {
            await deps.releaseRuntimeOwnership(input.admittedShellyID);
        }
        recordRegistrationFailure(input.admittedShellyID, err, deps);
        if (input.session.ws.readyState === input.session.ws.OPEN) {
            input.session.ws.close(CLOSE_TRY_AGAIN_LATER, 'register_failed');
        }
        return false;
    }
}

// Pure happy path: build, verify, commit, post-tasks. Identity mismatch
// is recovered inline (refuse helper handles it) so the outer catch
// only sees genuine failures.
async function runRegistration(
    input: AdmittedRegistrationInput,
    deps: AdmissionDeps
): Promise<boolean> {
    const {session, admittedShellyID, message} = input;
    const initStart = Date.now();
    const initialStatus = initialStatusFor(message);

    deps.logger.info(
        'Registering new websocket client for shellyID:[%s] (trigger: %s)',
        admittedShellyID,
        message.method
    );

    // Reuse the gather transport if any, else build one.
    const transport = session.transport ?? deps.buildTransport(session.ws);
    // Reuse the data gathered while the device waited, if any; otherwise gather
    // it now over the socket (a slow or early-accepted device just does it here).
    const gathered = await deps.takeGatheredData?.(admittedShellyID);
    // Reuse should dominate; a spike in fresh probes means accepts are
    // outrunning the gather.
    const reusedGather = Boolean(gathered && deps.factory.assembleFromGathered);
    deps.observability.incrementCounter(
        reusedGather
            ? 'device_accept_gather_reused'
            : 'device_accept_fresh_probe'
    );
    const shelly =
        gathered && deps.factory.assembleFromGathered
            ? await deps.factory.assembleFromGathered(transport, gathered)
            : await deps.factory.fromWebsocket(transport);

    const mismatch = checkAdmittedIdentity(admittedShellyID, shelly.shellyID);
    if (mismatch !== null) {
        await refuseIdentityMismatch({session, err: mismatch, shelly}, deps);
        return false;
    }

    commitRegistration(
        {shelly, initialStatus, admittedShellyID, initStart},
        deps
    );
    // Operational finish — device.list returns it, commands work now.
    ingressRegistered(
        admittedShellyID,
        `${reusedGather ? 'reused gather' : 'fresh probe'}, ${shelly.entities.length} entities`
    );
    input.setStage?.('post-register');
    await runPostRegisterTasks({shelly, message, initialStatus}, deps);
    return true;
}

function commitRegistration(
    input: {
        shelly: ShellyDeviceType;
        initialStatus: unknown;
        admittedShellyID: string;
        initStart: number;
    },
    deps: AdmissionDeps
): void {
    if (input.initialStatus) input.shelly.setStatus(input.initialStatus);
    deps.deviceCollector.register(input.shelly);
    deps.observability.recordInitDuration(
        input.admittedShellyID,
        Date.now() - input.initStart
    );
}

async function runPostRegisterTasks(
    input: {
        shelly: ShellyDeviceType;
        message: InitMessage;
        initialStatus: unknown;
    },
    deps: AdmissionDeps
): Promise<void> {
    if (input.initialStatus) {
        await pushInitialStatusSafe(input.shelly, input.message, deps);
    }
    enrichBTHomeSafe(input.shelly, deps);
    reportDeviceHealth(input.shelly, deps);
}

// Post-accept sanity — flag (never fail) a device that came up wrong.
function reportDeviceHealth(
    shelly: ShellyDeviceType,
    deps: AdmissionDeps
): void {
    const health = assessDeviceHealth(shelly.status, shelly.entities.length);
    if (health.ok) return;
    deps.observability.incrementCounter('device_post_accept_unhealthy');
    deps.logger.warn(
        'device %s came up with issues: %s',
        shelly.shellyID,
        health.issues.join('; ')
    );
}

async function pushInitialStatusSafe(
    shelly: ShellyDeviceType,
    message: InitMessage,
    deps: AdmissionDeps
): Promise<void> {
    // `statusSelectivePush` only reads `params` off the request, but the
    // canonical type requires `dst`. Build a faithful ShellyMessageIncoming
    // so the call site stays type-safe without an `as any` escape hatch.
    const req: ShellyMessageIncoming = {
        src: message.src,
        dst: message.dst ?? '',
        method: message.method,
        params: message.params
    };
    try {
        await deps.statusSelectivePush(req, shelly);
    } catch (err) {
        deps.logger.error('Status Selective push failed: %s', err);
    }
}

function enrichBTHomeSafe(shelly: ShellyDeviceType, deps: AdmissionDeps): void {
    // Best-effort post-register: surface failures at debug so the silent
    // .catch(() => {}) anti-pattern doesn't hide a degraded BTHome inventory.
    shelly.enrichBTHomeDeviceMeta().catch((err) => {
        deps.logger.debug('enrichBTHomeDeviceMeta failed: %s', err);
    });
}

// Admitted shellyID and the device's resolved info.id disagreed —
// close the socket, record the forensic trail, keep the impostor bytes
// out of DeviceCollector.
async function refuseIdentityMismatch(
    input: {
        session: AdmissionSession;
        err: IdentityMismatchError;
        shelly: ShellyDeviceType;
    },
    deps: AdmissionDeps
): Promise<void> {
    deps.observability.incrementCounter('device_identity_mismatch_total');
    ingressDropped(input.err.admittedShellyID, 'identity_mismatch');
    deps.logger.warn(
        'shelly identity mismatch — admitted=%s, registered=%s',
        input.err.admittedShellyID,
        input.err.registeredShellyID
    );
    await writeMismatchAudit(input.err, deps);
    tearDownImpostor(input.shelly, deps);
    if (input.session.ws.readyState === input.session.ws.OPEN) {
        input.session.ws.close(1008, 'identity_mismatch');
    }
}

async function writeMismatchAudit(
    err: IdentityMismatchError,
    deps: AdmissionDeps
): Promise<void> {
    try {
        await deps.auditLogger.log(
            identityMismatchAuditEntry({
                admittedShellyID: err.admittedShellyID,
                registeredShellyID: err.registeredShellyID
            })
        );
    } catch (auditErr) {
        deps.logger.error('identity-mismatch audit write failed: %s', auditErr);
    }
}

function tearDownImpostor(shelly: ShellyDeviceType, deps: AdmissionDeps): void {
    try {
        shelly.destroy({skipDeleteEvent: true});
    } catch (destroyErr) {
        deps.logger.warn(
            'shelly.destroy after identity mismatch failed: %s',
            destroyErr
        );
    }
}

function recordRegistrationFailure(
    admittedShellyID: string,
    err: unknown,
    deps: AdmissionDeps
): void {
    ingressDropped(admittedShellyID, 'register_failed');
    deps.logger.error(
        'Failed to register device shellyID:[%s]: %s',
        admittedShellyID,
        err
    );
}
