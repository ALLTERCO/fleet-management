import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {sendRPC, onLocationEvent, toastError} = vi.hoisted(() => ({
    sendRPC: vi.fn(),
    onLocationEvent: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({sendRPC, onLocationEvent}));
vi.mock('@/stores/toast', () => ({
    useToastStore: () => ({error: toastError})
}));

import type {Location as ApiLocation, LocationAssignment} from '@api/location';
import {useLocationsStore} from '@/stores/locations';

function pagedEnvelope<T>(items: T[]) {
    return {
        items,
        total: items.length,
        limit: 1000,
        offset: 0,
        has_more: false
    };
}

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Result>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

function assignment(locationId: number, subjectId: string): LocationAssignment {
    return {
        organizationId: 'org',
        subjectType: 'device',
        subjectId,
        locationId,
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: null
    };
}

function location(fields: Partial<ApiLocation> = {}): ApiLocation {
    return {
        id: 1,
        organizationId: 'org',
        name: 'HQ',
        kind: 'site',
        parentLocationId: null,
        sortOrder: 0,
        kindFields: {},
        customFields: {},
        effective: {
            timezone: null,
            countryCode: null,
            currency: null,
            regulatoryZone: null,
            complianceTags: []
        },
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: null,
        ...fields
    };
}

async function waitForRpcCount(count: number): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
        if (sendRPC.mock.calls.length === count) return;
        await Promise.resolve();
    }
    expect(sendRPC).toHaveBeenCalledTimes(count);
}

describe('locations store assignment optimism', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        sendRPC.mockReset();
        onLocationEvent.mockReset();
        toastError.mockReset();
    });

    it('setAssignment moves a subject locally before location.setassignment resolves', async () => {
        const rpc = deferred<void>();
        sendRPC.mockImplementation(async (_ns, method) => {
            if (method === 'location.setassignment') return rpc.promise;
            if (method === 'location.listassignments') {
                return pagedEnvelope([assignment(2, 'shelly-a')]);
            }
            throw new Error(`unexpected ${method}`);
        });
        const store = useLocationsStore();
        store.assignmentsByLocation = {
            1: [assignment(1, 'shelly-a')],
            2: []
        };

        const command = store.setAssignment('device', 'shelly-a', 2);

        expect(store.assignmentsByLocation[1]).toEqual([]);
        expect(store.assignmentsByLocation[2]).toMatchObject([
            {subjectType: 'device', subjectId: 'shelly-a', locationId: 2}
        ]);
        rpc.resolve();
        await expect(command).resolves.toBe(true);
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'location.setassignment',
            {subjectType: 'device', subjectId: 'shelly-a', locationId: 2}
        );
    });

    it('setAssignment restores previous assignment state on failure', async () => {
        sendRPC.mockImplementation(async (_ns, method) => {
            if (method === 'location.setassignment') throw new Error('denied');
            throw new Error(`unexpected ${method}`);
        });
        const store = useLocationsStore();
        store.assignmentsByLocation = {
            1: [assignment(1, 'shelly-a')],
            2: []
        };

        await expect(
            store.setAssignment('device', 'shelly-a', 2)
        ).resolves.toBe(false);

        expect(store.assignmentsByLocation).toEqual({
            1: [assignment(1, 'shelly-a')],
            2: []
        });
        expect(toastError).toHaveBeenCalledWith('denied');
    });

    it('coalesces overlapping location refreshes into one follow-up refresh', async () => {
        const first = deferred<ReturnType<typeof pagedEnvelope<ApiLocation>>>();
        const second =
            deferred<ReturnType<typeof pagedEnvelope<ApiLocation>>>();
        sendRPC
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const store = useLocationsStore();

        const firstFetch = store.fetchLocations();
        const secondFetch = store.fetchLocations();

        expect(sendRPC).toHaveBeenCalledTimes(1);
        first.resolve(pagedEnvelope([location({id: 1, name: 'Old'})]));
        await waitForRpcCount(2);
        second.resolve(pagedEnvelope([location({id: 2, name: 'Fresh'})]));
        await Promise.all([firstFetch, secondFetch]);

        expect(store.locations).toEqual({
            2: expect.objectContaining({name: 'Fresh'})
        });
        expect(store.rootIds).toEqual([2]);
    });
});
