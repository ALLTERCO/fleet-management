/* eslint-disable no-dupe-class-members */
import * as log4js from 'log4js';
import * as Commander from '../modules/Commander';
import {
    composeDynamicComponent,
    proposeEntities
} from '../modules/EntityComposer';
import {store} from '../modules/PostgresProvider';
import * as ShellyEvents from '../modules/ShellyEvents';
import {handleMessage} from '../modules/ShellyMessageHandler';
import type {
    ShellyMessageData,
    ShellyMessageIncoming,
    entity_t
} from '../types';
import AbstractDevice from './AbstractDevice';

const logger = log4js.getLogger('device');

const PERSIST_DEBOUNCE_MS = 5000;

export default class ShellyDevice extends AbstractDevice {
    #persistTimer?: ReturnType<typeof setTimeout>;

    protected override findMessageReason(key: string, message: any): string {
        return findMessageReason(key, message);
    }

    generateEntities() {
        return proposeEntities(this);
    }

    protected override onStateChange(): void {
        if (this.#persistTimer) return;
        this.#persistTimer = setTimeout(() => {
            this.#persistTimer = undefined;
            this.#persistState();
        }, PERSIST_DEBOUNCE_MS);
    }

    async #persistState() {
        try {
            await store(this.shellyID, this.toJSON());
        } catch (error) {
            logger.warn(
                'failed to persist state for',
                this.shellyID,
                String(error)
            );
        }
    }

    protected override onMessage(
        message: ShellyMessageIncoming,
        request?: ShellyMessageData
    ): void {
        handleMessage(this, message, request);

        if (message.method === 'NotifyEvent') {
            for (const eventBody of (message?.params?.events ?? []) as {
                event?: string;
                component?: string;
                device?: {
                    addr: string;
                    local_name: string;
                    shelly_mfdata?: {
                        model_id: number;
                    };
                };
                sensors?: Record<
                    string,
                    Array<{id: number; value: any; last_updated_ts: number}>
                >;
            }[]) {
                if (
                    typeof eventBody.component === 'string' &&
                    eventBody.component.startsWith('bthomedevice:')
                ) {
                    const sensors = eventBody.sensors as Record<
                        string,
                        Array<{id: number; value: any; last_updated_ts: number}>
                    >;
                    if (sensors && typeof sensors === 'object') {
                        for (const sensorArray of Object.values(sensors)) {
                            for (const sensor of sensorArray) {
                                this.setComponentStatus(
                                    `bthomesensor:${sensor.id}`,
                                    {
                                        id: sensor.id,
                                        value: sensor.value,
                                        last_updated_ts: sensor.last_updated_ts
                                    }
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    override setComponentStatus(key: string, status: any) {
        super.setComponentStatus(key, status);
        const entity = this.findEntity(key);
        if (entity) {
            ShellyEvents.emitEntityStatusChange(entity, status);
        }
    }

    public updateComponent(key: string, status: any, config: any) {
        this.setComponentStatus(key, status);
        this.setComponentConfig(key, config);

        const {type, id} = parseComponentKey(key);

        const entity: entity_t | null = composeDynamicComponent(
            type,
            this.config[key],
            this.info.name as string,
            this.id
        );

        if (!entity) {
            logger.error('Error composing entity for %s:%s', type, id);
            return;
        }

        logger.info('Composed entity %s:%s', type, id);

        this.addEntity(entity);
    }

    public async fetchComponent(key: string) {
        const {type, id} = parseComponentKey(key);

        let status: any;
        let config: any;

        try {
            [status, config] = await Promise.all([
                this.sendRPC(`${type}.GetStatus`, id && {id}),
                this.sendRPC(`${type}.GetConfig`, id && {id})
            ]);
        } catch (error) {
            logger.error('Error fetching component for %s:%s', type, id);
            return;
        }
        logger.info('Fetched component %s:%s', type, id);
        this.updateComponent(key, status, config);
    }

    public override removeComponent(key: string) {
        super.removeComponent(key);
        const entity = this.findEntity(key);
        if (!entity) {
            return;
        }

        this.removeEntity(entity);
    }

    public forwardComponentEvent(
        key: string,
        event: 'single_push' | 'double_push' | 'triple_push' | 'long_push'
    ) {
        // search for entity with type and id
        const entity = this.findEntity(key);

        // exit if doesn't exist
        if (!entity) {
            return;
        }

        ShellyEvents.emitEntityEvent(entity, event);
    }

    public async addBTHomeDeviceManual(
        mac: string,
        name?: string
    ): Promise<void> {
        if (!mac) {
            return Promise.reject('Missing MAC address');
        }

        const config: Record<string, any> = {addr: mac};
        if (name?.trim()) {
            config.name = name.trim();
        }

        const usedIds = Object.keys(this.config)
            .filter((k) => k.startsWith('bthomedevice:'))
            .map((k) => Number.parseInt(k.split(':')[1], 10))
            .filter((n) => !Number.isNaN(n) && n >= 200 && n <= 299);

        let freeId = 200;
        while (usedIds.includes(freeId) && freeId <= 299) {
            freeId++;
        }
        if (freeId > 299) {
            return Promise.reject('No free BTHome ID available (200–299)');
        }

        return this.sendRPC('BTHome.AddDevice', {config, id: freeId});
    }

    public removeBTHomeDevice(id: number): Promise<void> {
        if (!id) {
            return Promise.reject('Missing MAC address');
        }
        return this.sendRPC('BTHome.DeleteDevice', {id: id});
    }

    private findEntity(key: string): entity_t | undefined {
        const {type, id} = parseComponentKey(key);

        return this.entities.find(
            (entity) =>
                entity.type === type &&
                (!('id' in entity.properties) || entity.properties.id === id)
        );
    }

    public async addBTHomeSensor(
        id: number,
        addr: string,
        obj_id: number,
        idx: number,
        name?: string,
        meta?: Record<string, any>
    ): Promise<void> {
        // 1. Gather all currently used sensor‑IDs from this.config
        const usedIds = Object.keys(this.config)
            .filter((k) => k.startsWith('bthomesensor:'))
            .map((k) => Number.parseInt(k.split(':')[1], 10))
            .filter((n) => !Number.isNaN(n));

        // 2. Start with the requested id, but if it’s already in use pick the first free one in [200..299]
        let sensorId = id;
        if (usedIds.includes(sensorId)) {
            sensorId = 200;
            while (usedIds.includes(sensorId) && sensorId <= 299) {
                sensorId++;
            }
            if (usedIds.includes(sensorId)) {
                return Promise.reject(
                    'No free BTHomeSensor ID available (200–299)'
                );
            }
        }

        // 3. Build the payload exactly as per the Gen 2 API
        const config: any = {
            addr,
            obj_id,
            obj_idx: idx // note: must be "obj_idx", not "idx"
        };
        if (name?.trim()) config.name = name.trim();
        if (meta != null) config.meta = meta;

        // 4. Call the proper RPC method
        return this.sendRPC('BTHome.AddSensor', {config, id: sensorId});
    }

    override destroy(options?: {skipDeleteEvent?: boolean}): void {
        if (this.#persistTimer) {
            clearTimeout(this.#persistTimer);
            this.#persistTimer = undefined;
            this.#persistState();
        }
        if (!options?.skipDeleteEvent) {
            ShellyEvents.emitShellyDeleted(this);
        }
        super.destroy(options);
    }
}

const SWITCH_CONSUMPTION_KEYS = ['current', 'apower', 'voltage'];
function findMessageReason(key: string, value: Record<string, any>) {
    const separatorIndex = key.indexOf(':');
    const core = separatorIndex > -1 ? key.slice(0, separatorIndex) : key;
    const valueKeys = Object.keys(value);

    if (valueKeys.includes('aenergy')) {
        return `${core}:aenergy`;
    }

    if (key.startsWith('switch')) {
        if (valueKeys.includes('output')) {
            return `${core}:output`;
        }
        if (
            valueKeys.find((entry) => SWITCH_CONSUMPTION_KEYS.includes(entry))
        ) {
            return `${core}:consumption`;
        }
    }

    return `${core}:generic`;
}

const ENDS_WITH_NUMBER = /:\d*$/;
export function parseComponentKey(key: string): {type: string; id?: number} {
    const type = key.replace(ENDS_WITH_NUMBER, '');
    const id = Number.parseInt(key.replace(`${type}:`, ''));

    return {
        type,
        ...(Number.isFinite(id) ? {id} : {})
    };
}
