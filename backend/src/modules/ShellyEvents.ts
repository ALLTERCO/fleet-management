import {EventEmitter} from 'node:events';
import {getLogger} from 'log4js';
import {resolveBluDeviceInfo, resolveModelString} from '../config/BTHomeData';
import type AbstractDevice from '../model/AbstractDevice';
import * as AuditLogger from '../modules/AuditLogger';
import {boundedLogDedupeSet} from '../modules/boundedLogDedupeSet';
import * as EventDistributor from '../modules/EventDistributor';
import * as Observability from '../modules/Observability';
import {publishDevice} from '../modules/redis/DeviceSignals';
import {fireAndForget} from '../modules/util/fireAndForget';
import {buildOutgoingEvent, buildOutgoingStatus} from '../rpc/builders';
import type {
    BTHome,
    Console,
    EntityEvent,
    entity_t,
    json_rpc_event,
    PathChange,
    ShellyEvent,
    ShellyMessageData,
    ShellyMessageIncoming,
    WaitingRoomEvent
} from '../types';
import {
    getBluetoothDevice,
    getBluetoothDeviceExternalIdBySource
} from './virtualDevice/bluetoothRepository';
import {projectBluetoothComponentStatus} from './virtualDevice/deviceListIntegration';
import type {SourceSnapshot} from './virtualDevice/readModel';

const logger = getLogger('shelly-events');

export function notifyComponentEvent(component: string, event: string) {
    const outgoingEvent = buildOutgoingEvent('FM_CLIENT', component, event);
    EventDistributor.notifyAll(outgoingEvent, {reason: component});
}

export function notifyComponentStatus(patch: object) {
    const key = Object.keys(patch)?.[0];
    if (!key) return;
    const outgoingEvent = buildOutgoingStatus('FM_CLIENT', patch);
    EventDistributor.notifyAll(outgoingEvent, {reason: key});
}

let eventCount = 0;

Observability.registerModule('shellyEvents', {
    stats: () => ({
        connects: Observability.getCounter('shelly_connect_emitted'),
        disconnects: Observability.getCounter('shelly_disconnect_emitted'),
        totalEvents: eventCount
    }),
    topology: {
        role: 'transform',
        cluster: 'pipeline',
        upstreams: ['registry'],
        downstreams: ['events'],
        label: 'Shelly Events',
        description: 'Device lifecycle event emitter',
        route: '/monitoring/events'
    }
});

export function emitShellyConnected(device: AbstractDevice) {
    Observability.incrementCounter('shelly_connect_emitted');
    logger.info(
        'emitShellyConnected shellyID:[%s] model:[%s]',
        device.shellyID,
        device.info?.model
    );
    const deviceJSON = device.toJSON();
    const event: ShellyEvent.Connect = {
        method: 'Shelly.Connect',
        params: {
            shellyID: device.shellyID,
            device: deviceJSON,
            emittedAt: Date.now()
        }
    };
    EventDistributor.processAndNotifyAll(event, {device});
    AuditLogger.logDeviceOnline(device.shellyID);
    fireAndForget(
        'publishDevice.connected',
        publishDevice({kind: 'connected', shellyID: device.shellyID})
    );
}

export function emitShellyDisconnected(device: AbstractDevice) {
    Observability.incrementCounter('shelly_disconnect_emitted');
    const {shellyID} = device;
    const event: ShellyEvent.Disconnect = {
        method: 'Shelly.Disconnect',
        params: {shellyID, emittedAt: Date.now()}
    };
    EventDistributor.processAndNotifyAll(event, {device});
    AuditLogger.logDeviceOffline(shellyID);
    fireAndForget(
        'publishDevice.disconnected',
        publishDevice({kind: 'disconnected', shellyID})
    );
}

export function emitShellyDeleted(device: AbstractDevice, username?: string) {
    const {shellyID} = device;
    const event: ShellyEvent.Delete = {
        method: 'Shelly.Delete',
        params: {shellyID}
    };
    EventDistributor.processAndNotifyAll(event, {device});
    AuditLogger.logDeviceDelete(shellyID, username);
    fireAndForget(
        'publishDevice.deleted',
        publishDevice({kind: 'deleted', shellyID})
    );
}

export function emitShellyDeviceInfo(device: AbstractDevice) {
    const {shellyID, info: deviceInfo} = device;
    const event: ShellyEvent.Info = {
        method: 'Shelly.Info',
        params: {shellyID, info: deviceInfo}
    };
    EventDistributor.processAndNotifyAll(event, {device});
}

export function emitShellyStatus(
    device: AbstractDevice,
    reason: string | string[],
    changes?: PathChange[]
) {
    const {shellyID, status} = device;
    const event: ShellyEvent.Status = {
        method: 'Shelly.Status',
        params: {shellyID, status}
    };
    EventDistributor.processAndNotifyAll(event, {
        device,
        reason,
        changes
    });
    fireAndForget(
        'emitPromotedBluetoothStatus',
        emitPromotedBluetoothStatus(device, reason, changes)
    );
}

function componentOfPath(path: string): string {
    const dot = path.indexOf('.');
    return dot === -1 ? path : path.slice(0, dot);
}

function isBluetoothComponentKey(key: string): boolean {
    return (
        key.startsWith('bthomedevice:') ||
        key.startsWith('bthomesensor:') ||
        key.startsWith('blutrv:')
    );
}

function bluetoothEventReasons(
    reason: string | string[],
    changes?: readonly PathChange[]
): string[] {
    const fromChanges = changes
        ?.map((change) => componentOfPath(change.path))
        .filter(isBluetoothComponentKey);
    if (fromChanges?.length) return Array.from(new Set(fromChanges));
    const reasons = Array.isArray(reason) ? reason : [reason];
    return reasons.filter(isBluetoothComponentKey);
}

function bluetoothEventChanges(
    status: Record<string, unknown>,
    changes?: readonly PathChange[]
): PathChange[] | undefined {
    if (!changes?.length) return undefined;
    const projectedKeys = new Set(Object.keys(status));
    const filtered = changes.filter((change) =>
        projectedKeys.has(componentOfPath(change.path))
    );
    return filtered.length > 0 ? filtered : undefined;
}

async function emitPromotedBluetoothStatus(
    gatewayDevice: AbstractDevice,
    reason: string | string[],
    changes?: readonly PathChange[]
): Promise<void> {
    const reasons = bluetoothEventReasons(reason, changes);
    if (reasons.length === 0) return;
    const organizationId = EventDistributor.getDeviceOrg(
        gatewayDevice.shellyID
    );
    if (!organizationId) return;
    const gateway: SourceSnapshot = {
        presence: gatewayDevice.presence,
        status: gatewayDevice.status as Record<string, unknown>
    };
    const externalIds = new Set<string>();
    for (const componentKey of reasons) {
        const externalId = await getBluetoothDeviceExternalIdBySource(
            organizationId,
            gatewayDevice.shellyID,
            componentKey
        );
        if (externalId) externalIds.add(externalId);
    }
    for (const externalId of externalIds) {
        const device = await getBluetoothDevice(organizationId, externalId);
        if (!device) continue;
        const status = projectBluetoothComponentStatus({device, gateway});
        if (Object.keys(status).length === 0) continue;
        const event: ShellyEvent.Status = {
            method: 'Shelly.Status',
            params: {shellyID: device.externalId, status}
        };
        await EventDistributor.processAndNotifyAll(event, {
            shellyID: device.externalId,
            reason: reasons,
            changes: bluetoothEventChanges(status, changes)
        });
    }
}

export function emitShellySettings(device: AbstractDevice) {
    const {shellyID, config: settings} = device;
    const event: ShellyEvent.Settings = {
        method: 'Shelly.Settings',
        params: {shellyID, settings}
    };
    EventDistributor.processAndNotifyAll(event, {device});
}

export function emitShellyMessage(
    device: AbstractDevice,
    res: ShellyMessageIncoming,
    req?: ShellyMessageData
) {
    eventCount++;
    const event: ShellyEvent.Message = {
        method: 'Shelly.Message',
        params: {shellyID: device.shellyID, message: res, req}
    };
    EventDistributor.processAndNotifyAll(event, {device});
}

export function emitShellyPresenceTrack(
    device: AbstractDevice,
    objects: Array<{
        id: number;
        x: number;
        y: number;
        z: number;
        minz: number;
        maxz: number;
    }>,
    ts: number
) {
    const event: ShellyEvent.PresenceTrack = {
        method: 'Shelly.PresenceTrack',
        params: {shellyID: device.shellyID, objects, ts}
    };
    EventDistributor.processAndNotifyAll(event, {device});
}

export function emitShellyPresence(device: AbstractDevice) {
    const {shellyID, presence} = device;
    const event: ShellyEvent.Presence = {
        method: 'Shelly.Presence',
        params: {shellyID, presence}
    };
    EventDistributor.processAndNotifyAll(event, {device});
}

export function emitEntityAdded(entity: entity_t) {
    const event: EntityEvent.Added = {
        method: 'Entity.Added',
        params: {entityId: entity.id}
    };
    EventDistributor.processAndNotifyAll(event, {
        shellyID: entity.source ?? undefined
    });
}

export function emitEntityRemoved(entity: entity_t) {
    const event: EntityEvent.Removed = {
        method: 'Entity.Removed',
        params: {entityId: entity.id}
    };
    EventDistributor.processAndNotifyAll(event, {
        shellyID: entity.source ?? undefined
    });
}

export function emitEntityEvent(
    entity: entity_t,
    event:
        | 'single_push'
        | 'double_push'
        | 'triple_push'
        | 'long_push'
        | 'long_double_push'
        | 'long_triple_push'
        | 'rotate_left'
        | 'rotate_right'
        | 'hold_press'
) {
    const _event: EntityEvent.Event = {
        method: 'Entity.Event',
        params: {entityId: entity.id, event}
    };

    EventDistributor.processAndNotifyAll(_event, {
        shellyID: entity.source ?? undefined
    });
}

export function emitEntityStatusChange(entity: entity_t, status: any) {
    const _event: EntityEvent.StatusChange = {
        method: 'Entity.StatusChange',
        params: {entityId: entity.id, status}
    };

    EventDistributor.processAndNotifyAll(_event, {
        shellyID: entity.source ?? undefined
    });
}

export function emitBTHomeDiscoveryResult(
    localName: string,
    mac: string,
    shellyID: string,
    modelId?: number,
    rssi?: number
) {
    const {
        modelId: modelString,
        productName,
        isRemote
    } = resolveBluDeviceInfo(undefined, modelId);
    const type = modelString ?? resolveModelString(modelId ?? -1) ?? localName;
    const displayName =
        productName !== 'BLE Device'
            ? productName
            : localName !== 'unknown'
              ? localName
              : 'BLE Device';
    const event: BTHome.DiscoveryResult = {
        method: 'BTHome.DiscoveryResult',
        params: {
            type,
            mac,
            shellyID,
            name: displayName,
            productName: productName !== 'BLE Device' ? productName : undefined,
            modelString,
            isRemote,
            modelId,
            localName: localName !== 'unknown' ? localName : undefined,
            rssi
        }
    };
    EventDistributor.processAndNotifyAll(event, {shellyID});
}

export function emitShellyOtaProgress(
    device: AbstractDevice,
    event: 'ota_begin' | 'ota_progress' | 'ota_success' | 'ota_error',
    progressPercent?: number,
    msg?: string
) {
    const otaEvent: ShellyEvent.OtaProgress = {
        method: 'Shelly.OtaProgress',
        params: {
            shellyID: device.shellyID as string,
            event,
            progress_percent: progressPercent,
            msg
        }
    };
    EventDistributor.processAndNotifyAll(otaEvent, {device});
}

export function emitShellyDiscoveryDone(
    shellyID: string,
    discoveredDevicesCount: number
) {
    const event: BTHome.DiscoveryDone = {
        method: 'BTHome.DiscoveryDone',
        params: {shellyID, discoveredDevicesCount}
    };
    EventDistributor.processAndNotifyAll(event, {shellyID});
}

export function emitBTHomeControlLearning(
    shellyID: string,
    state: import('../types').BTHomeLearningState | null
) {
    const event: BTHome.ControlLearning = {
        method: 'BTHome.ControlLearning',
        params: {shellyID, state}
    };
    EventDistributor.processAndNotifyAll(event, {shellyID});
}

export function emitBTHomeControlsUpdated(shellyID: string) {
    const event: BTHome.ControlsUpdated = {
        method: 'BTHome.ControlsUpdated',
        params: {shellyID}
    };
    EventDistributor.processAndNotifyAll(event, {shellyID});
}
export function emitConsoleLog(
    coloredPart: string,
    log: string,
    color: string,
    category?: string
) {
    const event: Console.Log = {
        method: 'Console.Log',
        params: {coloredPart, log, color, category}
    };
    EventDistributor.notifyAll(event, {});
}

export function emitConsoleLogBatch(
    logs: {
        coloredPart: string;
        log: string;
        color: string;
        category?: string;
    }[]
) {
    const event: json_rpc_event = {
        method: 'Console.Log',
        params: {batch: logs}
    };
    EventDistributor.notifyAll(event, {});
}

export function emitWaitingRoomAccepted(id: number) {
    const event: WaitingRoomEvent.Accepted = {
        method: 'WaitingRoomEvent.Accepted',
        params: {id}
    };
    EventDistributor.processAndNotifyAll(event);
}

/**
 * Batch variant — one event with all IDs instead of N individual events.
 * Used by accept-all to avoid saturating the event loop.
 */
export function emitWaitingRoomAcceptedBatch(ids: number[]) {
    if (ids.length === 0) return;
    const event: json_rpc_event = {
        method: 'WaitingRoomEvent.Accepted',
        params: {ids}
    };
    EventDistributor.processAndNotifyAll(event);
}

export function emitWaitingRoomDenied(id: number) {
    const event: WaitingRoomEvent.Denied = {
        method: 'WaitingRoomEvent.Denied',
        params: {id}
    };
    EventDistributor.processAndNotifyAll(event);
}

export type NotifyEventEnvelope = {
    component?: string;
    event?: string;
    ts?: number;
} & Record<string, unknown>;

export interface DeviceEventDescriptor {
    attrs: ReadonlyArray<{name: string; type: string; desc: string}>;
}

export type DescriptorSource = 'component-class' | 'device-catalog' | null;

export interface EmitDeviceEventInput {
    device: AbstractDevice;
    raw: NotifyEventEnvelope;
    descriptor?: DeviceEventDescriptor;
    /** Where the descriptor came from. null = no source resolved. */
    descriptorSource?: DescriptorSource;
}

// UI fan-out: Shelly.Event.<component>.<event>. Backend consumers use
// broadcastDeviceEventForBackend instead.
export function emitDeviceEvent(input: EmitDeviceEventInput): void {
    const component =
        typeof input.raw.component === 'string' ? input.raw.component : '';
    const event = typeof input.raw.event === 'string' ? input.raw.event : '';
    if (!component || !event) {
        reportMalformedEvent(input.device, input.raw);
        return;
    }
    EventDistributor.processAndNotifyAll(
        buildDeviceEventMessage({component, event, input}),
        {device: input.device}
    );
}

// Backend-internal bus. NOT through EventDistributor — that pipe carries
// plugin + metadata overhead irrelevant to internal consumers.
export interface DeviceEventEnvelope {
    shellyID: string;
    componentKey: string;
    componentType: string;
    event: string;
    ts: number | null;
    attrs: Record<string, unknown>;
    schema: ReadonlyArray<{name: string; type: string; desc: string}> | null;
    /**
     * 'component-class' = FM declared this event (doc-grounded SoT).
     * 'device-catalog'  = device's Webhook.ListAllSupported declared it.
     * null              = neither source knew about it.
     */
    descriptorSource: DescriptorSource;
}

export type DeviceEventListener = (envelope: DeviceEventEnvelope) => void;

const deviceEventBus = new EventEmitter();
const DEVICE_EVENT_TOPIC = 'event';
// Surface listener leaks instead of letting the default-10 warning fire.
deviceEventBus.setMaxListeners(32);

export function onDeviceEvent(listener: DeviceEventListener): () => void {
    deviceEventBus.on(DEVICE_EVENT_TOPIC, listener);
    return () => deviceEventBus.off(DEVICE_EVENT_TOPIC, listener);
}

// Called for every NotifyEvent. Drops malformed envelopes so subscribers
// always receive a complete shape; counter bump makes drops observable.
export function broadcastDeviceEventForBackend(
    input: EmitDeviceEventInput
): void {
    // Untrusted (no org) devices never reach the alert bus.
    if (!EventDistributor.getDeviceOrg(input.device.shellyID)) {
        Observability.incrementCounter('device_event_untrusted_skipped');
        return;
    }
    const envelope = buildDeviceEventEnvelope(input);
    if (!envelope) {
        Observability.incrementCounter('device_event_backend_bus_malformed');
        return;
    }
    deviceEventBus.emit(DEVICE_EVENT_TOPIC, envelope);
}

function buildDeviceEventEnvelope(
    input: EmitDeviceEventInput
): DeviceEventEnvelope | null {
    const component =
        typeof input.raw.component === 'string' ? input.raw.component : '';
    const event = typeof input.raw.event === 'string' ? input.raw.event : '';
    if (!component || !event) return null;
    const attrs = extractEventAttrs(input.raw);
    const schema = input.descriptor?.attrs ?? null;
    countUndeclaredAttrs(attrs, schema);
    return {
        shellyID: input.device.shellyID,
        componentKey: component,
        componentType: componentTypeOf(component),
        event,
        ts: typeof input.raw.ts === 'number' ? input.raw.ts : null,
        attrs,
        schema,
        descriptorSource: input.descriptorSource ?? null
    };
}

// Counts payload fields the device sent that aren't in the declared
// schema. Surfaces firmware drift (new fields) without changing data.
function countUndeclaredAttrs(
    attrs: Record<string, unknown>,
    schema: ReadonlyArray<{name: string}> | null
): void {
    if (!schema) return;
    const declared = new Set(schema.map((a) => a.name));
    for (const key of Object.keys(attrs)) {
        if (!declared.has(key)) {
            Observability.incrementCounter('device_event_attr_undeclared');
        }
    }
}

function componentTypeOf(componentKey: string): string {
    const colon = componentKey.indexOf(':');
    return colon === -1 ? componentKey : componentKey.slice(0, colon);
}

function reportMalformedEvent(
    device: AbstractDevice,
    raw: NotifyEventEnvelope
): void {
    logMalformedOnce(device.shellyID, raw);
    Observability.incrementCounter('unknown_device_event_malformed');
}

interface BuildMessageInput {
    component: string;
    event: string;
    input: EmitDeviceEventInput;
}

function buildDeviceEventMessage(b: BuildMessageInput) {
    return {
        method: `Shelly.Event.${b.component}.${b.event}`,
        params: {
            shellyID: b.input.device.shellyID,
            component: b.component,
            event: b.event,
            ts: b.input.raw.ts,
            attrs: extractEventAttrs(b.input.raw),
            schema: b.input.descriptor?.attrs ?? null
        }
    };
}

// Shape-keyed (values excluded) so a single anomaly type warns once per device.
const loggedMalformedShapes = boundedLogDedupeSet();

function malformedShapeKey(
    shellyID: string,
    raw: Record<string, unknown>
): string {
    return `${shellyID}|${Object.keys(raw).sort().join(',')}`;
}

function warnMalformedShape(
    shellyID: string,
    raw: Record<string, unknown>
): void {
    logger.warn(
        'Malformed NotifyEvent from %s — missing component/event field, fields: %s',
        shellyID,
        Object.keys(raw).join(',')
    );
}

function logMalformedOnce(
    shellyID: string,
    raw: Record<string, unknown>
): void {
    const key = malformedShapeKey(shellyID, raw);
    if (loggedMalformedShapes.has(key)) return;
    loggedMalformedShapes.record(key);
    warnMalformedShape(shellyID, raw);
}

const RESERVED_EVENT_KEYS = new Set(['component', 'id', 'event', 'ts']);

function extractEventAttrs(
    raw: Record<string, unknown>
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k in raw) {
        if (!RESERVED_EVENT_KEYS.has(k)) out[k] = raw[k];
    }
    return out;
}
