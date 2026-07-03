import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {useEntityStore} from '@/stores/entities';
import type {entity_t} from '@/types';

const {listEntitiesChunked} = vi.hoisted(() => ({
    listEntitiesChunked: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({
    listEntitiesChunked
}));

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    const promise = new Promise<Result>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return {promise, resolve};
}

function entity(fields: Partial<entity_t> = {}): entity_t {
    return {
        id: 'entity:1',
        source: 'device-1',
        type: 'switch',
        properties: {},
        actions: [],
        events: [],
        enabled: true,
        component: 'switch',
        name: 'Switch',
        ...fields
    } as entity_t;
}

async function waitForListCount(count: number): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
        if (listEntitiesChunked.mock.calls.length === count) return;
        await Promise.resolve();
    }
    expect(listEntitiesChunked).toHaveBeenCalledTimes(count);
}

describe('entities store refresh coordination', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        listEntitiesChunked.mockReset();
    });

    it('coalesces overlapping chunked refreshes into one follow-up refresh', async () => {
        const first = deferred<void>();
        const second = deferred<void>();
        listEntitiesChunked
            .mockImplementationOnce(async (onChunk) => {
                onChunk({'entity:old': entity({id: 'entity:old'})});
                await first.promise;
            })
            .mockImplementationOnce(async (onChunk) => {
                onChunk({
                    'entity:fresh': entity({
                        id: 'entity:fresh',
                        name: 'Fresh'
                    })
                });
                await second.promise;
            });
        const store = useEntityStore();

        const firstFetch = store.fetchEntities();
        const secondFetch = store.fetchEntities();

        expect(listEntitiesChunked).toHaveBeenCalledTimes(1);
        first.resolve();
        await waitForListCount(2);
        second.resolve();
        await Promise.all([firstFetch, secondFetch]);

        expect(store.entities).toEqual({
            'entity:fresh': expect.objectContaining({name: 'Fresh'})
        });
        expect(store.version).toBe(2);
    });
});
