import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {sendRPC} from '@/tools/websocket';

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn()
}));

vi.mock('@/tools/observability', () => ({
    trackInteraction: vi.fn()
}));

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Result>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

function seedSwitchDevice(): ReturnType<typeof useDevicesStore> {
    const store = useDevicesStore();
    store.devices['dev-1'] = {
        shellyID: 'dev-1',
        id: 1,
        online: true,
        sleeping: false,
        selected: false,
        loading: false,
        info: {},
        status: {'switch:0': {output: false}},
        settings: {},
        entities: [],
        capabilities: {},
        meta: {},
        methods: [],
        groupIds: [],
        locationId: null,
        tagIds: []
    };
    return store;
}

function seedSwitchEntity(): ReturnType<typeof useEntityStore> {
    const store = useEntityStore();
    store.entities['entity-1'] = {
        id: 'entity-1',
        source: 'dev-1',
        type: 'switch',
        properties: {id: 0}
    } as any;
    return store;
}

function seedServiceDevice(): ReturnType<typeof useDevicesStore> {
    const store = useDevicesStore();
    store.devices['svc-dev'] = {
        shellyID: 'svc-dev',
        id: 2,
        online: true,
        sleeping: false,
        selected: false,
        loading: false,
        info: {},
        status: {
            'service:0': {state: 'running'},
            'boolean:2': {value: false}
        },
        settings: {},
        entities: [],
        capabilities: {},
        meta: {},
        methods: [],
        groupIds: [],
        locationId: null,
        tagIds: []
    };
    return store;
}

function seedServiceEntity(): ReturnType<typeof useEntityStore> {
    const store = useEntityStore();
    store.entities['service-1'] = {
        id: 'service-1',
        source: 'svc-dev',
        type: 'service',
        properties: {
            id: 0,
            components: {power: 'boolean:2'}
        }
    } as any;
    return store;
}

function seedEntityStatus(options: {
    shellyID: string;
    entityId: string;
    entityType: string;
    statusKey: string;
    status: Record<string, unknown>;
}): {
    devicesStore: ReturnType<typeof useDevicesStore>;
    entityStore: ReturnType<typeof useEntityStore>;
} {
    const devicesStore = useDevicesStore();
    devicesStore.devices[options.shellyID] = {
        shellyID: options.shellyID,
        id: 3,
        online: true,
        sleeping: false,
        selected: false,
        loading: false,
        info: {},
        status: {[options.statusKey]: options.status},
        settings: {},
        entities: [],
        capabilities: {},
        meta: {},
        methods: [],
        groupIds: [],
        locationId: null,
        tagIds: []
    };
    const entityStore = useEntityStore();
    const [, id] = options.statusKey.split(':');
    entityStore.entities[options.entityId] = {
        id: options.entityId,
        source: options.shellyID,
        type: options.entityType,
        properties: {id: Number(id)}
    } as any;
    return {devicesStore, entityStore};
}

describe('devicesStore command state', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.resetAllMocks();
    });

    it('shows predicted switch state before the RPC resolves', async () => {
        const rpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const store = seedSwitchDevice();

        const command = store.toggleSwitchOutput({shellyID: 'dev-1', id: 0});

        expect(store.statusOf('dev-1', 'switch:0')?.output).toBe(true);
        rpc.resolve({});
        await command;
    });

    it('reverts predicted switch state when the RPC rejects', async () => {
        vi.mocked(sendRPC).mockRejectedValue(new Error('denied'));
        const store = seedSwitchDevice();

        await expect(
            store.toggleSwitchOutput({shellyID: 'dev-1', id: 0})
        ).rejects.toThrow('denied');

        expect(store.statusOf('dev-1', 'switch:0')?.output).toBe(false);
    });

    it('keeps the newest predicted state when an older RPC rejects', async () => {
        const firstRpc = deferred<Record<string, never>>();
        const secondRpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC)
            .mockReturnValueOnce(firstRpc.promise)
            .mockReturnValueOnce(secondRpc.promise);
        const store = seedSwitchDevice();

        const firstCommand = store.toggleSwitchOutput({
            shellyID: 'dev-1',
            id: 0
        });
        expect(store.statusOf('dev-1', 'switch:0')?.output).toBe(true);

        const secondCommand = store.toggleSwitchOutput({
            shellyID: 'dev-1',
            id: 0
        });
        expect(store.statusOf('dev-1', 'switch:0')?.output).toBe(false);

        firstRpc.reject(new Error('first command failed'));
        await expect(firstCommand).resolves.toBeUndefined();
        expect(store.statusOf('dev-1', 'switch:0')?.output).toBe(false);

        secondRpc.resolve({});
        await secondCommand;
        expect(store.statusOf('dev-1', 'switch:0')?.output).toBe(false);
    });

    it('rolls back the newest predicted state when the newest RPC rejects', async () => {
        const firstRpc = deferred<Record<string, never>>();
        const secondRpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC)
            .mockReturnValueOnce(firstRpc.promise)
            .mockReturnValueOnce(secondRpc.promise);
        const store = seedSwitchDevice();

        const firstCommand = store.toggleSwitchOutput({
            shellyID: 'dev-1',
            id: 0
        });
        const secondCommand = store.toggleSwitchOutput({
            shellyID: 'dev-1',
            id: 0
        });

        secondRpc.reject(new Error('latest command failed'));
        await expect(secondCommand).rejects.toThrow('latest command failed');
        expect(store.statusOf('dev-1', 'switch:0')?.output).toBe(false);

        firstRpc.resolve({});
        await firstCommand;
        expect(store.statusOf('dev-1', 'switch:0')?.output).toBe(false);
    });

    it('clears predicted state when reported status confirms it', async () => {
        const rpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const store = seedSwitchDevice();

        const command = store.toggleSwitchOutput({shellyID: 'dev-1', id: 0});
        expect(store.statusOf('dev-1', 'switch:0')?.output).toBe(true);

        store.patchStatus('dev-1', {'switch:0': {output: true}});
        rpc.reject(new Error('late failure from completed request'));
        await expect(command).resolves.toBeUndefined();

        expect(store.statusOf('dev-1', 'switch:0')?.output).toBe(true);
    });

    it('supersedes pending command on rapid clicks — last intent wins, late ACKs silenced', async () => {
        const firstRpc = deferred<Record<string, never>>();
        const secondRpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC).mockReturnValueOnce(firstRpc.promise);
        vi.mocked(sendRPC).mockReturnValueOnce(secondRpc.promise);
        const devicesStore = seedSwitchDevice();
        const entityStore = seedSwitchEntity();

        const firstCommand = entityStore.invokeAction('entity-1', 'toggle');
        expect(devicesStore.statusOf('dev-1', 'switch:0')?.output).toBe(true);
        expect(sendRPC).toHaveBeenCalledTimes(1);

        const secondCommand = entityStore.invokeAction('entity-1', 'toggle');
        expect(sendRPC).toHaveBeenCalledTimes(2);
        expect(devicesStore.statusOf('dev-1', 'switch:0')?.output).toBe(false);

        firstRpc.reject(new Error('superseded RPC late failure'));
        await expect(firstCommand).resolves.toBeUndefined();
        expect(devicesStore.statusOf('dev-1', 'switch:0')?.output).toBe(false);

        devicesStore.patchStatus('dev-1', {'switch:0': {output: false}});
        secondRpc.resolve({});
        await secondCommand;
        expect(devicesStore.statusOf('dev-1', 'switch:0')?.output).toBe(false);
    });

    it('ignores a late Entity.InvokeAction failure after reported status confirms', async () => {
        const rpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const devicesStore = seedSwitchDevice();
        const entityStore = seedSwitchEntity();

        const command = entityStore.invokeAction('entity-1', 'toggle');
        expect(devicesStore.statusOf('dev-1', 'switch:0')?.output).toBe(true);

        devicesStore.patchStatus('dev-1', {'switch:0': {output: true}});
        rpc.reject(new Error('RPC timeout after 30000ms'));

        await expect(command).resolves.toBeUndefined();
        expect(devicesStore.statusOf('dev-1', 'switch:0')?.output).toBe(true);
    });

    it('predicts service variable state through Entity.InvokeAction', async () => {
        const rpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const devicesStore = seedServiceDevice();
        const entityStore = seedServiceEntity();

        const command = entityStore.invokeAction('service-1', 'setVariable', {
            key: 'boolean:2',
            value: true
        });

        expect(devicesStore.statusOf('svc-dev', 'boolean:2')?.value).toBe(true);
        rpc.resolve({});
        await command;
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'Entity.InvokeAction',
            {
                id: 'service-1',
                action: 'setVariable',
                params: {key: 'boolean:2', value: true}
            }
        );
    });

    it('predicts cury mode through Entity.InvokeAction', async () => {
        const rpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const {devicesStore, entityStore} = seedEntityStatus({
            shellyID: 'cury-dev',
            entityId: 'cury-1',
            entityType: 'cury',
            statusKey: 'cury:0',
            status: {mode: null}
        });

        const command = entityStore.invokeAction('cury-1', 'setCuryMode', {
            mode: 'hall'
        });

        expect(devicesStore.statusOf('cury-dev', 'cury:0')?.mode).toBe('hall');
        rpc.resolve({});
        await command;
    });

    it('predicts media favourite playback through Entity.InvokeAction', async () => {
        const rpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const {devicesStore, entityStore} = seedEntityStatus({
            shellyID: 'media-dev',
            entityId: 'media-1',
            entityType: 'media',
            statusKey: 'media:0',
            status: {playback: {enable: false}}
        });

        const command = entityStore.invokeAction('media-1', 'playFavourite', {
            favouriteId: 0
        });

        expect(
            devicesStore.statusOf('media-dev', 'media:0')?.playback?.enable
        ).toBe(true);
        rpc.resolve({});
        await command;
    });

    it('sends BLU TRV boost through Entity.InvokeAction without local prediction', async () => {
        const rpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const {devicesStore, entityStore} = seedEntityStatus({
            shellyID: 'blu-gw',
            entityId: 'blu-trv-1',
            entityType: 'blutrv',
            statusKey: 'blutrv:201',
            status: {target_C: 20}
        });

        const command = entityStore.invokeAction('blu-trv-1', 'startBoost', {
            duration: 1800
        });

        expect(devicesStore.statusOf('blu-gw', 'blutrv:201')?.target_C).toBe(
            20
        );
        rpc.resolve({});
        await command;
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'Entity.InvokeAction',
            {
                id: 'blu-trv-1',
                action: 'startBoost',
                params: {duration: 1800}
            }
        );
    });

    it('sends UI remote control through Entity.InvokeAction without local prediction', async () => {
        const rpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const {devicesStore, entityStore} = seedEntityStatus({
            shellyID: 'wall-display',
            entityId: 'ui-1',
            entityType: 'ui',
            statusKey: 'ui:0',
            status: {screen: 'home'}
        });

        const command = entityStore.invokeAction('ui-1', 'swipe', {
            direction: 'left'
        });

        expect(devicesStore.statusOf('wall-display', 'ui:0')?.screen).toBe(
            'home'
        );
        rpc.resolve({});
        await command;
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'Entity.InvokeAction',
            {
                id: 'ui-1',
                action: 'swipe',
                params: {direction: 'left'}
            }
        );
    });

    it('sends DALI group control through Entity.InvokeAction without local prediction', async () => {
        const rpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const {devicesStore, entityStore} = seedEntityStatus({
            shellyID: 'dali-dev',
            entityId: 'dali-light-1',
            entityType: 'light',
            statusKey: 'light:0',
            status: {output: false, brightness: 0}
        });

        const command = entityStore.invokeAction(
            'dali-light-1',
            'setDaliGroup',
            {
                groupId: 2,
                on: true,
                brightness: 80
            }
        );

        expect(devicesStore.statusOf('dali-dev', 'light:0')?.output).toBe(
            false
        );
        rpc.resolve({});
        await command;
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'Entity.InvokeAction',
            {
                id: 'dali-light-1',
                action: 'setDaliGroup',
                params: {groupId: 2, on: true, brightness: 80}
            }
        );
    });

    it('sends LED strip dynamic fields through Entity.InvokeAction without local prediction', async () => {
        const rpc = deferred<Record<string, never>>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const {devicesStore, entityStore} = seedEntityStatus({
            shellyID: 'ledstrip-dev',
            entityId: 'ledstrip-1',
            entityType: 'ledstrip',
            statusKey: 'ledstrip:0',
            status: {effect: 'solid'}
        });

        const command = entityStore.invokeAction(
            'ledstrip-1',
            'setLedStripField',
            {key: 'effect', value: 'rainbow'}
        );

        expect(
            devicesStore.statusOf('ledstrip-dev', 'ledstrip:0')?.effect
        ).toBe('solid');
        rpc.resolve({});
        await command;
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'Entity.InvokeAction',
            {
                id: 'ledstrip-1',
                action: 'setLedStripField',
                params: {key: 'effect', value: 'rainbow'}
            }
        );
    });
});
