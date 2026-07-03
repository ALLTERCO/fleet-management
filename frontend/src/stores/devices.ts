import {defineStore} from 'pinia';
import {computed, markRaw, reactive, ref} from 'vue';
import {UI_CONFIG} from '@/config/ui';
import {isDiscovered} from '@/helpers/device';
import {debug} from '@/tools/debug';
import {trackInteraction} from '@/tools/observability';
import type {
    DeviceCapabilities,
    presence,
    ShellyDeviceExternal,
    shelly_device_t
} from '@/types';
import * as ws from '../tools/websocket';
import {useEntityStore} from './entities';
import {createRefreshCoordinator} from './refreshCoordinator';

/**
 * Apply a patch to a reactive target object in place.
 * Only changed leaf values trigger Vue reactivity updates.
 * Arrays and primitives are replaced entirely; nested objects are recursed.
 */
function applyPatch(target: any, patch: any): void {
    if (!target || typeof target !== 'object' || Array.isArray(target)) return;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return;
    for (const key of Object.keys(patch)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype')
            continue;
        const patchVal = patch[key];
        const targetVal = target[key];
        if (
            patchVal &&
            typeof patchVal === 'object' &&
            !Array.isArray(patchVal) &&
            targetVal &&
            typeof targetVal === 'object' &&
            !Array.isArray(targetVal)
        ) {
            applyPatch(targetVal, patchVal);
        } else if (targetVal !== patchVal) {
            target[key] = patchVal;
        }
    }
}

/**
 * Reconcile a reactive object with a full snapshot.
 * Missing keys are removed, nested objects are synced recursively,
 * arrays/primitives are replaced.
 */
function applySnapshot(target: any, snapshot: any): void {
    if (
        !target ||
        typeof target !== 'object' ||
        Array.isArray(target) ||
        !snapshot ||
        typeof snapshot !== 'object' ||
        Array.isArray(snapshot)
    ) {
        return;
    }

    for (const key of Object.keys(target)) {
        if (
            key === '__proto__' ||
            key === 'constructor' ||
            key === 'prototype'
        ) {
            continue;
        }
        if (!(key in snapshot)) {
            delete target[key];
        }
    }

    for (const key of Object.keys(snapshot)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype')
            continue;
        const snapshotVal = snapshot[key];
        const targetVal = target[key];
        if (
            snapshotVal &&
            typeof snapshotVal === 'object' &&
            !Array.isArray(snapshotVal) &&
            targetVal &&
            typeof targetVal === 'object' &&
            !Array.isArray(targetVal)
        ) {
            applySnapshot(targetVal, snapshotVal);
        } else if (targetVal !== snapshotVal) {
            target[key] = snapshotVal;
        }
    }
}

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
    const sensorDataVersion = ref(0);
    const devicesVersion = ref(0);
    const onlineCount = ref(0);
    const idToShellyMap = new Map<number, string>();
    let _bulkLoading = false;
    let _batchMode = false;
    let _batchDirty = false;

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

    function clearRpcResponses() {
        rpcResponses.value = {};
    }

    function sendTemplateRpc(method: string, params?: object) {
        // Clear old results
        rpcResponses.value = {};
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
        try {
            rpcResponses.value[input.shellyID] = await ws.sendRPC(
                input.shellyID,
                input.method,
                input.params
            );
        } catch (error) {
            debug('[sendTemplateRpc] RPC failed', {
                shellyID: input.shellyID,
                error
            });
        }
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
        // Collect all chunks first (parallel network), then process in one synchronous pass
        // This avoids 8 separate Vue reactive cascades (one per chunk arrival)
        const allDevices: import('@/types').ShellyDeviceExternal[] = [];
        await ws.listDevicesChunked((chunk) => {
            allDevices.push(...chunk);
        });
        debug(
            '[fetchDevices] network done:',
            allDevices.length,
            'devices in',
            Math.round(performance.now() - t0),
            'ms'
        );
        // Suppress per-device version bumps & loading timers during bulk insert
        _bulkLoading = true;
        for (const device of allDevices) {
            handleNewDevice(device);
        }
        _bulkLoading = false;
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

    function updateExistingDevice(existing: any, shelly: ShellyDeviceExternal) {
        debug('[handleNewDevice] UPDATE', shelly.shellyID);
        const source = normalizedDeviceSource(shelly.source);
        if (source) existing.source = source;
        if (shelly.info) applyPatch(existing.info, shelly.info);
        if (shelly.status) applyPatch(existing.status, shelly.status);
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

    function handleNewDevice(shelly: ShellyDeviceExternal) {
        const existing = devices[shelly.shellyID];
        if (existing) updateExistingDevice(existing, shelly);
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

        applySleepState(d, shelly);
    }

    // Optimistic: show a just-accepted device now; the real build merges over it.
    function addOptimisticDevice(
        shellyID: string,
        status: ShellyDeviceExternal['status']
    ): void {
        if (devices[shellyID]) return; // never clobber a real/known device
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
        addDeviceEntities(newEntityIds, oldSet);
    }

    function addDeviceEntities(
        entityIds: string[],
        knownEntityIds = new Set<string>()
    ) {
        for (const id of entityIds) {
            if (!knownEntityIds.has(id) || !entityStore().entities[id]) {
                entityStore().addEntity(id);
            }
        }
    }

    function deviceConnected(shelly: ShellyDeviceExternal) {
        debug(
            '[deviceConnected]',
            shelly.shellyID,
            'presence:',
            shelly.presence
        );
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

    interface SwitchOutputCommand {
        shellyID: string;
        id: number;
    }

    async function toggleSwitchOutput(command: SwitchOutputCommand) {
        const statusKey = switchStatusKey(command.id);
        const handle = predictedSwitchToggle(command.shellyID, statusKey);
        try {
            return await ws.sendRPC('FLEET_MANAGER', 'Switch.Toggle', command);
        } catch (err) {
            if (handle && shouldIgnoreOptimisticFailure(handle)) return;
            handle?.revert();
            throw err;
        }
    }

    function switchStatusKey(id: number): string {
        return `switch:${id}`;
    }

    function predictedSwitchToggle(
        shellyID: string,
        statusKey: string
    ): OptimisticHandle | null {
        const current = statusOf(shellyID, statusKey);
        if (!current || typeof current.output !== 'boolean') {
            return null;
        }
        return applyOptimistic(shellyID, statusKey, {
            output: !current.output
        });
    }

    function getSelected() {
        return Object.values(devices).filter((dev) => dev.selected);
    }

    function patchInfo(shellyID: string, info: any) {
        const device = devices[shellyID];
        if (device !== undefined) {
            debug('[patchInfo]', shellyID);
            applyPatch(device.info, info);
        }
    }

    let _sensorBumpTimer: ReturnType<typeof setTimeout> | undefined;
    function scheduleSensorBump() {
        if (_sensorBumpTimer) return;
        _sensorBumpTimer = setTimeout(() => {
            _sensorBumpTimer = undefined;
            sensorDataVersion.value++;
        }, 100);
    }

    function patchDeviceField(
        shellyID: string,
        field: 'status' | 'settings',
        data: any
    ) {
        const device = devices[shellyID];
        if (!device) return;
        debug(`[patch${field[0].toUpperCase() + field.slice(1)}]`, shellyID);
        const previousBTHomeKeys = getBTHomeKeySet(device[field]);
        applySnapshot(device[field], data);
        const nextBTHomeKeys = getBTHomeKeySet(device[field]);

        if (nextBTHomeKeys.size > 0 || previousBTHomeKeys.size > 0) {
            scheduleSensorBump();
        }
        if (didTopLevelKeysChange(previousBTHomeKeys, nextBTHomeKeys)) {
            bumpVersion();
        }
    }

    function patchStatus(shellyID: string, status: any) {
        patchDeviceField(shellyID, 'status', status);
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

    function shouldIgnoreOptimisticFailure(handle: OptimisticHandle): boolean {
        return handle.isConfirmed() || handle.isSuperseded();
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
        toggleSwitchOutput,
        // patchKVS,
        patchPresence,
        sendRPC,
        getSelected,
        selectedDevices,
        rpcResponses,
        clearRpcResponses,
        sendTemplateRpc,
        getDeviceName,
        beginBatch,
        endBatch,
        handleNewDevice,
        addOptimisticDevice,
        devices,
        initialLoadComplete,
        sensorDataVersion,
        devicesVersion,
        onlineCount,
        idToShellyMap
    };
});
