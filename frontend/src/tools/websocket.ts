import {getZitadelAuth} from '@/helpers/zitadelAuth';
import type {useLogStore} from '@/stores/console';
// Lazy-imported inside connect()/onConnect() to break circular dependency:
// websocket → stores/devices → stores/entities → websocket
import type {useDevicesStore} from '@/stores/devices';
import type {useEntityStore} from '@/stores/entities';
import type {
    entity_t,
    json_rpc_event,
    ShellyDeviceExternal,
    ShellyEvent
} from '@/types';
import {WS_URL} from '../constants';
import {debug} from './debug';
import {sendRPC as httpSendRPC} from './http';
import {
    getObsLevel,
    isObservabilityEnabled,
    isWsTelemetryEnabled,
    recordDroppedFrame,
    recordPatchBufferDepth,
    recordRafFrameTime,
    recordRpcTiming,
    recordShellyConnectLatency,
    recordShellyConnectReceived,
    recordShellyDisconnectLatency,
    recordShellyDisconnectReceived,
    recordWsMessage,
    setPendingRpcCount
} from './observability';
import {isRecoverableReconnectError} from './wsReconnectErrors';

let connected = false;
let connecting = false;
let hasEverConnected = false;
let client = undefined as WebSocket | undefined;

// Callback registry for component status events (NotifyStatus)
const statusListeners = new Map<string, Set<(data: any) => void>>();

// Generic event dispatchers for alert/notification/location lifecycle events.
// Backend emits e.g. { method: 'Alert.Updated', params: {organizationId, alertId,
// ruleId, state, severity, ...} } — stores upsert from the params, fetching the
// full entity when the event payload is intentionally lightweight.
export interface NamespacedEvent {
    method: string;
    params: Record<string, unknown>;
    streamId?: string;
}
export type ResyncRequiredReason =
    | 'no_offset'
    | 'stream_expired'
    | 'stream_trimmed';
const deviceChangeListeners = new Set<(e: NamespacedEvent) => void>();
const alertEventListeners = new Set<(e: NamespacedEvent) => void>();
const notificationEventListeners = new Set<(e: NamespacedEvent) => void>();
const certificateEventListeners = new Set<(e: NamespacedEvent) => void>();
const credentialEventListeners = new Set<(e: NamespacedEvent) => void>();
const jobEventListeners = new Set<(e: NamespacedEvent) => void>();
const resyncRequiredListeners = new Set<
    (reason: ResyncRequiredReason) => void
>();
const locationEventListeners = new Set<(e: NamespacedEvent) => void>();
const dashboardEventListeners = new Set<(e: NamespacedEvent) => void>();
const reportEventListeners = new Set<(e: NamespacedEvent) => void>();
const deviceRelationshipEventListeners = new Set<
    (e: DeviceRelationshipChangedEvent) => void
>();
const componentEventListeners = new Map<string, Set<() => void>>();

// Subscribers to the backend's universal NotifyEvent forward (method prefix
// `Device.Event.`). One listener bucket per `<component>:<event>` pair.
// Frontend code that wants to react to firmware-emitted events without a
// dedicated handler registers here.
// Mirrors backend src/model/deviceEventCatalog.ts EventAttribute. Keep the
// type union in sync if the catalog adds new attribute kinds.
export type DeviceEventAttrType = 'boolean' | 'number' | 'string';
export interface DeviceEventAttribute {
    name: string;
    type: DeviceEventAttrType;
    desc: string;
}
export interface DeviceEventPayload {
    shellyID: string;
    component: string;
    event: string;
    ts?: number;
    attrs: Record<string, unknown>;
    schema: ReadonlyArray<DeviceEventAttribute> | null;
}

export interface DeviceRelationshipChangedEvent {
    method: 'Device.RelationshipsChanged';
    params: {
        reason: string;
        externalId?: string;
    };
}
const deviceEventListeners = new Map<
    string,
    Set<(p: DeviceEventPayload) => void>
>();

function componentEventKey(component: string, event: string): string {
    return `${component}:${event}`;
}

// The backend already carries `component` + `event` on every payload it
// emits (see ShellyEvents.emitDeviceEvent). Use the structured fields as
// the source of truth instead of round-tripping through method-string
// parsing — sidesteps any ambiguity for event names containing dots and
// keeps the dispatch resilient to method-prefix renames.
// Exported for unit tests; the production caller is the inline `case
// method.startsWith('Device.Event.')` branch in the WS message dispatcher.
export function handleDeviceEvent(parsed: json_rpc_event): void {
    const payload = readDeviceEventPayload(parsed.params);
    if (!payload) return;
    const listeners = deviceEventListeners.get(
        componentEventKey(payload.component, payload.event)
    );
    if (!listeners) return;
    for (const cb of listeners) cb(payload);
}

function readDeviceEventPayload(raw: unknown): DeviceEventPayload | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (
        typeof r.shellyID !== 'string' ||
        typeof r.component !== 'string' ||
        typeof r.event !== 'string' ||
        !r.attrs ||
        typeof r.attrs !== 'object'
    ) {
        return null;
    }
    return {
        shellyID: r.shellyID,
        component: r.component,
        event: r.event,
        ts: typeof r.ts === 'number' ? r.ts : undefined,
        attrs: r.attrs as Record<string, unknown>,
        schema: Array.isArray(r.schema)
            ? (r.schema as DeviceEventPayload['schema'])
            : null
    };
}

export function onDeviceEvent(
    component: string,
    event: string,
    cb: (p: DeviceEventPayload) => void
): () => void {
    const key = componentEventKey(component, event);
    const listeners =
        deviceEventListeners.get(key) ??
        new Set<(p: DeviceEventPayload) => void>();
    listeners.add(cb);
    deviceEventListeners.set(key, listeners);
    return () => {
        listeners.delete(cb);
        if (listeners.size === 0) deviceEventListeners.delete(key);
    };
}

function handleComponentEvents(event: json_rpc_event) {
    const events = Array.isArray(event.params?.events)
        ? event.params.events
        : [];
    for (const item of events) {
        const component = item?.component;
        const eventName = item?.event;
        if (typeof component !== 'string' || typeof eventName !== 'string') {
            continue;
        }
        const listeners = componentEventListeners.get(
            componentEventKey(component, eventName)
        );
        if (!listeners) continue;
        for (const cb of listeners) cb();
    }
}

export function onComponentEvent(
    component: string,
    event: string,
    cb: () => void
): () => void {
    const key = componentEventKey(component, event);
    const listeners = componentEventListeners.get(key) ?? new Set<() => void>();
    listeners.add(cb);
    componentEventListeners.set(key, listeners);
    return () => {
        listeners.delete(cb);
        if (listeners.size === 0) componentEventListeners.delete(key);
    };
}

export function onWaitingRoomUpdated(cb: () => void): () => void {
    return onComponentEvent('device', 'waiting_room_updated', cb);
}

// Live device change journal (DeviceEvent.Change). Opt-in: the troubleshooting
// console subscribes the event scoped to its watched devices, so no stream
// arrives unless something is listening.
export function onDeviceChange(cb: (e: NamespacedEvent) => void): () => void {
    deviceChangeListeners.add(cb);
    return () => {
        deviceChangeListeners.delete(cb);
    };
}

export function onAlertEvent(cb: (e: NamespacedEvent) => void): () => void {
    alertEventListeners.add(cb);
    return () => {
        alertEventListeners.delete(cb);
    };
}

export function onCertificateEvent(
    cb: (e: NamespacedEvent) => void
): () => void {
    certificateEventListeners.add(cb);
    return () => {
        certificateEventListeners.delete(cb);
    };
}

export function onCredentialEvent(
    cb: (e: NamespacedEvent) => void
): () => void {
    credentialEventListeners.add(cb);
    return () => {
        credentialEventListeners.delete(cb);
    };
}

export function onJobEvent(cb: (e: NamespacedEvent) => void): () => void {
    jobEventListeners.add(cb);
    return () => {
        jobEventListeners.delete(cb);
    };
}

export function onResyncRequired(
    cb: (reason: ResyncRequiredReason) => void
): () => void {
    resyncRequiredListeners.add(cb);
    return () => {
        resyncRequiredListeners.delete(cb);
    };
}

export function onNotificationEvent(
    cb: (e: NamespacedEvent) => void
): () => void {
    notificationEventListeners.add(cb);
    return () => {
        notificationEventListeners.delete(cb);
    };
}

export function onLocationEvent(cb: (e: NamespacedEvent) => void): () => void {
    locationEventListeners.add(cb);
    return () => {
        locationEventListeners.delete(cb);
    };
}

export function onDashboardEvent(cb: (e: NamespacedEvent) => void): () => void {
    dashboardEventListeners.add(cb);
    return () => {
        dashboardEventListeners.delete(cb);
    };
}

export function onReportEvent(cb: (e: NamespacedEvent) => void): () => void {
    reportEventListeners.add(cb);
    return () => {
        reportEventListeners.delete(cb);
    };
}

export function onDeviceRelationshipChanged(
    cb: (e: DeviceRelationshipChangedEvent) => void
): () => void {
    deviceRelationshipEventListeners.add(cb);
    return () => {
        deviceRelationshipEventListeners.delete(cb);
    };
}

// Callback registry for OTA progress events (Shelly.OtaProgress)
export type OtaEvent = {
    shellyID: string;
    event: 'ota_begin' | 'ota_progress' | 'ota_success' | 'ota_error';
    progress_percent?: number;
    msg?: string;
};
const otaListeners = new Set<(data: OtaEvent) => void>();

export function onOtaProgress(cb: (data: OtaEvent) => void): () => void {
    otaListeners.add(cb);
    return () => {
        otaListeners.delete(cb);
    };
}

// BTHome discovery events
export type BTHomeDiscoveryEvent = {
    type: string;
    mac: string;
    shellyID: string;
    /** Human-readable product name from backend (e.g. "Shelly BLU H&T") */
    name: string;
    /** Canonical product name from the backend BLU registry when known */
    productName?: string;
    /** Stable Shelly model string such as "SBBT-004CEU" */
    modelString?: string;
    /** True if this is a remote/button device (supports BTHomeControl learning) */
    isRemote: boolean;
    /** Numeric model_id from shelly_mfdata 0x0B block, if available */
    modelId?: number;
    /** Raw BLE local_name reported by the gateway */
    localName?: string;
    /** Discovery RSSI when the gateway provides it */
    rssi?: number;
};
export type BTHomeDoneEvent = {
    shellyID: string;
    discoveredDevicesCount: number;
};

// Backend-driven BLE control learning state (no frontend polling).
export type BTHomeLearningState = {
    inputId: number;
    stage: 'pairing' | 'press' | 'done' | 'remove' | 'error' | null;
    err: {code: number; msg: string | null} | null;
};
export type BTHomeControlLearningEvent = {
    shellyID: string;
    state: BTHomeLearningState | null;
};

// Emitted by backend when any bthomecontrol:N component is added or removed
// on a device. Frontend should re-fetch bindings via BTHome.Control.List.
export type BTHomeControlsUpdatedEvent = {
    shellyID: string;
};

const bthDiscoveryListeners = new Set<(data: BTHomeDiscoveryEvent) => void>();
const bthDoneListeners = new Set<(data: BTHomeDoneEvent) => void>();
const bthControlLearningListeners = new Set<
    (data: BTHomeControlLearningEvent) => void
>();
const bthControlsUpdatedListeners = new Set<
    (data: BTHomeControlsUpdatedEvent) => void
>();

export function onBTHomeDiscovery(
    cb: (data: BTHomeDiscoveryEvent) => void
): () => void {
    bthDiscoveryListeners.add(cb);
    return () => {
        bthDiscoveryListeners.delete(cb);
    };
}

export function onBTHomeDone(cb: (data: BTHomeDoneEvent) => void): () => void {
    bthDoneListeners.add(cb);
    return () => {
        bthDoneListeners.delete(cb);
    };
}

export function onBTHomeControlLearning(
    cb: (data: BTHomeControlLearningEvent) => void
): () => void {
    bthControlLearningListeners.add(cb);
    return () => {
        bthControlLearningListeners.delete(cb);
    };
}

export function onBTHomeControlsUpdated(
    cb: (data: BTHomeControlsUpdatedEvent) => void
): () => void {
    bthControlsUpdatedListeners.add(cb);
    return () => {
        bthControlsUpdatedListeners.delete(cb);
    };
}

/**
 * Register a listener for component status updates via NotifyStatus.
 * Returns a cleanup function to remove the listener.
 */
export function onComponentStatus(
    component: string,
    cb: (data: any) => void
): () => void {
    if (!statusListeners.has(component))
        statusListeners.set(component, new Set());
    statusListeners.get(component)!.add(cb);
    return () => {
        const set = statusListeners.get(component);
        if (set) {
            set.delete(cb);
            if (set.size === 0) statusListeners.delete(component);
        }
    };
}

interface json_rpc_result {
    id: number;
    src: string;
    dst: string;
    error?: any;
    result?: any;
}

function is_rpc_response(data: any): data is json_rpc_result {
    return (
        typeof data === 'object' &&
        !data.method && // exclude event notifications that happen to have a numeric id
        (typeof data.result === 'object' ||
            typeof data.result === 'undefined') &&
        (typeof data.error === 'object' || typeof data.error === 'undefined') &&
        typeof data.id === 'number' &&
        typeof data.src === 'string' &&
        typeof data.dst === 'string'
    );
}

function is_json_rpc_event(data: any): data is json_rpc_event {
    return (
        typeof data === 'object' &&
        typeof data.method === 'string' &&
        typeof data.params === 'object'
    );
}

const RPC_TIMEOUT_MS = 30_000;

let id = 2;
const waiting = new Map<
    number,
    {
        resolve: (value: unknown) => void;
        reject: (reason?: any) => void;
        method: string;
    }
>();

function nextRpcId() {
    const maxIdsToTry = waiting.size + 2;
    for (let attempts = 0; attempts < maxIdsToTry; attempts++) {
        const currentId = id;
        id = id >= Number.MAX_SAFE_INTEGER ? 2 : id + 1;
        if (!waiting.has(currentId)) {
            return currentId;
        }
    }

    throw new Error('No free websocket RPC IDs available');
}

export type PresenceTrackObject = {
    id: number;
    x: number;
    y: number;
    z: number;
    minz: number;
    maxz: number;
};
type PresenceTrackCallback = (
    objects: PresenceTrackObject[],
    ts: number
) => void;
const presenceTrackListeners = new Map<string, Set<PresenceTrackCallback>>();

export function addPresenceTrackListener(
    shellyID: string,
    cb: PresenceTrackCallback
): () => void {
    if (!presenceTrackListeners.has(shellyID)) {
        presenceTrackListeners.set(shellyID, new Set());
    }
    presenceTrackListeners.get(shellyID)!.add(cb);
    return () => {
        presenceTrackListeners.get(shellyID)?.delete(cb);
        if (presenceTrackListeners.get(shellyID)?.size === 0) {
            presenceTrackListeners.delete(shellyID);
        }
    };
}

// Wait for WebSocket to become OPEN, with a short timeout.
// Avoids premature HTTP fallback when WS is still connecting.
const WS_WAIT_TIMEOUT_MS = 3000;

function waitForConnection(): Promise<boolean> {
    if (client?.readyState === WebSocket.OPEN) return Promise.resolve(true);
    if (
        !client ||
        client.readyState === WebSocket.CLOSED ||
        client.readyState === WebSocket.CLOSING
    ) {
        return Promise.resolve(false);
    }
    // WS is CONNECTING — wait for open or give up on timeout/error
    return new Promise<boolean>((resolve) => {
        const onOpen = () => {
            cleanup();
            resolve(true);
        };
        const onErr = () => {
            cleanup();
            resolve(false);
        };
        const timer = setTimeout(() => {
            cleanup();
            resolve(false);
        }, WS_WAIT_TIMEOUT_MS);
        function cleanup() {
            clearTimeout(timer);
            client?.removeEventListener('open', onOpen);
            client?.removeEventListener('error', onErr);
            client?.removeEventListener('close', onErr);
        }
        client!.addEventListener('open', onOpen);
        client!.addEventListener('error', onErr);
        client!.addEventListener('close', onErr);
    });
}

type RpcOptions = {timeoutMs?: number};
type RpcDestination = string | string[];

function createWebSocketUnavailableError(method: string): Error {
    return new Error(`${method} requires an active websocket connection`);
}

async function ensureWebSocketTransport(method: string): Promise<void> {
    if (await waitForConnection()) return;
    if (!connected && !connecting) await connect();
    if (await waitForConnection()) return;
    throw createWebSocketUnavailableError(method);
}

function sendOpenWebSocketRPC<T = any>(
    dst: RpcDestination,
    method: string,
    params?: any,
    options?: RpcOptions
): Promise<T> {
    if (client?.readyState !== WebSocket.OPEN) {
        return Promise.reject(createWebSocketUnavailableError(method));
    }

    const rpcTimeout = options?.timeoutMs ?? RPC_TIMEOUT_MS;
    const t0 = isObservabilityEnabled() ? performance.now() : 0;
    const currentId = nextRpcId();

    client.send(
        JSON.stringify({
            jsonrpc: '2.0',
            id: currentId,
            method,
            src: 'FLEET_MANAGER_UI',
            dst,
            params
        })
    );

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const result = new Promise<T>((resolve, reject) => {
        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = undefined;
            }
        };

        waiting.set(currentId, {
            resolve: (value) => {
                cleanup();
                resolve(value as T);
            },
            reject: (error) => {
                cleanup();
                reject(error);
            },
            method
        });
        if (getObsLevel() >= 3) setPendingRpcCount(waiting.size);

        timeoutId = setTimeout(() => {
            waiting.delete(currentId);
            if (getObsLevel() >= 3) setPendingRpcCount(waiting.size);
            reject(new Error(`RPC timeout after ${rpcTimeout}ms`));
        }, rpcTimeout);
    });

    if (t0) {
        result.then(
            () => recordRpcTiming(method, performance.now() - t0),
            () => recordRpcTiming(method, performance.now() - t0)
        );
    }
    return result;
}

export async function sendWebSocketRPC<T = any>(
    dst: RpcDestination,
    method: string,
    params?: any,
    options?: RpcOptions
): Promise<T> {
    await ensureWebSocketTransport(method);
    return sendOpenWebSocketRPC(dst, method, params, options);
}

export async function sendRPC<T = any>(
    dst: string | string[],
    method: string,
    params?: any,
    options?: RpcOptions
): Promise<T> {
    // Wait for WS to connect before falling back to HTTP
    const wsReady = await waitForConnection();
    if (!wsReady) {
        // No-token short-circuit: an anonymous HTTP RPC would just bounce off
        // the auth guard and reject as 401. Skip the round-trip and reject
        // here so the toast layer's auth-aware filter (toastRpcError) hides
        // it cleanly instead of the user seeing "Not authenticated" toasts
        // on the login screen / right after sign-in.
        if (!hasAnyToken()) {
            return Promise.reject({
                code: 401,
                message: 'Not authenticated',
                method
            });
        }
        // Normal during initial page load — WS still connecting, HTTP fallback works fine
        return httpSendRPC(
            method,
            params,
            typeof dst === 'string' ? dst : undefined
        ).catch((error: unknown) => {
            handleRpcAuthFailure(error);
            return Promise.reject(error);
        }) as Promise<T>;
    }
    return sendOpenWebSocketRPC(dst, method, params, options);
}

function handleRpcResponse(response: json_rpc_result) {
    const {id} = response;
    // Any RPC response means auth succeeded — reset backoff and auth retry counter
    reconnectDelay = 2000;
    authRetryCount = 0;
    // Capture System.Subscribe stream state for cross-reconnect resume.
    if (
        response.result &&
        typeof response.result === 'object' &&
        ('connectionId' in (response.result as object) ||
            'resyncRequired' in (response.result as object))
    ) {
        recordSubscribeAck(
            response.result as {
                connectionId?: string;
                resyncRequired?:
                    | 'no_offset'
                    | 'stream_expired'
                    | 'stream_trimmed';
            }
        );
    }
    const entry = waiting.get(id);
    if (entry) {
        waiting.delete(id);
        if (getObsLevel() >= 3) setPendingRpcCount(waiting.size);
        if (typeof response.result !== 'undefined') {
            entry.resolve(response.result);
            return;
        }
        // Tag with the called method so the UI can show "Method not found:
        // alert.instance.list" instead of an opaque request id.
        const raw = response.error ?? response;
        const enriched =
            raw && typeof raw === 'object'
                ? {...(raw as object), method: entry.method}
                : {message: String(raw), method: entry.method};
        handleRpcAuthFailure(enriched);
        entry.reject(enriched);
    }
}

let authRecoveryInProgress = false;

function handleRpcAuthFailure(error: unknown): void {
    if (!isUnauthorizedRpcError(error) || authRecoveryInProgress) return;
    authRecoveryInProgress = true;
    void handleAuthRejection().finally(() => {
        authRecoveryInProgress = false;
    });
}

function isUnauthorizedRpcError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    return (error as {code?: unknown}).code === 401;
}

// ---- Batched event buffer ----
// ALL Shelly events are collected here and flushed once per animation frame.
// This prevents thousands of individual Vue reactivity triggers per second
// from starving the browser main thread. Connect/Disconnect are also batched
// because during reconnects hundreds arrive at once, each triggering heavy
// reactive object creation that blocks the main thread for seconds.
// emittedAt is only set on connect/disconnect entries and only when the
// backend included it — used to compute end-to-end latency on apply.
type PatchEntry =
    | {type: 'connect'; shellyID: string; data: any; emittedAt?: number}
    | {type: 'disconnect'; shellyID: string; data: null; emittedAt?: number}
    | {type: 'status'; shellyID: string; data: any}
    | {type: 'info'; shellyID: string; data: any}
    | {type: 'settings'; shellyID: string; data: any}
    | {type: 'presence'; shellyID: string; data: any};

const pendingPatches = new Map<string, PatchEntry>();
let rafScheduled = false;

const FLUSH_CHUNK_SIZE = 80; // max patches per frame — keeps frames under 16ms budget

function schedulePatchFlush(devicesStore: ReturnType<typeof useDevicesStore>) {
    if (rafScheduled) return;
    rafScheduled = true;

    requestAnimationFrame(() => {
        // B1: record peak buffer depth right before draining — this is
        // the true accumulated size since the last frame
        if (isWsTelemetryEnabled()) {
            recordPatchBufferDepth(pendingPatches.size);
        }

        const entries = Array.from(pendingPatches.values());
        pendingPatches.clear();

        // If small batch, process all in this frame
        if (entries.length <= FLUSH_CHUNK_SIZE) {
            timedApplyPatchBatch(entries, devicesStore);
            rafScheduled = false;
            return;
        }

        // B2: chunk limit hit — patches deferred to next frames
        if (isWsTelemetryEnabled()) recordDroppedFrame();

        // Large batch: process first chunk now, schedule rest for next frames.
        // Keep rafScheduled = true until ALL chunks are drained so that new
        // WS events arriving mid-drain don't trigger concurrent beginBatch/endBatch.
        timedApplyPatchBatch(entries.splice(0, FLUSH_CHUNK_SIZE), devicesStore);
        function drainRemaining() {
            if (entries.length === 0) {
                rafScheduled = false;
                // Events may have arrived while draining — flush them
                if (pendingPatches.size > 0) schedulePatchFlush(devicesStore);
                return;
            }
            requestAnimationFrame(() => {
                try {
                    timedApplyPatchBatch(
                        entries.splice(0, FLUSH_CHUNK_SIZE),
                        devicesStore
                    );
                    drainRemaining();
                } catch (e) {
                    console.error(
                        '[WS] patch drain failed, clearing queue:',
                        e
                    );
                    entries.length = 0;
                    rafScheduled = false;
                }
            });
        }
        drainRemaining();
    });
}

/** B3: wraps applyPatchBatch with performance.now() timing when ws telemetry is on */
function timedApplyPatchBatch(
    entries: PatchEntry[],
    devicesStore: ReturnType<typeof useDevicesStore>
) {
    if (isWsTelemetryEnabled()) {
        const t0 = performance.now();
        applyPatchBatch(entries, devicesStore);
        recordRafFrameTime(performance.now() - t0);
    } else {
        applyPatchBatch(entries, devicesStore);
    }
}

function applyPatchBatch(
    entries: PatchEntry[],
    devicesStore: ReturnType<typeof useDevicesStore>
) {
    devicesStore.beginBatch();
    try {
        for (const entry of entries) {
            switch (entry.type) {
                case 'connect':
                    devicesStore.deviceConnected(entry.data);
                    if (entry.emittedAt !== undefined) {
                        recordShellyConnectLatency(
                            Date.now() - entry.emittedAt
                        );
                    }
                    break;
                case 'disconnect':
                    devicesStore.deviceDisconnected(entry.shellyID);
                    if (entry.emittedAt !== undefined) {
                        recordShellyDisconnectLatency(
                            Date.now() - entry.emittedAt
                        );
                    }
                    break;
                case 'status':
                    devicesStore.patchStatus(entry.shellyID, entry.data);
                    break;
                case 'info':
                    devicesStore.patchInfo(entry.shellyID, entry.data);
                    break;
                case 'settings':
                    devicesStore.patchSettings(entry.shellyID, entry.data);
                    break;
                case 'presence':
                    devicesStore.patchPresence(entry.shellyID, entry.data);
                    break;
            }
        }
    } finally {
        devicesStore.endBatch();
    }
}

function handleShellyEvents(
    event: json_rpc_event,
    devicesStore: ReturnType<typeof useDevicesStore>
) {
    const shellyID = event.params.shellyID;
    const method = event.method;
    if (typeof shellyID !== 'string') {
        console.error('bad event, no shellyID', method);
        return;
    }

    debug('[WS Event]', method, shellyID);

    switch (method) {
        // Batched connect/disconnect — during reconnects hundreds arrive at once;
        // processing each immediately blocks the main thread for seconds.
        case 'Shelly.Connect': {
            recordShellyConnectReceived();
            const connectEvent = event as ShellyEvent.Connect;
            // Connect wins over any pending disconnect for the same device
            // (during reconnect, old device emits disconnect AFTER new device emits connect)
            pendingPatches.delete(`${shellyID}:disconnect`);
            pendingPatches.set(`${shellyID}:connect`, {
                type: 'connect',
                shellyID,
                data: connectEvent.params.device,
                emittedAt: connectEvent.params.emittedAt
            });
            schedulePatchFlush(devicesStore);
            break;
        }
        case 'Shelly.Disconnect': {
            recordShellyDisconnectReceived();
            const disconnectEvent = event as ShellyEvent.Disconnect;
            // If a connect is already pending for this device, skip the disconnect
            // (device reconnected — the disconnect is from the old connection)
            if (pendingPatches.has(`${shellyID}:connect`)) break;
            pendingPatches.set(`${shellyID}:disconnect`, {
                type: 'disconnect',
                shellyID,
                data: null,
                emittedAt: disconnectEvent.params.emittedAt
            });
            schedulePatchFlush(devicesStore);
            break;
        }
        case 'Shelly.Delete': {
            // Purge any pending patches for this device to prevent resurrection
            for (const key of pendingPatches.keys()) {
                if (key.startsWith(`${shellyID}:`)) {
                    pendingPatches.delete(key);
                }
            }
            devicesStore.deviceDeleted(shellyID);
            break;
        }

        // Batched events — high-frequency updates coalesced per animation frame
        case 'Shelly.Status': {
            const statusEvent = event as ShellyEvent.Status;
            pendingPatches.set(`${shellyID}:status`, {
                type: 'status',
                shellyID,
                data: statusEvent.params.status
            });
            schedulePatchFlush(devicesStore);
            break;
        }
        case 'Shelly.Info': {
            const infoEvent = event as ShellyEvent.Info;
            pendingPatches.set(`${shellyID}:info`, {
                type: 'info',
                shellyID,
                data: infoEvent.params.info
            });
            schedulePatchFlush(devicesStore);
            break;
        }
        case 'Shelly.Settings': {
            const settingsEvent = event as ShellyEvent.Settings;
            pendingPatches.set(`${shellyID}:settings`, {
                type: 'settings',
                shellyID,
                data: settingsEvent.params.settings
            });
            schedulePatchFlush(devicesStore);
            break;
        }
        case 'Shelly.Presence': {
            const presenceEvent = event as ShellyEvent.Presence;
            pendingPatches.set(`${shellyID}:presence`, {
                type: 'presence',
                shellyID,
                data: presenceEvent.params.presence
            });
            schedulePatchFlush(devicesStore);
            break;
        }

        case 'Shelly.PresenceTrack': {
            const trackEvent = event as ShellyEvent.PresenceTrack;
            const listeners = presenceTrackListeners.get(
                trackEvent.params.shellyID
            );
            if (listeners) {
                for (const cb of listeners) {
                    cb(trackEvent.params.objects, trackEvent.params.ts);
                }
            }
            break;
        }

        case 'Shelly.KVS':
            // do nothing
            break;

        default:
            console.error('Unknown event', event);
            break;
    }
}

function handleConsoleEvents(
    event: json_rpc_event,
    logStore: ReturnType<typeof useLogStore>
) {
    const method = event.method;

    switch (method) {
        case 'Console.Log': {
            if (event.params.batch) {
                for (const entry of event.params.batch) {
                    logStore.addLog(
                        entry.coloredPart,
                        entry.log,
                        entry.color,
                        entry.category
                    );
                }
            } else {
                logStore.addLog(
                    event.params.coloredPart,
                    event.params.log,
                    event.params.color,
                    event.params.category
                );
            }
            break;
        }

        default:
            console.error('Unknown event', event);
            break;
    }
}

function handleEntityEvents(
    event: json_rpc_event,
    entitiesStore: ReturnType<typeof useEntityStore>
) {
    const method = event.method;
    const entityId = event.params.entityId;

    switch (true) {
        case /\.added$/i.test(method): {
            entitiesStore.addEntity(entityId);

            break;
        }

        case /\.removed$/i.test(method): {
            entitiesStore.removeEntities([entityId]);

            break;
        }

        case /\.event$/i.test(method): {
            const _event = event.params.event;

            if (!_event) {
                console.error('Entity event without event data', event);
                break;
            }

            entitiesStore.notifyEvent(entityId, _event);

            break;
        }

        default: {
            console.error('Unknown event', event);
            break;
        }
    }
}

/** Opaque handle for a temporary status subscription. */
export interface TemporarySubscription {
    unsubscribe(): Promise<void>;
}

// Per-handle ownership replaces the previous module-level Set so two
// boards mounted concurrently (split view, fast device switching) can't
// clobber each other's subscriptions.
export async function addTemporarySubscription(
    shellyIDs: string[],
    events: string[] = ['Shelly.Status']
): Promise<TemporarySubscription> {
    const response = await sendWebSocketRPC<{ids: number[]}>(
        'FLEET_MANAGER',
        'System.Subscribe',
        {events, options: {shellyIDs}}
    );
    const ids = [...response.ids];
    let disposed = false;
    return {
        async unsubscribe() {
            if (disposed || ids.length === 0) return;
            disposed = true;
            if (client?.readyState !== WebSocket.OPEN) return;
            await sendWebSocketRPC('FLEET_MANAGER', 'System.Unsubscribe', {
                ids
            });
        }
    };
}

const CONN_ID_KEY = 'fm:ws:connectionId';
const STREAM_ID_KEY = 'fm:ws:lastSeenStreamId';
let currentConnectionId: string | undefined;
let currentLastSeenStreamId: string | undefined;

function readSavedConnectionId(): string | undefined {
    try {
        return localStorage.getItem(CONN_ID_KEY) ?? undefined;
    } catch {
        return undefined;
    }
}

function persistConnectionId(id: string): void {
    try {
        localStorage.setItem(CONN_ID_KEY, id);
    } catch {
        /* private mode / quota — fall back to per-tab memory only */
    }
}

function readSavedLastSeenStreamId(): string | undefined {
    try {
        return localStorage.getItem(STREAM_ID_KEY) ?? undefined;
    } catch {
        return undefined;
    }
}

function persistLastSeenStreamId(streamId: string): void {
    currentLastSeenStreamId = streamId;
    try {
        localStorage.setItem(STREAM_ID_KEY, streamId);
    } catch {
        /* private mode / quota — fall back to per-tab memory only */
    }
}

function clearLastSeenStreamId(): void {
    currentLastSeenStreamId = undefined;
    try {
        localStorage.removeItem(STREAM_ID_KEY);
    } catch {
        /* private mode / quota — memory is already cleared */
    }
}

function notifyResyncRequired(reason: ResyncRequiredReason): void {
    for (const cb of resyncRequiredListeners) cb(reason);
}

/** Capture canonical connectionId from System.Subscribe + handle RESYNC. */
export function recordSubscribeAck(result: {
    connectionId?: string;
    resyncRequired?: ResyncRequiredReason;
}): void {
    if (result.connectionId) {
        currentConnectionId = result.connectionId;
        persistConnectionId(result.connectionId);
    }
    if (result.resyncRequired) {
        clearLastSeenStreamId();
        debug(`[WS] RESYNC_REQUIRED: ${result.resyncRequired}`);
        notifyResyncRequired(result.resyncRequired);
    }
}

function getConnectionParams() {
    if (!currentConnectionId) {
        currentConnectionId = readSavedConnectionId();
    }
    if (!currentLastSeenStreamId) {
        currentLastSeenStreamId = readSavedLastSeenStreamId();
    }
    return {
        ...(currentConnectionId ? {connectionId: currentConnectionId} : {}),
        ...(currentLastSeenStreamId
            ? {lastSeenStreamId: currentLastSeenStreamId}
            : {}),
        events: [
            'Shelly.Connect',
            'Shelly.Disconnect',
            'Shelly.Delete',
            'Shelly.Status',
            'Shelly.Settings',
            'Shelly.KVS',
            'Shelly.Info',
            'Shelly.Presence',
            'Shelly.PresenceTrack',
            'Entity.Added',
            'Entity.Removed',
            'Entity.Event',
            'NotifyStatus',
            'NotifyEvent',
            'Shelly.OtaProgress',
            'BTHome.DiscoveryResult',
            'BTHome.DiscoveryDone',
            'BTHome.ControlLearning',
            'BTHome.ControlsUpdated',
            'Console.Log'
        ],
        options: {
            events: {
                'Shelly.Status': {
                    deny: [
                        '*:aenergy',
                        '*:consumption',
                        'em:*',
                        'em1:*',
                        'emdata:*',
                        'emdata1:*',
                        'wifi:*'
                    ]
                }
            }
        }
    };
}

function recordEventStreamOffset(event: json_rpc_event): void {
    const streamId = (event as {streamId?: unknown}).streamId;
    if (typeof streamId !== 'string' || streamId.length === 0) return;
    persistLastSeenStreamId(streamId);
}

// Dev mode token storage key (same as in auth store)
const DEV_MODE_TOKEN_KEY = 'dev_mode_token';

// Cheap synchronous check used by the WS sendRPC fallback to avoid making
// anonymous HTTP RPCs that will just 401. Reads storage only — does not
// fall through to mgr.getUser() because that would force an async boundary
// in the hot path.
function hasAnyToken(): boolean {
    return (
        !!localStorage.getItem(DEV_MODE_TOKEN_KEY) ||
        !!sessionStorage.getItem('access_token')
    );
}

export async function connect(): Promise<void> {
    if (connected || connecting) return;
    connecting = true;

    // Check for dev mode token first
    let token = localStorage.getItem(DEV_MODE_TOKEN_KEY);

    // If no dev mode token, try Zitadel
    if (!token) {
        if (window.__FM_RUNTIME_CONFIG__?.devMode) {
            // Dev mode — user hasn't logged in yet, not an error
            connecting = false;
            return;
        }
        const zitadelAuth = getZitadelAuth();
        if (!zitadelAuth) {
            console.error('Zitadel auth not initialized');
            connecting = false;
            return;
        }
        const user = await zitadelAuth.oidcAuth.mgr.getUser();
        token = user?.access_token ?? null;
    }

    if (!token || token.length === 0) {
        console.warn('No access token available for WebSocket connection');
        connecting = false;
        return;
    }

    const {getConnectStores} = await import('./websocketStores');
    const connectStores = getConnectStores();
    if (!connectStores.pinia) {
        console.warn('[WS] Pinia not ready, delaying websocket connect');
        connecting = false;
        return;
    }
    const {devicesStore, entitiesStore, logStore} = connectStores;
    if (!devicesStore || !entitiesStore || !logStore) {
        console.warn('[WS] Pinia stores not ready, delaying websocket connect');
        connecting = false;
        return;
    }
    try {
        client = new WebSocket(WS_URL, token);
    } catch (err) {
        console.error('[WS] Failed to create WebSocket:', err);
        connecting = false;
        return;
    }

    // Return a promise that resolves once the websocket is open.
    // This lets callers `await connect()` before issuing RPC calls,
    // preventing the "websocket not ready" fallback to HTTP.
    return new Promise<void>((resolve) => {
        client!.onclose = (ev) => {
            debug('[WS] closed, code:', ev.code);
            connected = false;
            connecting = false;
            resolve(); // ensure connect() promise settles even if onerror didn't fire
            if (ev.code === 4401) {
                // Server rejected our token. Try silent renew first —
                // the OIDC library may be able to get a fresh token without
                // a full redirect. Only fall back to login if renew fails.
                console.warn(
                    'WebSocket auth rejected (4401) — attempting silent renew'
                );
                handleAuthRejection();
                return;
            }
            if (ev.code === 4001) {
                // Server hard-disconnected this user (deactivated / deleted).
                // Reconnecting with the same token would just loop — server
                // closes again immediately. Drop the session and force a
                // fresh sign-in so the user sees the access-revoked state.
                console.warn(
                    'WebSocket hard-disconnect (4001) — account no longer active'
                );
                handleAuthRejection();
                return;
            }
            onClose();
        };
        client!.onerror = (e) => {
            console.error('ws error: ', e);
            connected = false;
            connecting = false;
            resolve(); // resolve anyway so callers aren't stuck; RPC will fallback to HTTP
        };
        client!.onopen = () => {
            debug('[WS] connected');
            connected = true;
            connecting = false;
            hasEverConnected = true;
            client?.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'System.Subscribe',
                    src: 'FLEET_MANAGER_UI',
                    dst: 'FLEET_MANAGER',
                    params: getConnectionParams()
                })
            );

            onConnect();
            resolve();
        };
        client!.onmessage = (e) => {
            recordWsMessage(); // already gated internally by level < 3
            try {
                const parsed = JSON.parse(e.data);
                if (is_rpc_response(parsed)) {
                    handleRpcResponse(parsed);
                    return;
                }

                if (!is_json_rpc_event(parsed)) {
                    return;
                }

                recordEventStreamOffset(parsed);
                const {method} = parsed;

                switch (true) {
                    case method === 'Shelly.OtaProgress':
                        for (const cb of otaListeners)
                            cb(parsed.params as OtaEvent);
                        break;

                    case method === 'BTHome.DiscoveryResult':
                        for (const cb of bthDiscoveryListeners)
                            cb(parsed.params as BTHomeDiscoveryEvent);
                        break;

                    case method === 'BTHome.DiscoveryDone':
                        for (const cb of bthDoneListeners)
                            cb(parsed.params as BTHomeDoneEvent);
                        break;

                    case method === 'BTHome.ControlLearning':
                        for (const cb of bthControlLearningListeners)
                            cb(parsed.params as BTHomeControlLearningEvent);
                        break;

                    case method === 'BTHome.ControlsUpdated':
                        for (const cb of bthControlsUpdatedListeners)
                            cb(parsed.params as BTHomeControlsUpdatedEvent);
                        break;

                    // Backend's universal NotifyEvent forward — opt-in
                    // subscription via onDeviceEvent(); silent no-op when
                    // no listener is registered. Ordered before the
                    // generic Shelly.* matcher so these don't fall into
                    // handleShellyEvents' default "unknown event" path.
                    case method.startsWith('Shelly.Event.'):
                        handleDeviceEvent(parsed);
                        break;

                    case method.startsWith('Shelly.'):
                        handleShellyEvents(parsed, devicesStore);
                        break;

                    // Accepted devices move from waiting_room → live device
                    // list. Backend doesn't re-emit Shelly.Connect (the
                    // device was already connected pre-accept), so refresh
                    // the devices store directly here instead of waiting
                    // on the 5s Mobile.SyncDelta debounce.
                    case method === 'DeviceEvent.Change':
                        for (const cb of deviceChangeListeners)
                            cb(parsed as NamespacedEvent);
                        break;

                    case method === 'WaitingRoomEvent.Accepted':
                        devicesStore.refreshDevicesInBackground(
                            'WS waiting-room'
                        );
                        break;

                    // Server lost our event stream mid-session and recreated it
                    // at the live tail — refetch full state to close the gap.
                    case method === 'Session.ResyncRequired':
                        notifyResyncRequired(
                            (parsed.params as {reason?: ResyncRequiredReason})
                                ?.reason ?? 'stream_expired'
                        );
                        break;

                    case /^entity\./i.test(method):
                        handleEntityEvents(parsed, entitiesStore);
                        break;

                    case method === 'NotifyEvent':
                        handleComponentEvents(parsed);
                        break;

                    case method === 'NotifyStatus': {
                        const params = parsed.params;
                        for (const [comp, listeners] of statusListeners) {
                            if (params[comp]) {
                                for (const cb of listeners) cb(params[comp]);
                            }
                        }
                        break;
                    }

                    case method === 'NotifyAuthChanged':
                        // Backend tells us this user's roles / permissions
                        // changed (grant, revoke, deactivate, PAT revoke).
                        // Pull a fresh shape so UI gates flip immediately.
                        void (async () => {
                            const {getResyncStores} = await import(
                                './websocketStores'
                            );
                            await getResyncStores().authStore?.fetchUserPermissions(
                                {rerunIfBusy: true}
                            );
                        })();
                        break;

                    case method.startsWith('Console.'):
                        handleConsoleEvents(parsed, logStore);
                        break;

                    case method.startsWith('Alert.'):
                        for (const cb of alertEventListeners)
                            cb(parsed as NamespacedEvent);
                        break;

                    case method.startsWith('Notification.'):
                        for (const cb of notificationEventListeners)
                            cb(parsed as NamespacedEvent);
                        break;

                    case method.startsWith('Certificate.'):
                        for (const cb of certificateEventListeners)
                            cb(parsed as NamespacedEvent);
                        break;

                    case method.startsWith('Credential.'):
                        for (const cb of credentialEventListeners)
                            cb(parsed as NamespacedEvent);
                        break;

                    case method.startsWith('Job.'):
                        for (const cb of jobEventListeners)
                            cb(parsed as NamespacedEvent);
                        break;

                    case method.startsWith('Location.'):
                        for (const cb of locationEventListeners)
                            cb(parsed as NamespacedEvent);
                        break;

                    case method.startsWith('Dashboard.'):
                        for (const cb of dashboardEventListeners)
                            cb(parsed as NamespacedEvent);
                        break;

                    case method.startsWith('Report.'):
                        for (const cb of reportEventListeners)
                            cb(parsed as NamespacedEvent);
                        break;

                    case method === 'Device.RelationshipsChanged':
                        for (const cb of deviceRelationshipEventListeners)
                            cb(parsed as DeviceRelationshipChangedEvent);
                        break;

                    default:
                        debug('unhandled ws event', method);
                        break;
                }
            } catch (error) {
                console.error('error in ws event', error);
            }
        };
    }); // end of new Promise
}

export function close() {
    _connectCount = 0;
    if (client !== undefined) {
        client.close();
    }
}

export function getRegistry(name: string) {
    return {
        getAll: async <T>() => {
            return sendRPC<T>('FLEET_MANAGER', 'Storage.GetAll', {
                registry: name
            });
        },
        getItem: async <T>(key: string) => {
            return sendRPC<T>('FLEET_MANAGER', 'Storage.GetItem', {
                registry: name,
                key
            });
        },
        setItem: async (key: string, value: any) => {
            return sendRPC('FLEET_MANAGER', 'Storage.SetItem', {
                registry: name,
                key,
                value
            });
        },
        removeItem: async (key: string, value?: any) => {
            return sendRPC('FLEET_MANAGER', 'Storage.RemoveItem', {
                registry: name,
                key,
                value
            });
        },
        keys: async () => {
            return sendRPC('FLEET_MANAGER', 'Storage.Keys', {registry: name});
        },
        // Typed AddItem — pass kind + the matching typed FK field.
        addItem: async <T>(
            _key: string,
            params: {
                dashboardId: number;
                kind: string;
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order?: number;
                size?: string;
                mobileLayout?: Record<string, unknown> | null;
            }
        ) =>
            sendRPC<T>('FLEET_MANAGER', 'Dashboard.Item.Add', {
                dashboardId: params.dashboardId,
                kind: params.kind,
                deviceId: params.deviceId ?? null,
                entitySubId: params.entitySubId ?? null,
                groupId: params.groupId ?? null,
                locationId: params.locationId ?? null,
                tagId: params.tagId ?? null,
                actionId: params.actionId ?? null,
                widgetKind: params.widgetKind ?? null,
                widgetConfig: params.widgetConfig ?? null,
                order: params.order ?? 0,
                size: params.size ?? '1x1',
                ...(params.mobileLayout !== undefined
                    ? {mobileLayout: params.mobileLayout}
                    : {})
            }),
        removeWidget: async (
            _key: string,
            params: {dashboard: number; itemId: number}
        ) => {
            return sendRPC<{removed: number}>(
                'FLEET_MANAGER',
                'dashboard.RemoveItem',
                {
                    dashboard: params.dashboard,
                    itemId: params.itemId
                }
            );
        }
    };
}

const DEVICE_PAGE_SIZE = 1000;

export async function listDevicesChunked(
    onChunk: (devices: ShellyDeviceExternal[]) => void
): Promise<void> {
    // First chunk: get total count
    const first = await sendRPC<{items: ShellyDeviceExternal[]; total: number}>(
        'FLEET_MANAGER',
        'device.list',
        {limit: DEVICE_PAGE_SIZE, offset: 0}
    );

    if (!first || !Array.isArray(first.items)) {
        // Fallback: backend returned old format (plain array)
        if (Array.isArray(first)) {
            onChunk(first as unknown as ShellyDeviceExternal[]);
        }
        return;
    }

    if (first.items.length > 0) {
        onChunk(first.items);
    }

    // Fire all remaining chunks in parallel
    const remaining = first.total - first.items.length;
    if (remaining <= 0) return;

    const chunkPromises: Promise<void>[] = [];
    for (
        let offset = DEVICE_PAGE_SIZE;
        offset < first.total;
        offset += DEVICE_PAGE_SIZE
    ) {
        chunkPromises.push(
            sendRPC<{items: ShellyDeviceExternal[]; total: number}>(
                'FLEET_MANAGER',
                'device.list',
                {limit: DEVICE_PAGE_SIZE, offset}
            )
                .then((res) => {
                    if (res?.items?.length > 0) {
                        onChunk(res.items);
                    }
                })
                .catch((err) => {
                    if (import.meta.env.DEV)
                        console.warn(
                            `[listDevicesChunked] Chunk at offset ${offset} failed:`,
                            err
                        );
                })
        );
    }
    await Promise.all(chunkPromises);
}

export async function listEntities(): Promise<Record<string, entity_t>> {
    return await sendRPC('FLEET_MANAGER', 'entity.list');
}

const ENTITY_PAGE_SIZE = 5000;

interface EntityPageResponse {
    items: entity_t[];
    total: number;
}

/** Convert entity array to Record keyed by entity ID */
function entitiesToRecord(items: entity_t[]): Record<string, entity_t> {
    const record: Record<string, entity_t> = {};
    for (const entity of items) {
        if (entity?.id) record[entity.id] = entity;
    }
    return record;
}

export async function listEntitiesChunked(
    onChunk: (entities: Record<string, entity_t>) => void
): Promise<void> {
    const first = await sendRPC<EntityPageResponse>(
        'FLEET_MANAGER',
        'entity.list',
        {limit: ENTITY_PAGE_SIZE, offset: 0}
    );

    // Backward compatibility: backend returned old format
    if (!first || typeof first.total !== 'number') {
        onChunk(first as unknown as Record<string, entity_t>);
        return;
    }

    if (first.items.length > 0) {
        onChunk(entitiesToRecord(first.items));
    }

    if (first.total <= first.items.length) return;

    const chunkPromises: Promise<void>[] = [];
    for (
        let offset = ENTITY_PAGE_SIZE;
        offset < first.total;
        offset += ENTITY_PAGE_SIZE
    ) {
        chunkPromises.push(
            sendRPC<EntityPageResponse>('FLEET_MANAGER', 'entity.list', {
                limit: ENTITY_PAGE_SIZE,
                offset
            })
                .then((res) => {
                    if (res?.items?.length > 0) {
                        onChunk(entitiesToRecord(res.items));
                    }
                })
                .catch((err) => {
                    if (import.meta.env.DEV)
                        console.warn(
                            `[listEntitiesChunked] Chunk at offset ${offset} failed:`,
                            err
                        );
                })
        );
    }
    await Promise.all(chunkPromises);
}

export async function enablePlugin(name: string, value: boolean) {
    return await sendRPC('FLEET_MANAGER', `plugin:${name}.setconfig`, {
        config: {enable: value}
    });
}

export async function listPlugins() {
    return await sendRPC('FLEET_MANAGER', 'plugin.list');
}

export async function getServerConfig() {
    return await sendRPC('FLEET_MANAGER', 'system.getconfig');
}

export async function getEntityInfo(id: string): Promise<entity_t | null> {
    // Uses Entity.Get (Phase 1 — replaced the legacy Entity.GetInfo method).
    return await sendRPC('FLEET_MANAGER', 'entity.get', {id});
}

// ── Preload cache for registry + RPC data ────────────────────────────
// Populated on connect so pages have data before the user navigates.
const preloadCache = new Map<string, any>();
const PRELOAD_CACHE_MAX = 50;

export function getPreloadedData<T>(
    registry: string,
    key: string
): T | undefined {
    const v = preloadCache.get(`${registry}:${key}`);
    return v as T | undefined;
}

export function getPreloadedRpc<T>(method: string): T | undefined {
    return preloadCache.get(`rpc:${method}`) as T | undefined;
}

/** Inject preloaded RPC data so the next useWsRpc(method) hydrates instantly. */
export function setPreloadedRpc<T>(method: string, data: T): void {
    preloadCache.set(`rpc:${method}`, data);
}

/** Read and delete preloaded RPC data so re-mounts always fire a fresh RPC. */
export function consumePreloadedRpc<T>(method: string): T | undefined {
    const key = `rpc:${method}`;
    const v = preloadCache.get(key) as T | undefined;
    if (v !== undefined) preloadCache.delete(key);
    return v;
}

function preloadRegistry(registry: string, key: string) {
    sendRPC('FLEET_MANAGER', 'Storage.GetItem', {registry, key})
        .then((data) => {
            preloadCache.set(`${registry}:${key}`, data);
            if (preloadCache.size > PRELOAD_CACHE_MAX) {
                preloadCache.delete(preloadCache.keys().next().value!);
            }
        })
        .catch((error) => {
            debug('Registry preload failed', {registry, key, error});
        });
}

function preloadRpc(method: string, params: any = {}) {
    sendRPC('FLEET_MANAGER', method, params)
        .then((data) => {
            preloadCache.set(`rpc:${method}`, data);
        })
        .catch((error) => {
            debug('RPC preload failed', {method, error});
        });
}

// Timer for deferred data loads in onConnect — cleared if auth fails before it fires
let connectLoadTimer: ReturnType<typeof setTimeout> | undefined;
// Periodic device re-sync — catches missed Connect/Disconnect events.
// Only runs when WS is connected AND tab is visible (no wasted traffic).
let resyncTimer: ReturnType<typeof setTimeout> | undefined;
let resyncFailCount = 0;
const RESYNC_INTERVAL_MS = 60_000;
const RESYNC_MAX_BACKOFF_MS = 300_000;

function cancelConnectLoads() {
    if (connectLoadTimer) {
        clearTimeout(connectLoadTimer);
        connectLoadTimer = undefined;
    }
}

let resyncInProgress = false;

function scheduleResync() {
    const delay =
        resyncFailCount === 0
            ? RESYNC_INTERVAL_MS
            : Math.min(
                  RESYNC_INTERVAL_MS * 2 ** resyncFailCount,
                  RESYNC_MAX_BACKOFF_MS
              );
    resyncTimer = setTimeout(runResync, delay);
}

async function runResync() {
    resyncTimer = undefined;
    if (
        !connected ||
        document.visibilityState !== 'visible' ||
        resyncInProgress
    ) {
        scheduleResync();
        return;
    }
    resyncInProgress = true;
    debug('[WS] periodic device re-sync');
    try {
        const {getResyncStores} = await import('./websocketStores');
        const {pinia, authStore, devicesStore} = getResyncStores();
        if (!pinia || !authStore || !devicesStore || !authStore.loggedIn)
            return;
        await devicesStore.fetchDevices();
        resyncFailCount = 0;
    } catch (e) {
        resyncFailCount++;
        logResyncFailure('periodic', e);
    } finally {
        resyncInProgress = false;
        if (connected) scheduleResync();
    }
}

function logResyncFailure(source: string, error: unknown): void {
    const message = `[WS] ${source} device re-sync failed:`;
    if (isRecoverableReconnectError(error)) {
        console.warn(message, error);
        return;
    }
    console.error(message, error);
}

function startResyncInterval() {
    stopResyncInterval();
    scheduleResync();
}

function stopResyncInterval() {
    if (resyncTimer) {
        clearTimeout(resyncTimer);
        resyncTimer = undefined;
    }
    resyncFailCount = 0;
}

let _connectCount = 0;

function onConnect() {
    // NOTE: reconnectDelay is reset when the first successful RPC response arrives,
    // not here. If the server closes immediately (auth failure), we must not reset
    // the backoff or we'll spam the server with reconnect attempts every 2s.
    _connectCount++;
    if (_connectCount > 1) {
        // Reconnect: refresh permissions in case grants/scopes changed
        // server-side while we were disconnected.
        void (async () => {
            try {
                const {getResyncStores} = await import('./websocketStores');
                const {authStore, jobsStore} = getResyncStores();
                await authStore?.fetchUserPermissions();
                await jobsStore?.restoreActive();
            } catch (err) {
                console.warn('[WS] reconnect restore failed:', err);
            }
        })();
    }
    // Preload small registries FIRST — they complete in <100ms and make
    // page navigation instant. Must fire before heavy device/entity loads
    // which saturate the WS pipe for 2-3 seconds.
    preloadRegistry('actions', 'rpc');
    preloadRegistry('ui', 'menuItems');
    preloadRegistry('ui', 'dashboards');
    preloadRpc('WaitingRoom.GetPending');

    // Heavy data: slight delay so preload responses arrive first.
    // Preloads take <50ms on a warm cache; without this gap the large
    // device.list response blocks the WS pipe and delays preload delivery.
    // IMPORTANT: fetchEntities must complete BEFORE fetchDevices, because
    // handleNewDevice() calls addEntity() which skips the RPC if the entity
    // is already loaded. Without this ordering, fetchDevices can fire thousands
    // of individual entity.get RPCs (N+1 flood).
    cancelConnectLoads();
    connectLoadTimer = setTimeout(async () => {
        connectLoadTimer = undefined;
        // If the socket was closed (e.g., 4401 auth rejection) before this fires,
        // don't start data loads — they'd fall back to HTTP with a stale token.
        if (!connected) return;
        const {getOnConnectStores} = await import('./websocketStores');
        const {
            pinia,
            entityStore,
            devicesStore,
            groupsStore,
            locationsStore,
            tagsStore
        } = getOnConnectStores();
        if (!pinia) return;
        if (!entityStore || !devicesStore || !groupsStore) return;
        await entityStore.fetchEntities();
        devicesStore.refreshDevicesInBackground('WS connect');
        groupsStore.fetchGroups();
        // Locations + tags are subject types like devices/entities/groups;
        // load them so any subject reference resolves to a name app-wide.
        locationsStore?.fetchLocations();
        tagsStore?.fetchTags();
        startResyncInterval();
    }, 50);
}

// Handle 4401 auth rejection: try silent renew once, then redirect to login.
// authRetryCount prevents infinite loops when signinSilent returns tokens that
// the server also rejects (each 4401 would trigger another signinSilent, resetting
// backoff and looping forever). Reset to 0 on successful RPC response.
let authRetryCount = 0;
const MAX_AUTH_RETRIES = 1;

async function handleAuthRejection() {
    cancelConnectLoads();
    lastDisconnectTs = Date.now();

    // Reject pending RPCs — they won't get responses
    if (waiting.size > 0) {
        const stale = new Map(waiting);
        waiting.clear();
        for (const [, entry] of stale) {
            entry.reject(new Error('WebSocket auth rejected'));
        }
    }

    if (authRetryCount < MAX_AUTH_RETRIES) {
        const zitadelAuth = getZitadelAuth();
        if (zitadelAuth) {
            try {
                const user = await zitadelAuth.oidcAuth.mgr.signinSilent();
                if (user?.access_token) {
                    debug('[WS] silent renew succeeded, reconnecting');
                    authRetryCount++;
                    reconnectDelay = 2000;
                    connect();
                    return;
                }
            } catch (err) {
                const msg = (err as Error)?.message || String(err);
                console.warn('[WS] silent renew failed:', msg);
                // Network error = server/Zitadel unreachable — just reconnect,
                // don't redirect to login (it would also fail and cause a loop).
                if (
                    msg.includes('Failed to fetch') ||
                    msg.includes('Network') ||
                    msg.includes('ERR_')
                ) {
                    console.warn(
                        '[WS] server unreachable, will retry via backoff'
                    );
                    scheduleReconnect();
                    return;
                }
            }
        }
    } else {
        console.warn('[WS] auth retry limit reached');
    }

    authRetryCount = 0;
    const {getResyncStores} = await import('./websocketStores');
    const {authStore} = getResyncStores();
    if (authStore) {
        await authStore.signOut('ws-4401');
    }
}

// Exponential backoff reconnect (2s → 3s → 4.5s → ... → 30s max)
let reconnectDelay = 2000;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
// Timestamp of last disconnect — used by axios to suppress login redirects
// during the grace period after a system reboot.
let lastDisconnectTs = 0;

/** Grace period (ms) after disconnect during which HTTP 401s won't redirect to /login. */
const REBOOT_GRACE_MS = 60_000;

/**
 * Returns true if the WS is in reconnect mode (backend recently went down).
 * Used by axios to avoid login redirects during system reboots.
 */
export function isInRebootGrace(): boolean {
    if (connected) return false;
    if (!lastDisconnectTs) return false;
    return Date.now() - lastDisconnectTs < REBOOT_GRACE_MS;
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        if (!connected) {
            connect();
            reconnectDelay = Math.min(reconnectDelay * 1.5, 30_000);
        }
    }, reconnectDelay);
}

function onClose() {
    cancelConnectLoads();
    stopResyncInterval();
    // Subscriptions are per-handle now; on disconnect the server already
    // drops them, and the per-component handle becomes a no-op on dispose.
    preloadCache.clear();
    lastDisconnectTs = Date.now();
    // Reject all pending RPCs immediately — they can never receive a response
    // on the closed socket. Without this, promises hang for 30s (RPC_TIMEOUT_MS)
    // and composables stay in loading state, blocking tab rendering.
    if (waiting.size > 0) {
        const stale = new Map(waiting);
        waiting.clear();
        for (const [, entry] of stale) {
            entry.reject(new Error('WebSocket closed'));
        }
    }
    scheduleReconnect();
}

// Safari (and some mobile browsers) suspend/kill WebSocket connections when
// the tab is backgrounded. Instead of waiting for the exponential backoff
// timer, reconnect immediately when the user returns to the tab.
// If WS IS connected, re-sync device list to catch any missed events.
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible') return;

        if (!connected && hasEverConnected) {
            debug('[WS] tab visible, reconnecting immediately');
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = undefined;
            }
            reconnectDelay = 2000;
            connect();
            return;
        }

        // WS is connected but we may have missed events while backgrounded.
        // Trigger an immediate re-sync (the periodic interval skips hidden tabs).
        // Skip if not authenticated (login page) to avoid 401 errors.
        if (resyncInProgress || !connected) return;
        resyncInProgress = true;
        debug('[WS] tab visible, re-syncing device list');
        try {
            const {getResyncStores} = await import('./websocketStores');
            const {pinia, authStore, devicesStore} = getResyncStores();
            if (!pinia) return;
            if (!authStore || !devicesStore) return;
            if (!authStore.loggedIn) return;
            await devicesStore.fetchDevices();
        } catch (e) {
            logResyncFailure('visible-tab', e);
        } finally {
            resyncInProgress = false;
        }
    });
}
