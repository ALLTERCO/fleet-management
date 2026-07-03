// Groups store fetch paths, exercised with a mocked ws.sendRPC.
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {sendRPC, toastError} = vi.hoisted(() => ({
    sendRPC: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({sendRPC}));
vi.mock('@/stores/toast', () => ({
    useToastStore: () => ({error: toastError})
}));

import type {Group as ApiGroup} from '@api/group';
import {useGroupsStore} from '@/stores/groups';

function makeGroup(id: number, parentGroupId: number | null = null): ApiGroup {
    return {
        id,
        organizationId: 'org',
        name: `Group ${id}`,
        description: null,
        parentGroupId,
        groupType: 'standard',
        membershipMode: 'manual',
        metadata: {},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null
    };
}

function pagedEnvelope<T>(items: T[], has_more = false) {
    return {items, total: items.length, limit: 1000, offset: 0, has_more};
}

function itemsOnly<T>(items: T[]) {
    return {items};
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

describe('groups store', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        sendRPC.mockReset();
        toastError.mockReset();
    });

    it('fetchGroups: merges groups AND members in one reactive update', async () => {
        sendRPC.mockImplementation(async (_ns, method) => {
            if (method === 'group.list') {
                return pagedEnvelope([makeGroup(1), makeGroup(2)]);
            }
            if (method === 'group.listdevicememberships') {
                return itemsOnly([
                    {groupId: 1, subjectId: 'shelly-a'},
                    {groupId: 1, subjectId: 'shelly-b'},
                    {groupId: 2, subjectId: 'shelly-c'}
                ]);
            }
            throw new Error(`unexpected RPC ${method}`);
        });

        const store = useGroupsStore();
        await store.fetchGroups();

        expect(store.groups[1].devices).toEqual(['shelly-a', 'shelly-b']);
        expect(store.groups[2].devices).toEqual(['shelly-c']);
        expect(store.loading).toBe(false);
    });

    it('fetchGroups: defaults to empty array for groups with no members', async () => {
        sendRPC.mockImplementation(async (_ns, method) => {
            if (method === 'group.list') {
                return pagedEnvelope([makeGroup(1), makeGroup(2)]);
            }
            if (method === 'group.listdevicememberships') {
                // group 1 has devices, group 2 not mentioned
                return itemsOnly([{groupId: 1, subjectId: 'shelly-a'}]);
            }
            throw new Error(`unexpected RPC ${method}`);
        });

        const store = useGroupsStore();
        await store.fetchGroups();

        expect(store.groups[1].devices).toEqual(['shelly-a']);
        expect(store.groups[2].devices).toEqual([]);
    });

    it('fetchGroups: paginates when has_more is true', async () => {
        const listCalls: Array<{offset: number}> = [];
        sendRPC.mockImplementation(async (_ns, method, params) => {
            if (method === 'group.list') {
                listCalls.push({offset: params.offset});
                if (params.offset === 0) {
                    // Page 1: pretend it's a "full page" (length === limit forces another fetch)
                    const groups = Array.from({length: params.limit}, (_, i) =>
                        makeGroup(i + 1)
                    );
                    return pagedEnvelope(groups, true);
                }
                return pagedEnvelope([makeGroup(9999)], false);
            }
            if (method === 'group.listdevicememberships') return itemsOnly([]);
            throw new Error(`unexpected RPC ${method}`);
        });

        const store = useGroupsStore();
        await store.fetchGroups();

        expect(listCalls.length).toBe(2);
        expect(listCalls[0].offset).toBe(0);
        expect(listCalls[1].offset).toBeGreaterThan(0);
        expect(store.groups[9999]).toBeDefined();
    });

    it('fetchGroups: surfaces toast error when group.list fails', async () => {
        sendRPC.mockImplementation(async () => {
            throw new Error('connection refused');
        });

        const store = useGroupsStore();
        await store.fetchGroups();

        // toastRpcError surfaces the underlying error text when present;
        // the fallback only kicks in for codeless/messageless errors.
        expect(toastError).toHaveBeenCalledWith('connection refused');
        expect(store.loading).toBe(false);
    });

    it('fetchChildren: replaces only children of the given parent', async () => {
        // Seed: two root groups + two children of parent 1
        sendRPC.mockImplementation(async (_ns, method, params) => {
            if (method === 'group.list') {
                if (params.parentGroupId === null) {
                    return pagedEnvelope([makeGroup(1), makeGroup(2)]);
                }
                if (params.parentGroupId === 1) {
                    return pagedEnvelope([makeGroup(10, 1), makeGroup(11, 1)]);
                }
            }
            if (method === 'group.listdevicememberships') return itemsOnly([]);
            throw new Error(`unexpected ${method}`);
        });

        const store = useGroupsStore();
        await store.fetchGroups();
        await store.fetchChildren(1);

        // roots still there
        expect(store.groups[1]).toBeDefined();
        expect(store.groups[2]).toBeDefined();
        // children added
        expect(store.groups[10]).toBeDefined();
        expect(store.groups[11]).toBeDefined();

        // Re-fetch children with a new set — the old children are dropped.
        sendRPC.mockImplementation(async (_ns, method, params) => {
            if (method === 'group.list' && params.parentGroupId === 1) {
                return pagedEnvelope([makeGroup(12, 1)]);
            }
            if (method === 'group.listdevicememberships') return itemsOnly([]);
            throw new Error(`unexpected ${method}`);
        });
        await store.fetchChildren(1);

        expect(store.groups[10]).toBeUndefined();
        expect(store.groups[11]).toBeUndefined();
        expect(store.groups[12]).toBeDefined();
        // roots untouched
        expect(store.groups[1]).toBeDefined();
        expect(store.groups[2]).toBeDefined();
    });

    it('fetchGroup: paginates group.listmembers and stores device list', async () => {
        sendRPC.mockImplementation(async (_ns, method, params) => {
            if (method === 'group.get') return makeGroup(42);
            if (method === 'group.listmembers') {
                if (params.offset === 0) {
                    const items = Array.from(
                        {length: params.limit},
                        (_, i) => ({
                            subjectType: 'device',
                            subjectId: `shelly-${i}`
                        })
                    );
                    return pagedEnvelope(items, true);
                }
                return pagedEnvelope(
                    [{subjectType: 'device', subjectId: 'shelly-last'}],
                    false
                );
            }
            throw new Error(`unexpected ${method}`);
        });

        const store = useGroupsStore();
        await store.fetchGroup(42);

        expect(store.groups[42]).toBeDefined();
        expect(store.groups[42].devices.length).toBeGreaterThan(1000);
        expect(
            store.groups[42].devices[store.groups[42].devices.length - 1]
        ).toBe('shelly-last');
    });

    it('fetchMembers: updates a specific group, leaves others alone', async () => {
        sendRPC.mockImplementation(async (_ns, method) => {
            if (method === 'group.list')
                return pagedEnvelope([makeGroup(1), makeGroup(2)]);
            if (method === 'group.listdevicememberships')
                return itemsOnly([
                    {groupId: 1, subjectId: 'shelly-a'},
                    {groupId: 2, subjectId: 'shelly-b'}
                ]);
            throw new Error(`unexpected ${method}`);
        });
        const store = useGroupsStore();
        await store.fetchGroups();

        // After setup: refresh only group 2's members
        sendRPC.mockImplementation(async (_ns, method, params) => {
            if (method === 'group.listmembers' && params.id === 2) {
                return pagedEnvelope(
                    [
                        {subjectType: 'device', subjectId: 'shelly-b'},
                        {subjectType: 'device', subjectId: 'shelly-new'}
                    ],
                    false
                );
            }
            throw new Error(`unexpected ${method}`);
        });
        const devices = await store.fetchMembers(2);

        expect(devices).toEqual(['shelly-b', 'shelly-new']);
        expect(store.groups[2].devices).toEqual(['shelly-b', 'shelly-new']);
        expect(store.groups[1].devices).toEqual(['shelly-a']); // unchanged
    });

    it('fetchMembers: on error returns stale cached list and surfaces toast', async () => {
        sendRPC.mockImplementation(async (_ns, method) => {
            if (method === 'group.list') return pagedEnvelope([makeGroup(1)]);
            if (method === 'group.listdevicememberships')
                return itemsOnly([{groupId: 1, subjectId: 'shelly-a'}]);
            throw new Error(`unexpected ${method}`);
        });
        const store = useGroupsStore();
        await store.fetchGroups();

        sendRPC.mockImplementation(async () => {
            throw new Error('network failed');
        });
        const devices = await store.fetchMembers(1);

        expect(devices).toEqual(['shelly-a']); // stale cache
        // toastRpcError surfaces the underlying error text; fallback string
        // is reserved for codeless errors with no message.
        expect(toastError).toHaveBeenCalledWith('network failed');
    });

    it('addDevices: applies membership before group.addmembers resolves', async () => {
        const rpc = deferred<void>();
        sendRPC.mockImplementation(async (_ns, method, params) => {
            if (method === 'group.addmembers') return rpc.promise;
            if (
                method === 'group.listmembers' &&
                params.subjectType === 'device'
            ) {
                return pagedEnvelope(
                    [
                        {subjectType: 'device', subjectId: 'shelly-a'},
                        {subjectType: 'device', subjectId: 'shelly-b'}
                    ],
                    false
                );
            }
            if (method === 'group.listmembers') {
                return pagedEnvelope(
                    [
                        {subjectType: 'device', subjectId: 'shelly-a'},
                        {subjectType: 'device', subjectId: 'shelly-b'}
                    ],
                    false
                );
            }
            throw new Error(`unexpected ${method}`);
        });
        const store = useGroupsStore();
        store.groups = {
            1: {...makeGroup(1), devices: ['shelly-a'], members: []}
        };

        const command = store.addDevices(1, ['shelly-b']);

        expect(store.groups[1].devices).toEqual(['shelly-a', 'shelly-b']);
        rpc.resolve();
        await expect(command).resolves.toBe(true);
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'group.addmembers',
            {
                id: 1,
                members: [{subjectType: 'device', subjectId: 'shelly-b'}]
            }
        );
    });

    it('removeDevices: rolls back membership when group.removemembers fails', async () => {
        sendRPC.mockImplementation(async (_ns, method) => {
            if (method === 'group.removemembers') throw new Error('denied');
            throw new Error(`unexpected ${method}`);
        });
        const store = useGroupsStore();
        store.groups = {
            1: {
                ...makeGroup(1),
                devices: ['shelly-a', 'shelly-b'],
                members: [
                    {subjectType: 'device', subjectId: 'shelly-a'},
                    {subjectType: 'device', subjectId: 'shelly-b'}
                ]
            }
        };

        await expect(store.removeDevices(1, ['shelly-b'])).resolves.toBe(false);

        expect(store.groups[1].devices).toEqual(['shelly-a', 'shelly-b']);
        expect(store.groups[1].members).toEqual([
            {subjectType: 'device', subjectId: 'shelly-a'},
            {subjectType: 'device', subjectId: 'shelly-b'}
        ]);
        expect(toastError).toHaveBeenCalledWith('denied');
    });

    it('addMembers: supports BLE device entity members without losing device members', async () => {
        sendRPC.mockImplementation(async (_ns, method, params) => {
            if (method === 'group.addmembers') {
                expect(params.members).toEqual([
                    {subjectType: 'entity', subjectId: 'bthomedevice:1'}
                ]);
                return {};
            }
            if (method === 'group.listmembers') {
                return pagedEnvelope(
                    [
                        {subjectType: 'device', subjectId: 'shelly-a'},
                        {subjectType: 'entity', subjectId: 'bthomedevice:1'}
                    ],
                    false
                );
            }
            throw new Error(`unexpected ${method}`);
        });
        const store = useGroupsStore();
        store.groups = {
            1: {
                ...makeGroup(1),
                devices: ['shelly-a'],
                members: [{subjectType: 'device', subjectId: 'shelly-a'}]
            }
        };

        await expect(
            store.addMembers(1, [
                {subjectType: 'entity', subjectId: 'bthomedevice:1'}
            ])
        ).resolves.toBe(true);

        expect(store.groups[1].devices).toEqual(['shelly-a']);
        expect(store.groups[1].members).toEqual([
            {subjectType: 'device', subjectId: 'shelly-a'},
            {subjectType: 'entity', subjectId: 'bthomedevice:1'}
        ]);
    });

    // Perf: 2000 groups → 4 round-trips (2 list pages + 2 membership chunks),
    // not 2001. Proves the batch endpoint replaced N+1.
    it('large-org refresh: 2000 groups in 4 round-trips', async () => {
        const TOTAL = 2000;
        const listCalls: Array<{offset: number}> = [];
        const membershipCalls: Array<{ids: number[]}> = [];

        sendRPC.mockImplementation(async (_ns, method, params) => {
            if (method === 'group.list') {
                listCalls.push({offset: params.offset});
                const start = params.offset;
                const end = Math.min(start + params.limit, TOTAL);
                const items = [];
                for (let id = start + 1; id <= end; id++) {
                    items.push(makeGroup(id));
                }
                return pagedEnvelope(items, end < TOTAL);
            }
            if (method === 'group.listdevicememberships') {
                membershipCalls.push({ids: params.ids});
                return itemsOnly(
                    params.ids.map((id: number) => ({
                        groupId: id,
                        subjectId: `shelly-${id}`
                    }))
                );
            }
            throw new Error(`unexpected ${method}`);
        });

        const store = useGroupsStore();
        await store.fetchGroups();

        expect(Object.keys(store.groups).length).toBe(TOTAL);
        expect(listCalls.length).toBe(2);
        expect(membershipCalls.length).toBe(2);
        expect(sendRPC).toHaveBeenCalledTimes(4);

        // Every group has its denormalized `devices` populated.
        expect(store.groups[1].devices).toEqual(['shelly-1']);
        expect(store.groups[1500].devices).toEqual(['shelly-1500']);
        expect(store.groups[TOTAL].devices).toEqual([`shelly-${TOTAL}`]);
    });
});
