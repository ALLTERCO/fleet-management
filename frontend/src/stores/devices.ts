import {defineStore} from 'pinia';
import {computed, markRaw, reactive, ref} from 'vue';
import {UI_CONFIG} from '@/config/ui';
import {isDiscovered} from '@/helpers/device';
import {debug} from '@/tools/debug';
import {trackInteraction} from '@/tools/observability';
import {applyPatch, applySnapshot} from '@/tools/patch';
import type {
    DeviceCapabilities,
    presence,
    ShellyDeviceExternal,
    shelly_device_t
} from '@/types';
import * as ws from '../tools/websocket';
import {useEntityStore} from './entities';
import {createRefreshCoordinator} from './refreshCoordinator';
import {createStaleGuard} from './staleGuard';

function isBTHomeComponentKey(key: string): boolean {
    return (
        key.startsWith('bthomedevice:') ||
        key.startsWith('bthomesensor:') ||
        key.startsWith('blutrv:')
    );
}

function getBTHomeKeySet(data: any): Set<string> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return new Set();
    }

    return new Set(Object.keys(data).filter(isBTHomeComponentKey));
}

function didTopLevelKeysChange(
    before: Set<string>,
    after: Set<string>
): boolean {
    if (before.size !== after.size) return true;
    for (const key of before) {
        if (!after.has(key)) return true;
    }
    return false;
}

const DEVICE_LOADING_TIMEOUT_MS = 5_000;

function normalizedDeviceSource(
    source: ShellyDeviceExternal['source'] | undefined
): shelly_device_t['source'] | undefined {
    if (source === 'shelly' || source === 'virtual' || source === 'bluetooth') {
        return source;
    }
    return undefined;
}

export const useDevicesStore = defineStore('devices', () => {
    // Lazy — avoids triggering entity store setup before Pinia is fully ready
    let _entityStore: ReturnType<typeof useEntityStore> | undefined;
    function entityStore() {
        if (!_entityStore) _entityStore = useEntityStore();
        return _entityStore;
    }
    const devices = reactive<Record<string, shelly_device_t>>({});
    const loadingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const initialLoadComplete = ref(false);
    const devicesVersion = ref(0);
    const onlineCount = ref(0);
    const idToShellyMap = new Map<number, string>();
    let _bulkLoading = false;
    let _batchMode = false;
    let _batchDirty = false;

    // Monotonic live-event clock — snapshot merges must not regress newer
    // WS presence/status applied while the chunked list was collecting.
    const liveEventClock = createStaleGuard();
    const liveEventSeqByDevice = new Map<string, number>();

    function markLiveDeviceEvent(shellyID: string) {
        liveEventSeqByDevice.set(shellyID, liveEventClock.bump());
    }

    function hasLiveEventAfter(shellyID: string, seq: number): boolean {
        return (liveEventSeqByDevice.get(shellyID) ?? 0) > seq;
    }

    interface DeviceSnapshotGuard {
        shellyID: string;
        liveEventSeq: number;
    }

    function captureDeviceSnapshotGuard(shellyID: string): DeviceSnapshotGuard {
        return {shellyID, liveEventSeq: liveEventClock.current()};
    }

    /** Clear all pending loading timers — prevents stale timers from a previous
     *  connection marking devices offline after a reconnect. */
    function clearAllLoadingTimers() {
        for (const timer of loadingTimers.values()) {
            clearTimeout(timer);
        }
        loadingTimers.clear();
    }

    /** Suppress individual devicesVersion bumps — call endBatch() when done */
    function beginBatch() {
        _batchMode = true;
        _batchDirty = false;
    }

    /** Single devicesVersion bump for entire batch */
    function endBatch() {
        _batchMode = false;
        if (_batchDirty) {
            bumpVersion();
            _batchDirty = false;
        }
    }

    function bumpVersion() {
        if (_batchMode || _bulkLoading) _batchDirty = true;
        else devicesVersion.value++;
    }

    function setOnline(device: shelly_device_t, online: boolean) {
        const was = device.online;
        device.online = online;
        if (!was && online) onlineCount.value++;
        else if (was && !online) onlineCount.value--;
    }

    /**
     * Check if a device is a sleeping/battery device and whether it's within
     * its expected wakeup window. Returns undefined for non-sleeping devices.
     *
     * Detection signals (any one is sufficient):
     *  - sys.sleep.wakeup_period in config (canonical — device explicitly sleeps)
     *  - devicepower with actual battery data (not just external/AC power)
     */
    function isSleepingDeviceOnline(
        device: shelly_device_t
    ): boolean | undefined {
        const status = device.status;
        const settings = device.settings;

        // wakeup_period lives in CONFIG (sys.sleep.wakeup_period), not status
        const wakeupPeriod =
            settings?.sys?.sleep?.wakeup_period ?? status?.sys?.wakeup_period; // fallback for legacy

        // Check all possible devicepower locations
        const dp =
            status?.devicepower ??
            status?.['devicepower:0'] ??
            status?.['devicepower:1'];
        const hasBattery = dp?.battery != null;

        if (wakeupPeriod == null && !hasBattery) return undefined;

        const lastTs = status?.ts ?? status?.sys?.unixtime ?? 0;
        const period = wakeupPeriod ?? 86400;
        const now = Date.now() / 1000;
        return lastTs + period > now;
    }

    interface DeviceData {
        shellyID: string;
        source?: shelly_device_t['source'];
        info?: any;
        status?: any;
        settings?: any;
        entities?: string[];
        capabilities?: DeviceCapabilities;
        meta?: any;
        methods?: string[];
        id: any;
        groupIds?: number[];
        locationId?: number | null;
        tagIds?: number[];
    }

    function insertDevice({
        shellyID,
        source,
        info = {},
        status = {},
        settings = {},
        entities = [],
        capabilities = {},
        meta = {},
        methods = [],
        id,
        groupIds,
        locationId,
        tagIds
    }: DeviceData) {
        if (!_bulkLoading) bumpVersion();
        devices[shellyID] = {
            shellyID,
            id,
            source,
            online: false,
            sleeping: false,
            selected: false,
            loading: !_bulkLoading,
            info,
            status,
            settings,
            entities,
            capabilities,
            meta,
            methods,
            groupIds: groupIds ?? [],
            locationId: locationId ?? null,
            tagIds: tagIds ?? []
        };
        idToShellyMap.set(id, shellyID);

        if (!_bulkLoading) {
            loadingTimers.get(shellyID) &&
                clearTimeout(loadingTimers.get(shellyID));
            const timerId = setTimeout(() => {
                loadingTimers.delete(shellyID);
                if (devices[shellyID] && devices[shellyID].loading === true) {
                    devices[shellyID].loading = false;
                    setOnline(devices[shellyID], false);
                }
            }, DEVICE_LOADING_TIMEOUT_MS);
            loadingTimers.set(shellyID, timerId);
        }
    }

    const rpcResponses = ref<Record<string, any>>({});
    // Guards rpcResponses: a batch clear bumps, stale device replies discard themselves.
    const rpcBatchGuard = createStaleGuard();

    function clearRpcResponses() {
        rpcResponses.value = {};
        rpcBatchGuard.bump();
    }

    function sendTemplateRpc(method: string, params?: object) {
        // Clear old results
        clearRpcResponses();
        // Send commands
        for (const dev of selectedDevices.value) {
            sendTemplateRpcToDevice({
                shellyID: dev.shellyID,
                method,
                params
            });
        }
    }

    async function sendTemplateRpcToDevice(input: {
        shellyID: string;
        method: string;
        params?: object;
    }): Promise<void> {
        const token = rpcBatchGuard.current();
        try {
            const res = await ws.sendRPC(
                input.shellyID,
                input.method,
                input.params
            );
            if (rpcBatchGuard.isStale(token)) return;
            rpcResponses.value[input.shellyID] = res;
        } catch (error) {
            if (rpcBatchGuard.isStale(token)) return;
            // Failure entry renders in the Responses stage like a reply.
            rpcResponses.value[input.shellyID] = rpcErrorEntry(error);
        }
    }

    function rpcErrorEntry(error: unknown): {
        error: {code: number | null; message: string};
    } {
        const e = error as {code?: unknown; message?: unknown};
        return {
            error: {
                code: typeof e?.code === 'number' ? e.code : null,
                message:
                    typeof e?.message === 'string' && e.message
                        ? e.message
                        : String(error)
            }
        };
    }

    const selectedDevices = computed(() =>
        Object.values(devices).filter((dev) => dev.selected)
    );

    function getDevices() {
        return Object.values(devices).filter(
            (shelly) => !isDiscovered(shelly.shellyID)
        );
    }

    function getDiscoveredDevices() {
        return Object.values(devices).filter((shelly) =>
            isDiscovered(shelly.shellyID)
        );
    }

    async function fetchDeviceSnapshot() {
        // Cancel stale loading timers from a previous WS connection — they may
        // fire after reconnect and incorrectly mark devices as offline.
        clearAllLoadingTimers();
        debug('[fetchDevices] fetching device list from server (chunked)...');
        const t0 = performance.now();
        const snapshotSeq = liveEventClock.current();
        const allDevices = await ws.listDevicesSnapshot();
        debug(
            '[fetchDevices] network done:',
            allDevices.length,
            'devices in',
            Math.round(performance.now() - t0),
            'ms'
        );
        // Suppress per-device version bumps & loading timers during bulk insert
        _bulkLoading = true;
        try {
            for (const device of allDevices) {
                handleNewDevice(device, {
                    keepLiveState: hasLiveEventAfter(
                        device.shellyID,
                        snapshotSeq
                    )
                });
            }
            // Keep local discoveries and newer live arrivals.
            const present = new Set(allDevices.map((d) => d.shellyID));
            for (const shellyID of Object.keys(devices)) {
                if (present.has(shellyID)) continue;
                if (isDiscovered(shellyID)) continue;
                if (hasLiveEventAfter(shellyID, snapshotSeq)) continue;
                deviceDeleted(shellyID);
            }
        } finally {
            _bulkLoading = false;
        }
        // Single version bump for the entire batch
        bumpVersion();
        initialLoadComplete.value = true;
        debug(
            '[fetchDevices] processed in',
            Math.round(performance.now() - t0),
            'ms total'
        );
    }

    const deviceRefresh = createRefreshCoordinator(fetchDeviceSnapshot);

    function fetchDevices() {
        return deviceRefresh.request();
    }

    async function reconcileDevicesFromBackend(source: string): Promise<void> {
        try {
            await fetchDevices();
        } catch (error) {
            debug(`[${source}] device refresh failed`, error);
        }
    }

    function refreshDevicesInBackground(source: string): void {
        void reconcileDevicesFromBackend(source);
    }

    // Seed devices from Mobile.GetBootstrap. Does not flip initialLoadComplete —
    // pages still call fetchDevices() for the full chunked list.
    function seedFromBootstrap(
        items: import('@/types').ShellyDeviceExternal[]
    ) {
        if (!items?.length) return;
        _bulkLoading = true;
        for (const device of items) {
            handleNewDevice(device);
        }
        _bulkLoading = false;
        bumpVersion();
    }

    function insertNewDevice(shelly: ShellyDeviceExternal) {
        debug(
            '[handleNewDevice] NEW',
            shelly.shellyID,
            'model:',
            shelly.info?.model
        );
        insertDevice({
            shellyID: shelly.shellyID,
            source: normalizedDeviceSource(shelly.source),
            info: shelly.info,
            status: shelly.status,
            settings: shelly.settings,
            entities: shelly.entities,
            capabilities: shelly.capabilities,
            meta: shelly.meta,
            methods: shelly.methods,
            id: shelly.id,
            groupIds: shelly.groupIds,
            locationId: shelly.locationId,
            tagIds: shelly.tagIds
        });
        if (!isDiscovered(shelly.shellyID)) addDeviceEntities(shelly.entities);
    }

    function updateExistingDevice(
        existing: any,
        shelly: ShellyDeviceExternal,
        keepLiveStatus = false
    ) {
        debug('[handleNewDevice] UPDATE', shelly.shellyID);
        const source = normalizedDeviceSource(shelly.source);
        if (source) existing.source = source;
        if (shelly.info) applyPatch(existing.info, shelly.info);
        if (shelly.status && !keepLiveStatus)
            applyPatch(existing.status, shelly.status);
        if (shelly.settings) applyPatch(existing.settings, shelly.settings);
        if (shelly.entities !== undefined) {
            syncEntityStore(existing.entities ?? [], shelly.entities);
            existing.entities = shelly.entities;
        }
        if (shelly.meta) applyPatch(existing.meta, shelly.meta);
        if (shelly.capabilities) existing.capabilities = shelly.capabilities;
        if (shelly.methods?.length) existing.methods = shelly.methods;
        if (shelly.groupIds !== undefined) existing.groupIds = shelly.groupIds;
        if (shelly.locationId !== undefined)
            existing.locationId = shelly.locationId;
        if (shelly.tagIds !== undefined) existing.tagIds = shelly.tagIds;
        if (shelly.id !== undefined && shelly.id !== null) {
            existing.id = shelly.id;
            idToShellyMap.set(shelly.id, shelly.shellyID);
        }
    }

    function applySleepState(d: any, shelly: ShellyDeviceExternal) {
        const sleepOnline = isSleepingDeviceOnline(d);
        if (sleepOnline !== undefined) {
            d.sleeping = sleepOnline && shelly.presence !== 'online';
            setOnline(d, sleepOnline);
        } else {
            d.sleeping = false;
            setOnline(d, shelly.presence === 'online');
        }
        d.loading = false;
    }

    function handleNewDevice(
        shelly: ShellyDeviceExternal,
        opts?: {keepLiveState?: boolean}
    ) {
        const existing = devices[shelly.shellyID];
        const keepLiveState = opts?.keepLiveState === true && !!existing;
        if (existing) updateExistingDevice(existing, shelly, keepLiveState);
        else insertNewDevice(shelly);

        const d = devices[shelly.shellyID];
        if (!d) {
            debug('[handleNewDevice] Device not found after insert/update', {
                shellyID: shelly.shellyID
            });
            return;
        }
        if (!d.info) {
            d.info = {};
        }

        // Device got WS presence/status mid-snapshot — its live state is newer.
        if (keepLiveState) {
            d.loading = false;
            return;
        }
        applySleepState(d, shelly);
    }

    // Optimistic: show a just-accepted device now; the real build merges over it.
    function addOptimisticDevice(
        shellyID: string,
        status: ShellyDeviceExternal['status']
    ): void {
        if (devices[shellyID]) return; // never clobber a real/known device
        markLiveDeviceEvent(shellyID);
        const sys = (status?.sys ?? {}) as {
            gen?: number;
            device?: {model?: string};
        };
        handleNewDevice({
            id: 0,
            presence: 'online',
            shellyID,
            source: 'ws',
            info: {id: shellyID, model: sys.device?.model, gen: sys.gen},
            status,
            _statusTs: Date.now(),
            settings: {} as ShellyDeviceExternal['settings'],
            _settingsTs: undefined,
            selected: false,
            kvs: {},
            entities: [],
            capabilities: {} as ShellyDeviceExternal['capabilities'],
            meta: {},
            methods: []
        });
    }

    // Full replace on reconnect — device may have changed profile/components.
    // applyPatch merges keys, leaving stale components (e.g. em1:* after switch to em:0).
    function replaceDeviceData(device: any, shelly: ShellyDeviceExternal) {
        const source = normalizedDeviceSource(shelly.source);
        if (source) device.source = source;
        if (shelly.info) device.info = shelly.info;
        if (shelly.status) device.status = shelly.status;
        if (shelly.settings) device.settings = shelly.settings;
        if (shelly.capabilities) device.capabilities = shelly.capabilities;
        if (shelly.meta) device.meta = shelly.meta;
        if (shelly.methods?.length) device.methods = shelly.methods;
        if (shelly.groupIds !== undefined) device.groupIds = shelly.groupIds;
        if (shelly.locationId !== undefined)
            device.locationId = shelly.locationId;
        if (shelly.tagIds !== undefined) device.tagIds = shelly.tagIds;
        if (shelly.id !== undefined && shelly.id !== null) {
            device.id = shelly.id;
            idToShellyMap.set(shelly.id, shelly.shellyID);
        }
    }

    // Drops in-flight predictions whose component shape may no longer exist.
    function clearOverlayFor(shellyID: string) {
        const bucket = optimisticOverlay[shellyID];
        if (!bucket) return;
        for (const key of Object.keys(bucket)) bucket[key].dispose();
    }

    // Backend does NOT emit Entity.Added/Removed during reconnect.
    // Diff old vs new entity IDs and sync the entity store.
    function syncEntityStore(oldEntityIds: string[], newEntityIds?: string[]) {
        if (newEntityIds === undefined) return;
        const oldSet = new Set(oldEntityIds);
        const newSet = new Set(newEntityIds);
        const removed = [...oldSet].filter((id) => !newSet.has(id));
        if (removed.length) entityStore().removeEntities(removed);
        addDeviceEntities(newEntityIds);
    }

    function addDeviceEntities(entityIds: string[]) {
        // An entity missing from the store means the bulk list has not landed
        // yet (boot race) or a device just gained one. Trigger the single
        // coalesced bulk load, never one entity.get per id — the refresh
        // coordinator dedupes concurrent calls, so a fleet-wide boot burst
        // collapses to one entity.list instead of N entity.get.
        const hasGap = entityIds.some((id) => !entityStore().entities[id]);
        if (hasGap) void entityStore().fetchEntities();
    }

    type DeviceRecordSnapshotField =
        | 'info'
        | 'status'
        | 'settings'
        | 'capabilities'
        | 'meta';

    function replaceDeviceRecordSnapshot(input: {
        device: shelly_device_t;
        field: DeviceRecordSnapshotField;
        snapshot: unknown;
    }): void {
        const owner = input.device as unknown as Record<string, any>;
        const current = owner[input.field];
        const snapshot =
            input.snapshot &&
            typeof input.snapshot === 'object' &&
            !Array.isArray(input.snapshot)
                ? input.snapshot
                : {};

        if (current && typeof current === 'object' && !Array.isArray(current)) {
            applySnapshot(current, snapshot);
        } else {
            owner[input.field] = snapshot;
        }
    }

    function replaceArrayContents<T>(target: T[], snapshot?: T[]): void {
        target.splice(0, target.length, ...(snapshot ?? []));
    }

    function replaceDeviceIdMapping(
        device: shelly_device_t,
        snapshot: ShellyDeviceExternal
    ): void {
        if (snapshot.id === undefined || snapshot.id === null) return;

        for (const [id, shellyID] of idToShellyMap) {
            if (shellyID === device.shellyID && id !== snapshot.id) {
                idToShellyMap.delete(id);
            }
        }
        device.id = snapshot.id;
        idToShellyMap.set(snapshot.id, snapshot.shellyID);
    }

    /** Reconcile a full Device.Get response, pruning state absent from it. */
    function replaceDeviceSnapshot(
        snapshot: ShellyDeviceExternal,
        guard?: DeviceSnapshotGuard
    ): void {
        const nextEntities = snapshot.entities ?? [];
        const existing = devices[snapshot.shellyID];
        const keepLiveState =
            !!existing &&
            guard?.shellyID === snapshot.shellyID &&
            hasLiveEventAfter(snapshot.shellyID, guard.liveEventSeq);

        beginBatch();
        try {
            if (!existing) {
                insertDevice({
                    shellyID: snapshot.shellyID,
                    source: normalizedDeviceSource(snapshot.source),
                    info: {},
                    status: {},
                    settings: {},
                    entities: [],
                    capabilities: {},
                    meta: {},
                    methods: [],
                    id: snapshot.id,
                    groupIds: [],
                    locationId: null,
                    tagIds: []
                });
            }

            const device = devices[snapshot.shellyID];
            if (!device) return;

            if (!keepLiveState) clearOverlayFor(snapshot.shellyID);
            const source = normalizedDeviceSource(snapshot.source);
            if (source) device.source = source;

            for (const field of [
                'info',
                'status',
                'settings',
                'capabilities',
                'meta'
            ] as const) {
                if (field === 'status' && keepLiveState) continue;
                replaceDeviceRecordSnapshot({
                    device,
                    field,
                    snapshot: snapshot[field]
                });
            }

            syncEntityStore(device.entities, nextEntities);
            replaceArrayContents(device.entities, nextEntities);
            replaceArrayContents(device.methods, snapshot.methods);
            replaceArrayContents(
                device.groupIds ?? (device.groupIds = []),
                snapshot.groupIds
            );
            replaceArrayContents(
                device.tagIds ?? (device.tagIds = []),
                snapshot.tagIds
            );
            device.locationId = snapshot.locationId ?? null;
            replaceDeviceIdMapping(device, snapshot);

            const timer = loadingTimers.get(snapshot.shellyID);
            if (timer) {
                clearTimeout(timer);
                loadingTimers.delete(snapshot.shellyID);
            }
            if (keepLiveState) device.loading = false;
            else applySleepState(device, snapshot);
            bumpVersion();
        } finally {
            endBatch();
        }
    }

    function deviceConnected(shelly: ShellyDeviceExternal) {
        debug(
            '[deviceConnected]',
            shelly.shellyID,
            'presence:',
            shelly.presence
        );
        markLiveDeviceEvent(shelly.shellyID);
        beginBatch();
        try {
            const device = devices[shelly.shellyID];
            if (device) {
                clearOverlayFor(shelly.shellyID);
                device.sleeping = false;
                setOnline(device, true);
                replaceDeviceData(device, shelly);
                syncEntityStore(device.entities, shelly.entities);
                if (shelly.entities?.length) device.entities = shelly.entities;
            } else {
                handleNewDevice(shelly);
            }
            bumpVersion();
        } finally {
            endBatch();
        }
    }

    function deviceDisconnected(shellyID: string) {
        debug('[deviceDisconnected]', shellyID);
        clearOverlayFor(shellyID);
        const device = devices[shellyID];
        if (!device) return;
        markLiveDeviceEvent(shellyID);

        const sleepOnline = isSleepingDeviceOnline(device);
        if (sleepOnline !== undefined) {
            device.sleeping = sleepOnline;
            setOnline(device, sleepOnline);
            debug(
                '[deviceDisconnected]',
                shellyID,
                'sleeping:',
                device.sleeping,
                'online:',
                device.online
            );
        } else {
            device.sleeping = false;
            setOnline(device, false);
        }
        bumpVersion();
    }

    function deviceDeleted(shellyID: string) {
        const timer = loadingTimers.get(shellyID);
        if (timer) {
            clearTimeout(timer);
            loadingTimers.delete(shellyID);
        }

        clearOverlayFor(shellyID);
        liveEventSeqByDevice.delete(shellyID);

        const device = devices[shellyID];
        if (device) {
            if (device.online) onlineCount.value--;
            entityStore().removeEntities(device.entities);
            idToShellyMap.delete(device.id);
        }

        delete devices[shellyID];
        bumpVersion();
    }

    async function sendRPC(
        shellyID: string,
        method: string,
        params?: any,
        options?: {timeoutMs?: number}
    ) {
        trackInteraction('rpc', 'send', method);
        return ws.sendRPC(shellyID, method, params, options);
    }

    function patchInfo(shellyID: string, info: any) {
        const device = devices[shellyID];
        if (device !== undefined) {
            debug('[patchInfo]', shellyID);
            applyPatch(device.info, info);
        }
    }

    function patchDeviceField(
        shellyID: string,
        field: 'status' | 'settings',
        data: any,
        partial = false
    ) {
        const device = devices[shellyID];
        if (!device) return;
        debug(`[patch${field[0].toUpperCase() + field.slice(1)}]`, shellyID);
        const previousBTHomeKeys = getBTHomeKeySet(device[field]);
        // Partial (dashboard) update: merge so unlisted components survive.
        // Full snapshot: reconcile and prune stale components.
        if (partial) applyPatch(device[field], data);
        else applySnapshot(device[field], data);
        const nextBTHomeKeys = getBTHomeKeySet(device[field]);

        if (didTopLevelKeysChange(previousBTHomeKeys, nextBTHomeKeys)) {
            bumpVersion();
        }
    }

    function patchStatus(shellyID: string, status: any, partial = false) {
        if (devices[shellyID]) markLiveDeviceEvent(shellyID);
        patchDeviceField(shellyID, 'status', status, partial);
        // Clear overlay only on confirming echo; stale echoes are ignored.
        if (status && typeof status === 'object' && !Array.isArray(status)) {
            const bucket = optimisticOverlay[shellyID];
            if (!bucket) return;
            for (const key of Object.keys(status)) {
                const overlay = bucket[key];
                if (overlay && echoConfirms(status[key], overlay.patch)) {
                    confirmOverlay(shellyID, key);
                }
            }
        }
    }

    // Optimistic overlay — predicted state separate from real; read via statusOf().

    interface OverlayEntry {
        commandIntentId: number;
        confirmed: boolean;
        patch: Record<string, any>;
        dispose(): void;
    }

    let nextCommandIntentId = 0;
    const latestIntentIds = new Map<string, number>();

    function latestIntentKey(shellyID: string, statusKey: string): string {
        return `${shellyID}\u0000${statusKey}`;
    }

    function rememberLatestIntent(
        shellyID: string,
        statusKey: string,
        commandIntentId: number
    ): void {
        latestIntentIds.set(
            latestIntentKey(shellyID, statusKey),
            commandIntentId
        );
    }

    function latestIntentIdFor(
        shellyID: string,
        statusKey: string
    ): number | undefined {
        return latestIntentIds.get(latestIntentKey(shellyID, statusKey));
    }

    function isCurrentOverlay(
        shellyID: string,
        statusKey: string,
        entry: OverlayEntry
    ): boolean {
        const current = optimisticOverlay[shellyID]?.[statusKey];
        return (
            current === entry &&
            current.commandIntentId === entry.commandIntentId
        );
    }

    const optimisticOverlay = reactive<
        Record<string, Record<string, OverlayEntry>>
    >({});

    function disposeOverlay(shellyID: string, statusKey: string): void {
        const bucket = optimisticOverlay[shellyID];
        if (!bucket) return;
        delete bucket[statusKey];
        if (Object.keys(bucket).length === 0)
            delete optimisticOverlay[shellyID];
    }

    function confirmOverlay(shellyID: string, statusKey: string): void {
        const overlay = optimisticOverlay[shellyID]?.[statusKey];
        if (!overlay) return;
        overlay.confirmed = true;
        overlay.dispose();
    }

    function echoConfirms(echoed: any, patch: any): boolean {
        if (Array.isArray(patch)) {
            if (!Array.isArray(echoed) || echoed.length !== patch.length) {
                return false;
            }
            for (let i = 0; i < patch.length; i++) {
                if (!echoConfirms(echoed[i], patch[i])) return false;
            }
            return true;
        }
        if (!patch || typeof patch !== 'object') {
            return echoed === patch;
        }
        if (!echoed || typeof echoed !== 'object' || Array.isArray(echoed)) {
            return false;
        }
        for (const k of Object.keys(patch)) {
            if (!echoConfirms(echoed[k], patch[k])) return false;
        }
        return true;
    }

    function mergeOverlay(real: any, patch: any): any {
        if (patch === undefined) return real;
        if (real === undefined) return patch;
        if (
            typeof patch !== 'object' ||
            patch === null ||
            Array.isArray(patch)
        ) {
            return patch;
        }
        if (typeof real !== 'object' || real === null || Array.isArray(real)) {
            return patch;
        }
        const merged: Record<string, any> = {...real};
        for (const k of Object.keys(patch)) {
            merged[k] = mergeOverlay(real[k], patch[k]);
        }
        return merged;
    }

    interface OptimisticHandle {
        isConfirmed(): boolean;
        isSuperseded(): boolean;
        isCurrent(): boolean;
        revert(): void;
    }

    function applyOptimistic(
        shellyID: string,
        statusKey: string,
        patch: Record<string, any>
    ): OptimisticHandle | null {
        // Tolerate missing real status — mergeOverlay handles undefined.
        if (!devices[shellyID]) return null;
        const real = devices[shellyID]?.status?.[statusKey];
        if (
            real !== undefined &&
            (typeof real !== 'object' || Array.isArray(real))
        ) {
            return null;
        }

        // Read the bucket through the proxy so mutations fire Vue triggers.
        if (!optimisticOverlay[shellyID]) {
            optimisticOverlay[shellyID] = {};
        }
        const bucket = optimisticOverlay[shellyID];

        const existing = bucket[statusKey];
        if (existing) existing.dispose();
        const commandIntentId = ++nextCommandIntentId;
        rememberLatestIntent(shellyID, statusKey, commandIntentId);

        // On timeout, release to live state — re-fetching re-applied stale cache.
        const reconcileTimer = setTimeout(() => {
            if (!isCurrentOverlay(shellyID, statusKey, entry)) return;
            disposeOverlay(shellyID, statusKey);
        }, UI_CONFIG.optimisticReconcileTimeoutMs);

        const reaperTimer = setTimeout(() => {
            if (isCurrentOverlay(shellyID, statusKey, entry)) {
                disposeOverlay(shellyID, statusKey);
            }
        }, UI_CONFIG.optimisticReaperMs);

        const entry: OverlayEntry = markRaw({
            commandIntentId,
            confirmed: false,
            patch,
            dispose() {
                clearTimeout(reconcileTimer);
                clearTimeout(reaperTimer);
                if (isCurrentOverlay(shellyID, statusKey, entry)) {
                    disposeOverlay(shellyID, statusKey);
                }
            }
        });
        bucket[statusKey] = entry;

        return {
            isConfirmed: () => entry.confirmed,
            isSuperseded: () =>
                latestIntentIdFor(shellyID, statusKey) !== commandIntentId,
            isCurrent: () => isCurrentOverlay(shellyID, statusKey, entry),
            revert: () => entry.dispose()
        };
    }

    // Real + overlay merged view — use this anywhere optimistic UI is desired.
    function statusOf(shellyID: string, statusKey: string): any {
        const real = devices[shellyID]?.status?.[statusKey];
        const overlay = optimisticOverlay[shellyID]?.[statusKey];
        if (!overlay) return real;
        return mergeOverlay(real, overlay.patch);
    }

    // In-flight command not yet echoed — block re-fires from invokeAction.
    function hasPendingOverlay(shellyID: string, statusKey: string): boolean {
        const overlay = optimisticOverlay[shellyID]?.[statusKey];
        return !!overlay && !overlay.confirmed;
    }

    function patchSettings(shellyID: string, settings: any) {
        patchDeviceField(shellyID, 'settings', settings);
    }

    function patchPresence(shellyID: string, presence: presence) {
        const device = devices[shellyID];
        if (!device) return;
        markLiveDeviceEvent(shellyID);

        if (presence === 'online') {
            device.sleeping = false;
            setOnline(device, true);
        } else {
            const sleepOnline = isSleepingDeviceOnline(device);
            device.sleeping = sleepOnline ?? false;
            setOnline(device, sleepOnline ?? false);
        }
        debug(
            '[patchPresence]',
            shellyID,
            'presence:',
            presence,
            'sleeping:',
            device.sleeping,
            '-> online:',
            device.online
        );
        bumpVersion();
    }

    function getDeviceName(shellyID: string): string | undefined {
        const device = devices[shellyID];
        if (device?.info?.name) {
            return device.info.name;
        }
        return undefined; // Return undefined if the device or name is not found
    }

    return {
        fetchDevices,
        reconcileDevicesFromBackend,
        refreshDevicesInBackground,
        seedFromBootstrap,
        deviceConnected,
        deviceDisconnected,
        deviceDeleted,
        getDevices,
        getDiscoveredDevices,
        patchInfo,
        patchSettings,
        patchStatus,
        applyOptimistic,
        hasPendingOverlay,
        statusOf,
        // patchKVS,
        patchPresence,
        sendRPC,
        selectedDevices,
        rpcResponses,
        clearRpcResponses,
        sendTemplateRpc,
        getDeviceName,
        beginBatch,
        endBatch,
        handleNewDevice,
        captureDeviceSnapshotGuard,
        replaceDeviceSnapshot,
        addOptimisticDevice,
        devices,
        initialLoadComplete,
        devicesVersion,
        onlineCount,
        idToShellyMap
    };
});
