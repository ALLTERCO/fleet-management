import * as DeviceCollector from '../../modules/DeviceCollector';
import type {entity_t} from '../../types';
import type CommandSender from '../CommandSender';
import Component from './Component';

export default class EntityComponent extends Component<any> {
    declare config: never;

    constructor() {
        super('entity');
        this.methods.delete('setconfig');
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        return false;
    }

    override getStatus(params?: any): Record<string, any> {
        if (!params || typeof params?.id !== 'string') {
            const keys = DeviceCollector.getAll().flatMap((device) =>
                device.entities.map((entity) => entity.id)
            );
            return {
                entities_count: keys.length,
                entities: keys
            };
        }

        const bundle = findEntityAndDevice(params.id);
        if (!bundle) return {};

        const {entity, device} = bundle;
        const {properties, type} = entity;
        const channel = properties.id;

        return device.status[`${type}:${channel}`] ?? {};
    }

    override getConfig(params?: any): Record<string, any> {
        if (!params || typeof params?.id !== 'string') return {};

        const bundle = findEntityAndDevice(params.id);
        if (!bundle) return {};

        const {entity, device} = bundle;
        const {properties, type} = entity;
        const channel = properties.id;

        return device.config[`${type}:${channel}`] ?? {};
    }

    @Component.Expose('GetInfo')
    @Component.CheckParams((params) => typeof params?.id === 'string')
    getInfo({id}: {id: string}) {
        const bundle = findEntityAndDevice(id);
        return bundle ? bundle.entity : {};
    }

    @Component.Expose('List')
    @Component.NoPermissions
    async listEntities(
        params: {limit?: number; offset?: number} | undefined,
        sender: CommandSender
    ): Promise<
        | Record<string, entity_t>
        | {items: Record<string, entity_t>; total: number}
    > {
        const allDevices = DeviceCollector.getAll();
        const uniqueSources = [
            ...new Set(allDevices.map((d) => d.shellyID as string))
        ];
        const accessible = await sender.filterAccessibleDevices(uniqueSources);

        // Build flat array of entities (avoids double-iteration for paginated path)
        const allEntities: Array<[string, entity_t]> = [];
        for (const device of allDevices) {
            if (!accessible.has(device.shellyID as string)) continue;
            for (const entity of device.entities) {
                allEntities.push([
                    entity.id,
                    {...entity, source: device.shellyID as string}
                ]);
            }
        }

        const total = allEntities.length;
        const limit =
            typeof params?.limit === 'number' && params.limit > 0
                ? params.limit
                : 0;
        const offset =
            typeof params?.offset === 'number' && params.offset >= 0
                ? params.offset
                : 0;

        if (limit > 0) {
            const items: Record<string, entity_t> = {};
            const slice = allEntities.slice(offset, offset + limit);
            for (const [id, entity] of slice) {
                items[id] = entity;
            }
            return {items, total};
        }

        // No pagination — return all (backward compatible)
        const result: Record<string, entity_t> = {};
        for (const [id, entity] of allEntities) {
            result[id] = entity;
        }
        return result;
    }

    protected override getDefaultConfig() {
        return {};
    }
}

// TODO: Use iterators probably
function findEntityAndDevice(id: string) {
    for (const device of DeviceCollector.getAll()) {
        for (const entity of device.entities) {
            if (entity.id === id)
                return {
                    entity,
                    device
                };
        }
    }
    return undefined;
}
