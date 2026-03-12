import zitadelAuth from '@/helpers/zitadelAuth';
import {useLogStore} from '@/stores/console';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import type {
    entity_t,
    json_rpc_event,
    ShellyDeviceExternal,
    ShellyEvent
} from '@/types';
import {FLEET_MANAGER_WEBSOCKET} from '../constants';
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
    recordWsMessage,
    setPendingRpcCount
} from './observability';

let connected = false;
let client = undefined as WebSocket | undefined;

// Callback registry for component status events (NotifyStatus)
const statusListeners = new Map<string, Set<(data: any) => void>>();

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
        statusListeners.get(component)?.delete(cb);
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
    {resolve: (value: unknown) => void; reject: (reason?: any) => void}
>();

export function sendRPC<T = any>(
    dst: string | string[],
    method: string,
    params?: any,
    options?: {timeoutMs?: number}
): Promise<T> {
    if (client == undefined || client.readyState !== client.OPEN) {
        console.warn('websocket not ready, using http fallback');
        return httpSendRPC(method, params) as Promise<T>;
    }
    const rpcTimeout = options?.timeoutMs ?? RPC_TIMEOUT_MS;
    const t0 = isObservabilityEnabled() ? performance.now() : 0;

    client.send(
        JSON.stringify({
            jsonrpc: '2.0',
            id,
            method,
            src: 'FLEET_MANAGER_UI',
            dst,
            params
        })
    );

    const currentId = id;
    const response = new Promise((resolve, reject) => {
        waiting.set(currentId, {resolve, reject});
        if (getObsLevel() >= 3) setPendingRpcCount(waiting.size);
    });

    const timeout = new Promise((_, reject) =>
        setTimeout(() => {
            waiting.delete(currentId);
            if (getObsLevel() >= 3) setPendingRpcCount(waiting.size);
            reject(new Error(`RPC timeout after ${rpcTimeout}ms`));
        }, rpcTimeout)
    );

    id = id + 1;
    const result = Promise.race([response, timeout]) as Promise<T>;
    if (t0) {
        result.then(
            () => recordRpcTiming(method, performance.now() - t0),
            () => recordRpcTiming(method, performance.now() - t0)
        );
    }
    return result;
}

function handleRpcResponse(response: json_rpc_result) {
    const {id} = response;
    const entry = waiting.get(id);
    if (entry) {
        waiting.delete(id);
        if (getObsLevel() >= 3) setPendingRpcCount(waiting.size);
        if (typeof response.result !== 'undefined') {
            entry.resolve(response.result);
            return;
        }
        entry.reject(response.error ?? response);
    }
}

// ---- Batched event buffer ----
// ALL Shelly events are collected here and flushed once per animation frame.
// This prevents thousands of individual Vue reactivity triggers per second
// from starving the browser main thread. Connect/Disconnect are also batched
// because during reconnects hundreds arrive at once, each triggering heavy
// reactive object creation that blocks the main thread for seconds.
type PatchEntry =
    | {type: 'connect'; shellyID: string; data: any}
    | {type: 'disconnect'; shellyID: string; data: null}
    | {type: 'status'; shellyID: string; data: any}
    | {type: 'info'; shellyID: string; data: any}
    | {type: 'settings'; shellyID: string; data: any}
    | {type: 'presence'; shellyID: string; data: any};

const pendingPatches = new Map<string, PatchEntry>();
let rafScheduled = false;

const FLUSH_CHUNK_SIZE = 200; // max patches per frame to avoid blocking main thread

function schedulePatchFlush(devicesStore: ReturnType<typeof useDevicesStore>) {
    if (rafScheduled) return;
    rafScheduled = true;

    requestAnimationFrame(() => {
        rafScheduled = false;

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
            return;
        }

        // B2: chunk limit hit — patches deferred to next frames
        if (isWsTelemetryEnabled()) recordDroppedFrame();

        // Large batch: process first chunk now, schedule rest for next frames
        // This prevents 2k connect events from blocking the main thread
        timedApplyPatchBatch(entries.splice(0, FLUSH_CHUNK_SIZE), devicesStore);
        function drainRemaining() {
            if (entries.length === 0) return;
            requestAnimationFrame(() => {
                timedApplyPatchBatch(
                    entries.splice(0, FLUSH_CHUNK_SIZE),
                    devicesStore
                );
                drainRemaining();
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
    for (const entry of entries) {
        switch (entry.type) {
            case 'connect':
                devicesStore.deviceConnected(entry.data);
                break;
            case 'disconnect':
                devicesStore.deviceDisconnected(entry.shellyID);
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
            const connectEvent = event as ShellyEvent.Connect;
            pendingPatches.set(`${shellyID}:connect`, {
                type: 'connect',
                shellyID,
                data: connectEvent.params.device
            });
            schedulePatchFlush(devicesStore);
            break;
        }
        case 'Shelly.Disconnect': {
            pendingPatches.set(`${shellyID}:disconnect`, {
                type: 'disconnect',
                shellyID,
                data: null
            });
            schedulePatchFlush(devicesStore);
            break;
        }
        case 'Shelly.Delete': {
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
                    logStore.addLog(entry.coloredPart, entry.log, entry.color);
                }
            } else {
                logStore.addLog(
                    event.params.coloredPart,
                    event.params.log,
                    event.params.color
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

const temporarySubscriptions = new Set<number>();

export async function clearTemporarySubscriptions() {
    if (temporarySubscriptions.size == 0) return;
    await sendRPC('FLEET_MANAGER', 'FleetManager.Unsubscribe', {
        ids: [...temporarySubscriptions]
    });
    temporarySubscriptions.clear();
}

export async function addTemporarySubscription(shellyIDs: string[]) {
    const response = await sendRPC('FLEET_MANAGER', 'FleetManager.Subscribe', {
        events: ['Shelly.Status'],
        options: {
            shellyIDs
        }
    });
    for (const id of response.ids) {
        temporarySubscriptions.add(id);
    }
}

function getConnectionParams() {
    return {
        events: [
            'Shelly.Connect',
            'Shelly.Disconnect',
            'Shelly.Delete',
            'Shelly.Status',
            'Shelly.Settings',
            'Shelly.KVS',
            'Shelly.Info',
            'Shelly.Presence',
            'Entity.Added',
            'Entity.Removed',
            'Entity.Event',
            'NotifyStatus',
            'NotifyEvent',
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

// Dev mode token storage key (same as in auth store)
const DEV_MODE_TOKEN_KEY = 'dev_mode_token';

export async function connect(): Promise<void> {
    if (connected) return;

    // Check for dev mode token first
    let token = localStorage.getItem(DEV_MODE_TOKEN_KEY);

    // If no dev mode token, try Zitadel
    if (!token) {
        if (!zitadelAuth) {
            console.error('No auth available (neither dev mode nor Zitadel)');
            return;
        }

        const user = await zitadelAuth.oidcAuth.mgr.getUser();
        token = user?.access_token ?? null;
    }

    if (!token || token.length === 0) {
        console.warn('No access token available for WebSocket connection');
        return;
    }

    const devicesStore = useDevicesStore();
    const entitiesStore = useEntityStore();
    const logStore = useLogStore();
    client = new WebSocket(FLEET_MANAGER_WEBSOCKET, token);

    // Return a promise that resolves once the websocket is open.
    // This lets callers `await connect()` before issuing RPC calls,
    // preventing the "websocket not ready" fallback to HTTP.
    return new Promise<void>((resolve) => {
        client!.onclose = () => {
            debug('[WS] closed');
            connected = false;
            onClose();
        };
        client!.onerror = (e) => {
            console.error('ws error: ', e);
            connected = false;
            resolve(); // resolve anyway so callers aren't stuck; RPC will fallback to HTTP
        };
        client!.onopen = () => {
            debug('[WS] connected');
            connected = true;
            client?.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'FleetManager.Subscribe',
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

                const {method} = parsed;

                switch (true) {
                    case method.startsWith('Shelly.'):
                        handleShellyEvents(parsed, devicesStore);
                        break;

                    case /^entity\./i.test(method):
                        handleEntityEvents(parsed, entitiesStore);
                        break;

                    case method === 'NotifyEvent':
                        // Backend component events (waiting_room_updated, etc.)
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

                    case method.startsWith('Console.'):
                        handleConsoleEvents(parsed, logStore);
                        break;

                    default:
                        console.debug('unhandled ws event', method);
                        break;
                }
            } catch (error) {
                console.error('error in ws event', error);
            }
        };
    }); // end of new Promise
}

export function close() {
    if (client != undefined) {
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
        addItem: async <T>(
            // add widget
            key: string,
            params: {
                dashboard: number;
                type: number;
                item: number;
                order?: number;
                sub_item?: string | null;
            }
        ) =>
            sendRPC<T>('FLEET_MANAGER', 'Storage.AddItem', {
                registry: name,
                key,
                dashboard: params.dashboard,
                type: params.type,
                item: params.item,
                order: params.order ?? 0,
                sub_item: params.sub_item ?? null
            }),
        removeWidget: async (
            key: string,
            params: {dashboard: number; itemId: number}
        ) => {
            return sendRPC<{removed: number}>(
                'FLEET_MANAGER',
                'Storage.RemoveWidget',
                {
                    registry: name,
                    key,
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
    items: Record<string, entity_t>;
    total: number;
}

export async function listEntitiesChunked(
    onChunk: (entities: Record<string, entity_t>) => void
): Promise<void> {
    // First chunk: get total count
    const first = await sendRPC<EntityPageResponse>(
        'FLEET_MANAGER',
        'entity.list',
        {limit: ENTITY_PAGE_SIZE, offset: 0}
    );

    // Backward compatibility: backend returned old format (plain Record without items/total)
    if (!first || typeof first.total !== 'number') {
        onChunk(first as unknown as Record<string, entity_t>);
        return;
    }

    const itemCount = Object.keys(first.items).length;
    if (itemCount > 0) {
        onChunk(first.items);
    }

    // Fire remaining chunks in parallel
    if (first.total <= itemCount) return;

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
                    if (res?.items && Object.keys(res.items).length > 0) {
                        onChunk(res.items);
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
    return await sendRPC('FLEET_MANAGER', 'fleetmanager.listplugins');
}

export async function getSavedTemplates() {
    return await sendRPC('FLEET_MANAGER', 'fleetmanager.listrpc');
}

export async function getServerConfig() {
    return await sendRPC('FLEET_MANAGER', 'fleetmanager.getconfig');
}

export async function getEntityInfo(id: string): Promise<entity_t | null> {
    return await sendRPC('FLEET_MANAGER', 'entity.getinfo', {id});
}

// ── Preload cache for registry + RPC data ────────────────────────────
// Populated on connect so pages have data before the user navigates.
const preloadCache = new Map<string, any>();

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
        })
        .catch(() => {}); // Non-critical — pages fall back to own RPC
}

function preloadRpc(method: string, params: any = {}) {
    sendRPC('FLEET_MANAGER', method, params)
        .then((data) => {
            preloadCache.set(`rpc:${method}`, data);
        })
        .catch(() => {});
}

function onConnect() {
    reconnectDelay = 2000;
    // Preload small registries FIRST — they complete in <100ms and make
    // page navigation instant. Must fire before heavy device/entity loads
    // which saturate the WS pipe for 2-3 seconds.
    preloadRegistry('actions', 'rpc');
    preloadRegistry('ui', 'menuItems');
    preloadRegistry('ui', 'dashboards');
    preloadRpc('Device.GetPending');

    // Heavy data: slight delay so preload responses arrive first.
    // Preloads take <50ms on a warm cache; without this gap the large
    // device.list response blocks the WS pipe and delays preload delivery.
    // IMPORTANT: fetchEntities must complete BEFORE fetchDevices, because
    // handleNewDevice() calls addEntity() which skips the RPC if the entity
    // is already loaded. Without this ordering, fetchDevices can fire thousands
    // of individual entity.getinfo RPCs (N+1 flood).
    setTimeout(async () => {
        await useEntityStore().fetchEntities();
        useDevicesStore().fetchDevices();
        useGroupsStore().fetchGroups();
    }, 50);
}

// Exponential backoff reconnect (2s → 3s → 4.5s → ... → 30s max)
let reconnectDelay = 2000;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

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
