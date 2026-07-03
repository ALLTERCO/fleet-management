import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import type {ShellyDeviceExternal} from '@/types';

const {getEntityInfo, listDevicesChunked, sendRPC} = vi.hoisted(() => ({
    getEntityInfo: vi.fn(),
    listDevicesChunked: vi.fn(),
    sendRPC: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({
    getEntityInfo,
    listDevicesChunked,
    sendRPC
}));

vi.mock('@/tools/observability', () => ({
    trackInteraction: vi.fn()
}));

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    const promise = new Promise<Result>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return {promise, resolve};
}

function device(fields: Partial<ShellyDeviceExternal>): ShellyDeviceExternal {
    return {
        shellyID: 'dev-1',
        online: true,
        sleeping: false,
        selected: false,
        loading: false,
        info: {},
        status: {},
        settings: {},
        entities: [],
        capabilities: {},
        meta: {},
        methods: [],
        groupIds: [],
        locationId: null,
        tagIds: [],
        ...fields
    } as ShellyDeviceExternal;
}

async function waitForListCount(count: number): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
        if (listDevicesChunked.mock.calls.length === count) return;
        await Promise.resolve();
    }
    expect(listDevicesChunked).toHaveBeenCalledTimes(count);
}

describe('devices store refresh coordination', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        getEntityInfo.mockReset();
        listDevicesChunked.mockReset();
        sendRPC.mockReset();
    });

    it('coalesces overlapping chunked device refreshes into one follow-up refresh', async () => {
        const first = deferred<void>();
        const second = deferred<void>();
        listDevicesChunked
            .mockImplementationOnce(async (onChunk) => {
                onChunk([device({shellyID: 'old'})]);
                await first.promise;
            })
            .mockImplementationOnce(async (onChunk) => {
                onChunk([device({shellyID: 'fresh'})]);
                await second.promise;
            });
        const store = useDevicesStore();

        const firstFetch = store.fetchDevices();
        const secondFetch = store.fetchDevices();

        expect(listDevicesChunked).toHaveBeenCalledTimes(1);
        first.resolve();
        await waitForListCount(2);
        second.resolve();
        await Promise.all([firstFetch, secondFetch]);

        expect(store.devices.fresh).toBeDefined();
        expect(listDevicesChunked).toHaveBeenCalledTimes(2);
    });

    it('hydrates unchanged device entities after a cold entity store', async () => {
        getEntityInfo.mockResolvedValue({
            id: 'vdev_room:role:temperature:virtual',
            source: 'vdev_room',
            type: 'temperature',
            properties: {id: 0}
        });
        listDevicesChunked.mockImplementation(async (onChunk) => {
            onChunk([
                device({
                    shellyID: 'vdev_room',
                    source: 'virtual',
                    entities: ['vdev_room:role:temperature:virtual']
                })
            ]);
        });
        const devicesStore = useDevicesStore();
        const entitiesStore = useEntityStore();

        await devicesStore.fetchDevices();
        delete entitiesStore.entities['vdev_room:role:temperature:virtual'];
        await devicesStore.fetchDevices();

        expect(getEntityInfo).toHaveBeenLastCalledWith(
            'vdev_room:role:temperature:virtual'
        );
    });
});
