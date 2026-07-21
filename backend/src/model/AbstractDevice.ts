import * as log4js from 'log4js';
import {tuning} from '../config/tuning';
import {appendDeviceFrame} from '../modules/device/IngestStream';
import * as ShellyEvents from '../modules/ShellyEvents';
import RpcError from '../rpc/RpcError';
import type {
    DeviceCapabilities,
    entity_t,
    PathChange,
    ShellyDeviceExternal,
    shelly_presence_t
} from '../types';
import {applyStatusProjection} from './curyVialProjection';
import {enrichCapabilities} from './deviceCapabilities';
import type {DeviceEventCatalog} from './deviceEventCatalog';
import type {DeviceInfo} from './deviceInfo';
import {buildProfile, type DeviceProfile} from './deviceProfile';
// Leaf file so coverage callers consume it without an init cycle.
import {NON_COMPONENT_KEYS} from './deviceStatusKeys';
import {mergeStatusAndDiff} from './statusMerge';
import type RpcTransport from './transport/RpcTransport';

export {
    type DeviceInfo,
    getServiceClaim,
    type ShellyJwtClaims,
    type ShellyServiceClaim
} from './deviceInfo';
export {
    buildProfile,
    classify,
    type DeviceProfile,
    type DeviceProfileFlags,
    type DeviceTribe,
    deriveFlags,
    extractComponentTypes
} from './deviceProfile';
export {NON_COMPONENT_KEYS} from './deviceStatusKeys';
export type {MergeDiffResult} from './statusMerge';
// Status merge + field-level diff lives in ./statusMerge so it can be
// unit-tested without dragging the AbstractDevice → ShellyDevice import
// graph (TDZ on circular references).
export {mergeStatusAndDiff, mergeStatusObjects} from './statusMerge';

const logger = log4js.getLogger('AbstractDevice');
const HAS_INSTANCE_SUFFIX = /:\d+$/;

/**
 * Normalize singleton component keys by adding :0 suffix.
 * Some devices (e.g. Wall Display) send component keys without instance suffix
 * ("media", "ui") while the entity system expects "media:0", "ui:0".
 * Only normalizes object-valued keys that aren't known non-component metadata.
 */
function normalizeComponentKeys(
    data: Record<string, any>
): Record<string, any> {
    const result: Record<string, any> = {};
    for (const key in data) {
        if (
            HAS_INSTANCE_SUFFIX.test(key) ||
            NON_COMPONENT_KEYS.has(key) ||
            typeof data[key] !== 'object' ||
            data[key] === null
        ) {
            result[key] = data[key];
        } else {
            result[`${key}:0`] = data[key];
        }
    }
    return result;
}

// Resolved-field projections (e.g. cury vials) run wherever status is stored,
// so every payload and broadcast carries them without per-caller wiring.
function projectAllComponentStatus(
    status: Record<string, any>
): Record<string, any> {
    for (const key in status) {
        status[key] = applyStatusProjection(key, status[key]);
    }
    return status;
}

export default abstract class AbstractDevice {
    public readonly shellyID: string;
    public readonly id: number;
    #reconnected: boolean;
    #transport?: RpcTransport;
    #presence: shelly_presence_t;
    #status: Record<string, any>;
    #info: DeviceInfo;
    #config: Record<string, any>;
    #entities: entity_t[];
    #capabilities: DeviceCapabilities;
    #methods: string[];
    protected _meta: Record<string, any>;
    #lastReportTs: number;
    // toJSON cache — version-based invalidation for O(1) cache hits
    #jsonCache: ShellyDeviceExternal | null = null;
    #jsonVersion = 0;
    #currentVersion = 1;
    // Profile cache — built lazily from info/status/config/capabilities;
    // invalidated by the same #currentVersion bump as toJSON.
    #profileCache: DeviceProfile | null = null;
    #profileVersion = 0;
    // Wire capabilities cache — same version-based invalidation.
    #wireCapabilitiesCache: DeviceCapabilities | null = null;
    #wireCapabilitiesVersion = 0;
    // Event catalog — populated by ShellyDeviceFactory on admission +
    // reconnect via Webhook.ListAllSupported. Undefined for legacy firmware.
    #eventCatalog: DeviceEventCatalog | undefined;

    constructor(
        shellyID: string,
        transport: RpcTransport | undefined,
        presence: shelly_presence_t,
        info: DeviceInfo,
        status: Record<string, any>,
        config: Record<string, any>,
        reconnected: boolean,
        id: number,
        lastReportTs = Date.now(),
        capabilities?: DeviceCapabilities,
        methods?: string[]
    ) {
        this.shellyID = shellyID;
        this.id = id;
        this.#presence = presence;
        this.#info = info;
        this.#status = projectAllComponentStatus(
            normalizeComponentKeys(status)
        );
        this.#config = normalizeComponentKeys(config);
        this.#reconnected = reconnected;
        this.#capabilities = capabilities ?? {};
        this.#methods = methods ?? [];
        this._meta = {};
        this.#entities = this.generateEntities();
        this.#lastReportTs = lastReportTs;
        // this emits online event
        this.setTransport(transport);
    }

    protected abstract onStateChange(): void;
    protected abstract onMessage(message: any, request?: any): void;

    // ----------------------------------------------------
    // Remote Procedure Call logic
    // ----------------------------------------------------

    // emitMessage: when true, the device's response is also re-emitted as a
    // 'message' event so onMessage processes it (the UI relay path). Default
    // false — the response only resolves the caller's promise.
    sendRPC(
        method: string,
        params?: any,
        emitMessage?: boolean,
        signal?: AbortSignal
    ): Promise<any> {
        if (!this.#transport) {
            // Typed Promise<any>: reject instead of throwing synchronously so
            // await/.catch() callers see the failure through the declared
            // contract, not as an uncaught throw on the calling stack.
            return Promise.reject(RpcError.DeviceNotFound());
        }

        return this.#transport.sendRPC(method, params, emitMessage, signal);
    }

    sendUnsafe(message: any) {
        return this.#transport?.sendUnsafe(message);
    }

    destroy(options?: {skipDeleteEvent?: boolean}) {
        if (this.#transport) {
            this.#transport.destroy();
            // Reconnect-replace / dup cleanup pass skipDeleteEvent — they
            // don't want the spurious disconnect that follows.
            this.setTransport(undefined, {
                emitDisconnect: !options?.skipDeleteEvent
            });
        }
    }

    // ----------------------------------------------------
    // Entities
    // ----------------------------------------------------

    addEntity(entity: entity_t) {
        if (this.#entities.some((en) => en.id === entity.id)) {
            logger.warn('Entity already exists', entity);
            return;
        }

        logger.info('Entity added', entity);

        this.#entities.push(entity);
        ShellyEvents.emitEntityAdded(entity);
    }

    removeEntity(entity: entity_t) {
        const index = this.#entities.findIndex((en) => en.id === entity.id);
        if (index === -1) {
            return;
        }

        this.#entities.splice(index, 1);
        ShellyEvents.emitEntityRemoved(entity);
    }

    /**
     * Update the name of an entity based on a component config change.
     * Called when a component's config is updated (e.g., via SetConfig).
     * @param componentKey The component key (e.g., 'switch:0', 'light:0')
     * @param config The new config object
     */
    updateEntityNameFromConfig(componentKey: string, config: any) {
        if (typeof config?.name !== 'string') {
            return; // No name in config, nothing to update
        }

        // Parse component type and ID from key (e.g., 'switch:0' -> type='switch', id=0)
        const separatorIndex = componentKey.indexOf(':');
        const componentType =
            separatorIndex > -1
                ? componentKey.slice(0, separatorIndex)
                : componentKey;
        const componentId =
            separatorIndex > -1
                ? Number.parseInt(componentKey.slice(separatorIndex + 1), 10)
                : 0;

        // Find matching entity - entities may have different type suffixes
        // e.g., switch entities have ':out' suffix, others use the component type directly
        const entity = this.#entities.find((e) => {
            if (e.properties.id !== componentId) return false;
            // Check if entity type matches component type or known mappings
            if (e.type === componentType) return true;
            // Entity ID contains the component type information
            if (e.id.endsWith(`:${componentType}`)) return true;
            if (e.id.endsWith(':out') && componentType === 'switch')
                return true;
            return false;
        });

        if (entity && entity.name !== config.name) {
            logger.info(
                'Updating entity name from "%s" to "%s" for %s',
                entity.name,
                config.name,
                entity.id
            );
            entity.name = config.name;
            this.onStateChange();
        }
    }

    protected abstract generateEntities(): entity_t[];
    protected abstract findMessageReason(key: string, message: any): string;

    // ----------------------------------------------------
    // Components
    // ----------------------------------------------------

    setComponentConfig(key: string, config: any) {
        this.#config[key] = config;
        this.#currentVersion++;
        // Update entity name if config contains a name property
        this.updateEntityNameFromConfig(key, config);
        ShellyEvents.emitShellySettings(this);
        this.onStateChange();
    }

    setComponentStatus(key: string, status: any) {
        const {merged, changes} = mergeStatusAndDiff(
            this.#status?.[key],
            status,
            key
        );
        this.#status[key] = applyStatusProjection(key, merged);
        this.#currentVersion++;

        // Emit the whole status for each component update in order to have the correct reason
        const reason = this.findMessageReason(key, status);
        ShellyEvents.emitShellyStatus(this, reason, changes);

        this.onStateChange();
    }

    protected setRuntimeComponentStatus(
        key: string,
        status: any,
        reason?: string | string[]
    ) {
        const {merged, changes} = mergeStatusAndDiff(
            this.#status?.[key],
            status,
            key
        );
        this.#status[key] = applyStatusProjection(key, merged);
        this.#currentVersion++;

        ShellyEvents.emitShellyStatus(
            this,
            reason ?? this.findMessageReason(key, status),
            changes
        );
    }

    /**
     * Batch-update multiple component statuses and emit a single event.
     * Reduces N processAndNotifyAll calls to 1 per device message.
     * Returns the field-level changes so the flush path can read prev
     * values from the in-event diff (Phase 2.2a — eliminates the per-
     * field fn_status_last_value N+1 in ShellyMessageHandler).
     */
    batchSetComponentStatus(data: Record<string, any>): PathChange[] {
        const normalized = normalizeComponentKeys(data);
        const reasons: string[] = [];
        const allChanges: PathChange[] = [];
        for (const key in normalized) {
            const {merged} = mergeStatusAndDiff(
                this.#status?.[key],
                normalized[key],
                key,
                allChanges
            );
            this.#status[key] = applyStatusProjection(key, merged);
            reasons.push(this.findMessageReason(key, normalized[key]));
        }
        this.#currentVersion++;
        // Emit once with all reasons — EventDistributor matches if ANY reason fits
        ShellyEvents.emitShellyStatus(this, reasons, allChanges);
        this.onStateChange();
        return allChanges;
    }

    public removeComponent(key: string) {
        const removedValue = this.#status[key];
        delete this.#status[key];
        delete this.#config[key];
        this.#currentVersion++;
        this.onStateChange();
        ShellyEvents.emitShellySettings(this);
        // Removed key counts as a change at that component path so
        // path-filtered subscribers see the removal as a delta.
        ShellyEvents.emitShellyStatus(this, 'shelly:generic', [
            {path: key, prev: removedValue, next: undefined}
        ]);
    }

    // ----------------------------------------------------
    // Getters and Setters
    // ----------------------------------------------------

    public setTransport(
        transport: RpcTransport | undefined,
        options?: {emitDisconnect?: boolean}
    ) {
        if (transport === undefined) {
            if (!this.#transport) {
                // we are already offline, do nothing
                return;
            }
            this.#transport = undefined;
            this.#presence = 'offline';
            this.#currentVersion++;
            // Suppressed on reconnect-replace — the fresh connection already
            // emitted connected, so a disconnect here is a spurious flicker.
            if (options?.emitDisconnect !== false) {
                ShellyEvents.emitShellyDisconnected(this);
            }
            return;
        }
        // Replacing a live transport: destroy it (frees its sweep timer +
        // rejects pending RPCs), don't just detach our listeners.
        if (this.#transport) {
            this.#transport.eventemitter.removeAllListeners();
            this.#transport.destroy();
        }
        this.#transport = transport;
        this.#presence = 'online';
        this.#currentVersion++;

        this.#transport.eventemitter.on('close', () => {
            if (!this.#reconnected) {
                this.setPresence('offline');
            }
            this.#reconnected = false;
            this.setTransport(undefined);
        });
        this.#transport.eventemitter.on('message', (msg, req) => {
            this.#lastReportTs = Date.now();
            // Phase E forensic capture — adapter handles disabled case.
            // Capture is opt-in via tuning.ingest.capture, so a failure
            // here means the operator explicitly turned it on; log so the
            // missing data is debuggable instead of silently absent.
            if (tuning.ingest.capture) {
                void appendDeviceFrame(this.shellyID, {
                    msg: JSON.stringify(msg),
                    req: req ? JSON.stringify(req) : '',
                    ts: String(this.#lastReportTs)
                }).catch((err) => {
                    logger.warn(
                        'forensic capture failed shellyID=%s: %s',
                        this.shellyID,
                        err
                    );
                });
            }
            // A poison frame from one device must not crash the process — log
            // and drop it so other devices and tenants stay up.
            try {
                this.onMessage(msg, req);
            } catch (err) {
                logger.error(
                    'device message handler threw shellyID=%s: %s',
                    this.shellyID,
                    err
                );
            }
        });
        this.#transport.eventemitter.on('err', (e) => {
            console.warn(
                'Internal Transport Error shellyID:[%s]',
                this.shellyID,
                e
            );
        });

        ShellyEvents.emitShellyConnected(this);
    }

    setStatus(status: any, reason = 'shelly:generic') {
        const normalized = normalizeComponentKeys(status);
        const allChanges: PathChange[] = [];
        for (const key in normalized) {
            const {merged} = mergeStatusAndDiff(
                this.#status?.[key],
                normalized[key],
                key,
                allChanges
            );
            this.#status[key] = applyStatusProjection(key, merged);
        }
        this.#currentVersion++;
        this.onStateChange();
        ShellyEvents.emitShellyStatus(this, reason, allChanges);
    }

    setConfig(config: any) {
        this.#config = config;
        this.#currentVersion++;
        this.onStateChange();
        ShellyEvents.emitShellySettings(this);
    }

    setPresence(presence: shelly_presence_t) {
        this.#presence = presence;
        this.#currentVersion++;
        this.onStateChange();
        ShellyEvents.emitShellyPresence(this);
    }

    setInfo(info: DeviceInfo) {
        const oldProfile = this.#info?.profile;
        this.#info = info;
        this.#currentVersion++;

        // Profile changed (e.g. 3EM monophase↔triphase, 2PM switch↔cover)
        // → regenerate entities so the UI gets the new component set
        if (info.profile && info.profile !== oldProfile) {
            logger.info(
                '%s profile changed %s → %s, regenerating entities',
                this.shellyID,
                oldProfile,
                info.profile
            );
            const oldEntities = [...this.#entities];
            this.#entities = this.generateEntities();
            // Emit removal of old entities and addition of new ones
            for (const e of oldEntities) ShellyEvents.emitEntityRemoved(e);
            for (const e of this.#entities) ShellyEvents.emitEntityAdded(e);
        }

        this.onStateChange();
        ShellyEvents.emitShellyDeviceInfo(this);
    }

    toJSON(): ShellyDeviceExternal {
        if (this.#jsonCache && this.#jsonVersion === this.#currentVersion) {
            return this.#jsonCache;
        }

        const result: ShellyDeviceExternal = {
            shellyID: this.shellyID,
            id: this.id,
            source: this.transport?.name || 'offline',
            info: this.#info,
            status: this.#status,
            presence: this.#presence,
            settings: this.#config,
            entities: this.#entities.map((entity) => entity.id),
            capabilities: this.wireCapabilities,
            methods: this.#methods,
            meta: {lastReportTs: this.#lastReportTs},
            profile: this.profile,
            ...(this.#lastSeenSleepingMs !== undefined
                ? {lastSeenSleepingMs: this.#lastSeenSleepingMs}
                : {})
        };

        this.#jsonCache = result;
        this.#jsonVersion = this.#currentVersion;
        return result;
    }

    /**
     * Slim serialization for device list views.
     * Returns only the fields needed to render list/table UI —
     * full status and settings are omitted to reduce payload size.
     */
    toListJSON(details?: Set<string>): ShellyDeviceExternal {
        // "status" detail = return full status, skip slim building
        if (details?.has('status')) {
            return {
                shellyID: this.shellyID,
                id: this.id,
                source: this.transport?.name || 'offline',
                info: this.#info,
                status: {...this.#status},
                presence: this.#presence,
                settings: details.has('settings')
                    ? {...this.#config}
                    : this.#buildSlimSettings(),
                entities: this.#entities.map((entity) => entity.id),
                capabilities: this.wireCapabilities,
                methods: this.#methods,
                meta: {lastReportTs: this.#lastReportTs},
                ...(this.#lastSeenSleepingMs !== undefined
                    ? {lastSeenSleepingMs: this.#lastSeenSleepingMs}
                    : {})
            };
        }

        const status = this.#status;
        const slimStatus: Record<string, any> = {};

        // Battery/online detection fields
        if (status.ts != null) slimStatus.ts = status.ts;
        if (status.sys) {
            // "sys" detail = include full sys object
            if (details?.has('sys')) {
                slimStatus.sys = status.sys;
            } else {
                slimStatus.sys = {};
                if (status.sys.unixtime != null)
                    slimStatus.sys.unixtime = status.sys.unixtime;
                if (status.sys.wakeup_period != null)
                    slimStatus.sys.wakeup_period = status.sys.wakeup_period;
                if (status.sys.available_updates != null)
                    slimStatus.sys.available_updates =
                        status.sys.available_updates;
            }
        }
        // Battery level (non-indexed key)
        if (status.devicepower) slimStatus.devicepower = status.devicepower;

        // Connectivity summary — the settings modal shows per-transport state
        // (nav dots, section badges) before the full device payload loads.
        const wifi = status.wifi;
        if (wifi) {
            slimStatus.wifi = {};
            if (wifi.status != null) slimStatus.wifi.status = wifi.status;
            if (wifi.sta_ip != null) slimStatus.wifi.sta_ip = wifi.sta_ip;
            if (wifi.ssid != null) slimStatus.wifi.ssid = wifi.ssid;
            if (wifi.rssi != null) slimStatus.wifi.rssi = wifi.rssi;
        }
        if (status.eth?.ip != null) slimStatus.eth = {ip: status.eth.ip};
        for (const key of ['cloud', 'mqtt', 'ws'] as const) {
            if (status[key]?.connected != null) {
                slimStatus[key] = {connected: status[key].connected};
            }
        }

        // All component status (switch:0, light:0, cover:0, devicepower:0, etc.)
        // Keyed with "type:id" — needed by dashboard/entity widgets for controls
        for (const key in status) {
            if (key.includes(':')) slimStatus[key] = status[key];
        }

        // Optional detail sections — network, connectivity, protocols
        if (details) {
            for (const detail of details) {
                if (
                    detail !== 'sys' &&
                    detail !== 'status' &&
                    detail !== 'settings' &&
                    status[detail] != null
                ) {
                    slimStatus[detail] = status[detail];
                }
            }
        }

        return {
            shellyID: this.shellyID,
            id: this.id,
            source: this.transport?.name || 'offline',
            info: this.#info,
            status: slimStatus,
            presence: this.#presence,
            settings: details?.has('settings')
                ? this.#config
                : this.#buildSlimSettings(),
            entities: this.#entities.map((entity) => entity.id),
            capabilities: this.wireCapabilities,
            methods: this.#methods,
            meta: {lastReportTs: this.#lastReportTs},
            profile: this.profile,
            ...(this.#lastSeenSleepingMs !== undefined
                ? {lastSeenSleepingMs: this.#lastSeenSleepingMs}
                : {})
        };
    }

    #buildSlimSettings(): Record<string, any> {
        const config = this.#config;
        const slim: Record<string, any> = {};
        for (const key in config) {
            if (key.startsWith('bthomedevice:')) {
                const c = config[key];
                slim[key] = {
                    addr: c?.addr,
                    name: c?.name,
                    productName: c?.meta?.productName,
                    modelId: c?.meta?.modelId,
                    modelNumericId: c?.meta?.modelNumericId,
                    localName: c?.meta?.localName,
                    isRemote: c?.meta?.isRemote,
                    controls: c?.meta?.controls,
                    meta: {
                        productName: c?.meta?.productName,
                        modelId: c?.meta?.modelId,
                        modelNumericId: c?.meta?.modelNumericId,
                        localName: c?.meta?.localName,
                        isRemote: c?.meta?.isRemote,
                        controls: c?.meta?.controls
                    }
                };
            } else if (key.startsWith('blutrv:')) {
                const c = config[key];
                slim[key] = {
                    id: c?.id,
                    addr: c?.addr,
                    name: c?.name,
                    trv: c?.trv,
                    temp_sensors: c?.temp_sensors,
                    dw_sensors: c?.dw_sensors,
                    override_delay: c?.override_delay
                };
            } else if (key.startsWith('bthomesensor:')) {
                const c = config[key];
                slim[key] = {
                    id: c?.id,
                    addr: c?.addr,
                    obj_id: c?.obj_id,
                    idx: c?.idx ?? c?.obj_idx,
                    name: c?.name
                };
            } else if (key.startsWith('presencezone:')) {
                const c = config[key];
                slim[key] = {
                    id: c?.id,
                    name: c?.name,
                    enable: c?.enable,
                    color: c?.color,
                    area: c?.area
                };
            } else if (key.startsWith('thermostat:')) {
                const c = config[key];
                slim[key] = {
                    id: c?.id,
                    type: c?.type,
                    enable: c?.enable,
                    target_C: c?.target_C,
                    display_unit: c?.display_unit
                };
            } else if (key === 'presence' || key === 'presence:0') {
                const c = config[key];
                slim[key] = {
                    enable: c?.enable,
                    num_tracks: c?.num_tracks,
                    zmin: c?.zmin,
                    zmax: c?.zmax,
                    main_zone: c?.main_zone,
                    sensor: c?.sensor
                        ? {
                              position: c.sensor.position,
                              sensitivity: c.sensor.sensitivity,
                              power: c.sensor.power,
                              height: c.sensor.height,
                              tilt: c.sensor.tilt
                          }
                        : undefined
                };
            } else {
                // Only BTHome-style fan-out lists are slimmed.
                slim[key] = config[key];
            }
        }
        return slim;
    }

    get meta() {
        return this._meta;
    }

    get presence() {
        return this.#presence;
    }

    // Last inbound message time, stamped on every frame. Read by the alert
    // RuleSweep for heartbeat (telemetry-stopped) detection.
    get lastReportTs(): number {
        return this.#lastReportTs;
    }

    set reconnected(reconnected: boolean) {
        this.#reconnected = reconnected;
    }

    get entities(): readonly entity_t[] {
        return this.#entities;
    }

    get info() {
        return this.#info;
    }

    get status() {
        return this.#status;
    }

    get config() {
        return this.#config;
    }

    get capabilities(): DeviceCapabilities {
        return this.#capabilities;
    }

    /** Capabilities as sent on the wire — base RPC-derived caps enriched
     *  with fields the device announces (restore method set, addon services,
     *  UI feature flags). Cached per #currentVersion. */
    get wireCapabilities(): DeviceCapabilities {
        if (
            this.#wireCapabilitiesCache &&
            this.#wireCapabilitiesVersion === this.#currentVersion
        ) {
            return this.#wireCapabilitiesCache;
        }
        const built = enrichCapabilities({
            base: this.#capabilities,
            info: this.#info,
            status: this.#status,
            config: this.#config,
            methods: this.#methods
        });
        this.#wireCapabilitiesCache = built;
        this.#wireCapabilitiesVersion = this.#currentVersion;
        return built;
    }

    setCapabilities(capabilities: DeviceCapabilities) {
        this.#capabilities = capabilities;
        this.#currentVersion++;
        this.onStateChange();
    }

    get eventCatalog(): DeviceEventCatalog | undefined {
        return this.#eventCatalog;
    }

    setEventCatalog(catalog: DeviceEventCatalog | undefined): void {
        this.#eventCatalog = catalog;
        this.#currentVersion++;
    }

    // Battery devices send `sys.sleep` before going to sleep. The timestamp
    // is exposed for read paths (e.g. "last seen sleeping 2m ago") and is
    // distinct from #presence ('offline' means disconnected for any reason).
    #lastSeenSleepingMs: number | undefined = undefined;

    get lastSeenSleepingMs(): number | undefined {
        return this.#lastSeenSleepingMs;
    }

    setLastSeenSleeping(ms: number): void {
        this.#lastSeenSleepingMs = ms;
        this.#currentVersion++;
    }

    /** DeviceProfile is the device-driven view (tribe + componentTypes +
     *  derived flags). Cached per #currentVersion; rebuilds on any change to
     *  info/status/config/capabilities. */
    get profile(): DeviceProfile {
        if (
            this.#profileCache &&
            this.#profileVersion === this.#currentVersion
        ) {
            return this.#profileCache;
        }
        const built = buildProfile({
            info: this.#info,
            status: this.#status,
            config: this.#config,
            capabilities: this.#capabilities,
            nowMs: Date.now()
        });
        this.#profileCache = built;
        this.#profileVersion = this.#currentVersion;
        return built;
    }

    get methods(): string[] {
        return this.#methods;
    }

    setMethods(methods: string[]) {
        this.#methods = methods;
        this.#currentVersion++;
        this.onStateChange();
    }

    get source() {
        return this.#transport?.name;
    }

    get transport() {
        return this.#transport;
    }

    get online() {
        return !!this.#transport;
    }
}
