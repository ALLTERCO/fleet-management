import {createPinia, setActivePinia} from 'pinia';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

type OrganizationScopeModel = {
    version: 1;
    locationKinds: Array<{
        key: string;
        label: string;
        sortRank: number;
        allowRoot: boolean;
    }>;
    groupTypes: Array<{key: string; label: string}>;
    membershipModes: Array<{key: string; label: string; enabled: boolean}>;
    groupMemberTypes: string[];
    tagAssignmentTypes: string[];
    locationAssignmentTypes: string[];
    capabilities: Record<string, boolean>;
    legacyTransition: Record<string, unknown>;
};

vi.mock('@/tools/websocket', () => {
    return {sendRPC: vi.fn()};
});

import {useScopeModelStore} from '@/stores/scopeModel';
import * as ws from '@/tools/websocket';

const fixture: OrganizationScopeModel = {
    version: 1,
    locationKinds: [{key: 'site', label: 'Site', sortRank: 0, allowRoot: true}],
    groupTypes: [{key: 'standard', label: 'Standard'}],
    membershipModes: [{key: 'manual', label: 'Manual', enabled: true}],
    groupMemberTypes: ['device', 'entity', 'location'],
    tagAssignmentTypes: ['device', 'group', 'location'],
    locationAssignmentTypes: ['device', 'entity'],
    capabilities: {nestedGroups: true},
    legacyTransition: {canonicalPhysicalScope: 'location'}
};

describe('useScopeModelStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.mocked(ws.sendRPC).mockReset();
    });
    afterEach(() => vi.restoreAllMocks());

    it('fetches once, caches, and serves subsequent calls from cache', async () => {
        vi.mocked(ws.sendRPC).mockResolvedValueOnce(fixture as any);
        const store = useScopeModelStore();
        const first = await store.fetch();
        const second = await store.fetch();
        expect(first).toEqual(second);
        expect(vi.mocked(ws.sendRPC)).toHaveBeenCalledTimes(1);
    });

    it('de-dupes concurrent fetches into one RPC', async () => {
        let resolveOne!: (v: OrganizationScopeModel) => void;
        vi.mocked(ws.sendRPC).mockImplementationOnce(
            () =>
                new Promise<OrganizationScopeModel>((r) => {
                    resolveOne = r;
                }) as any
        );
        const store = useScopeModelStore();
        const p1 = store.fetch();
        const p2 = store.fetch();
        resolveOne(fixture);
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toBe(r2);
        expect(vi.mocked(ws.sendRPC)).toHaveBeenCalledTimes(1);
    });

    it('surfaces failure via error state without throwing', async () => {
        vi.mocked(ws.sendRPC).mockRejectedValueOnce(new Error('ws down'));
        const store = useScopeModelStore();
        const res = await store.fetch();
        expect(res).toBeNull();
        expect(store.error).toBe('ws down');
    });

    it('exposes getters derived from the cached model', async () => {
        vi.mocked(ws.sendRPC).mockResolvedValueOnce(fixture as any);
        const store = useScopeModelStore();
        await store.fetch();
        expect(store.locationKinds).toEqual(fixture.locationKinds);
        expect(store.groupTypes).toEqual(fixture.groupTypes);
        expect(store.membershipModes).toEqual(fixture.membershipModes);
        expect(store.capabilities).toEqual(fixture.capabilities);
    });

    it('returns empty arrays when the model is not yet loaded', () => {
        const store = useScopeModelStore();
        expect(store.locationKinds).toEqual([]);
        expect(store.groupTypes).toEqual([]);
        expect(store.capabilities).toBeNull();
    });
});
