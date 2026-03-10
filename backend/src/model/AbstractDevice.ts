import * as log4js from 'log4js';
import * as ShellyEvents from '../modules/ShellyEvents';
import RpcError from '../rpc/RpcError';
import type {ShellyDeviceExternal, entity_t, shelly_presence_t} from '../types';
/* eslint-disable no-dupe-class-members */
import type RpcTransport from './transport/RpcTransport';

const logger = log4js.getLogger('AbstractDevice');

interface DeviceInfo extends Record<string, string | number> {
    id: string;
    mac: string;
    model: string;
    gen: number;
    fw_id: string;
    ver: string;
    app: string;
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
    protected _meta: Record<string, any>;
    #lastReportTs: number;
    // toJSON cache — version-based invalidation for O(1) cache hits
    #jsonCache: ShellyDeviceExternal | null = null;
    #jsonVersion = 0;
    #currentVersion = 1;

    constructor(
        shellyID: string,
        transport: RpcTransport | undefined,
        presence: shelly_presence_t,
        info: DeviceInfo,
        status: Record<string, any>,
        config: Record<string, any>,
        reconnected: boolean,
        id: number,
        lastReportTs = Date.now()
    ) {
        this.shellyID = shellyID;
        this.id = id;
        this.#presence = presence;
        this.#info = info;
        this.#status = status;
        this.#config = config;
        this.#reconnected = reconnected;
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

    sendRPC(method: string, params?: any, silent?: boolean): Promise<any> {
        if (!this.#transport) {
            throw RpcError.DeviceNotFound();
        }

        return this.#transport.sendRPC(method, params, silent);
    }

    sendUnsafe(message: any) {
        return this.#transport?.sendUnsafe(message);
    }

    destroy(options?: {skipDeleteEvent?: boolean}) {
        if (this.#transport) {
            this.#transport.destroy();
            this.setTransport(undefined);
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
            if (componentType === 'switch' && e.type === 'switch') return true;
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
        this.#status[key] = mergeStatusObjects(this.#status?.[key], status);
        this.#currentVersion++;

        // Emit the whole status for each component update in order to have the correct reason
        const reason = this.findMessageReason(key, status);
        ShellyEvents.emitShellyStatus(this, reason);

        this.onStateChange();
    }

    /**
     * Batch-update multiple component statuses and emit a single event.
     * Reduces N processAndNotifyAll calls to 1 per device message.
     */
    batchSetComponentStatus(data: Record<string, any>) {
        const reasons: string[] = [];
        for (const key in data) {
            this.#status[key] = mergeStatusObjects(
                this.#status?.[key],
                data[key]
            );
            reasons.push(this.findMessageReason(key, data[key]));
        }
        this.#currentVersion++;
        // Emit once with all reasons — EventDistributor matches if ANY reason fits
        ShellyEvents.emitShellyStatus(this, reasons);
        this.onStateChange();
    }

    public removeComponent(key: string) {
        delete this.#status[key];
        delete this.#config[key];
        this.#currentVersion++;
        this.onStateChange();
        ShellyEvents.emitShellySettings(this);
        ShellyEvents.emitShellyStatus(this, 'shelly:generic');
    }

    // ----------------------------------------------------
    // Getters and Setters
    // ----------------------------------------------------

    public setTransport(transport: RpcTransport | undefined) {
        if (transport === undefined) {
            if (!this.#transport) {
                // we are already offline, do nothing
                return;
            }
            this.#transport = undefined;
            this.#presence = 'offline';
            this.#currentVersion++;
            ShellyEvents.emitShellyDisconnected(this);
            return;
        }
        // Set presence to online before emitting the connect event
        // so that toJSON() returns the correct presence value
        this.#presence = 'online';
        this.#currentVersion++;
        // Send online event
        ShellyEvents.emitShellyConnected(this);

        // remove all from old transport
        this.#transport?.eventemitter.removeAllListeners();
        // add new transport and subscribe to transport's events
        this.#transport = transport;
        this.#transport.eventemitter.on('close', () => {
            if (!this.#reconnected) {
                this.setPresence('offline');
            }
            this.#reconnected = false;
            this.setTransport(undefined);
        });
        this.#transport.eventemitter.on('message', (msg, req) => {
            this.#lastReportTs = Date.now();
            this.onMessage(msg, req);
        });
        this.#transport.eventemitter.on('err', (e) => {
            console.warn(
                'Internal Transport Error shellyID:[%s]',
                this.shellyID,
                e
            );
        });
    }

    setStatus(status: any, reason = 'shelly:generic') {
        for (const key in status) {
            this.#status[key] = mergeStatusObjects(
                this.#status?.[key],
                status[key]
            );
        }
        this.#currentVersion++;
        this.onStateChange();
        ShellyEvents.emitShellyStatus(this, reason);
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
        this.#info = info;
        this.#currentVersion++;
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
            meta: {lastReportTs: this.#lastReportTs}
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
    toListJSON(): ShellyDeviceExternal {
        const status = this.#status;
        const slimStatus: Record<string, any> = {};

        // Battery/online detection fields
        if (status.ts != null) slimStatus.ts = status.ts;
        if (status.sys) {
            slimStatus.sys = {};
            if (status.sys.unixtime != null)
                slimStatus.sys.unixtime = status.sys.unixtime;
            if (status.sys.wakeup_period != null)
                slimStatus.sys.wakeup_period = status.sys.wakeup_period;
            if (status.sys.available_updates != null)
                slimStatus.sys.available_updates = status.sys.available_updates;
        }
        // Battery level (non-indexed key)
        if (status.devicepower) slimStatus.devicepower = status.devicepower;

        // All component status (switch:0, light:0, cover:0, devicepower:0, etc.)
        // Keyed with "type:id" — needed by dashboard/entity widgets for controls
        for (const key in status) {
            if (key.includes(':')) slimStatus[key] = status[key];
        }

        // BT Home device addresses only
        const config = this.#config;
        const slimSettings: Record<string, any> = {};
        for (const key in config) {
            if (key.startsWith('bthomedevice:')) {
                slimSettings[key] = {addr: config[key]?.addr};
            }
        }

        return {
            shellyID: this.shellyID,
            id: this.id,
            source: this.transport?.name || 'offline',
            info: this.#info,
            status: slimStatus,
            presence: this.#presence,
            settings: slimSettings,
            entities: this.#entities.map((entity) => entity.id),
            meta: {lastReportTs: this.#lastReportTs}
        };
    }

    get meta() {
        return this._meta;
    }

    get presence() {
        return this.#presence;
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

//#region Helpers

export function mergeStatusObjects(original: any, patch: any): any {
    if (patch === undefined) return original;

    const origIsObj = typeof original === 'object' && original != null;
    const patchIsObj = typeof patch === 'object' && patch != null;

    if (origIsObj && patchIsObj) {
        for (const key of Object.keys(patch)) {
            original[key] = mergeStatusObjects(original[key], patch[key]);
        }
        return original;
    }

    return patch;
}

//#endregion
