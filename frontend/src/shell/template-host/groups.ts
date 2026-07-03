import type {
    Group,
    GroupActivityEntry,
    GroupBreadcrumbEntry,
    GroupMemberRef
} from '@api/group';
import {type ComputedRef, computed, ref} from 'vue';
import {useGroupsStore} from '@/stores/groups';
import {hostListAll, hostRpc} from './rpc';
import type {HostAsyncState, HostLoadState} from './types';

type HostGroup = {
    id: number | string;
    name: string;
    parentGroupId?: number | null;
    devices?: string[];
    metadata?: Record<string, unknown>;
    location?: string;
    region?: string;
    deviceCount?: number;
    onlineCount?: number;
};

export function useGroups(): HostAsyncState<HostGroup[]> {
    const store = useGroupsStore();
    const state = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const loading = computed(() => state.value === 'loading');
    const error = ref<string | null>(null);
    const data = computed<HostGroup[]>(() =>
        Object.values(store.groups).map((group) => ({
            id: group.id,
            name: group.name,
            parentGroupId: group.parentGroupId,
            devices: group.devices,
            // Per @template-contract: metadata + helper flats let templates
            // read lat/lng/city/region/sizeRanking from groups without a
            // separate RPC trip.
            metadata: (group as any).metadata ?? {},
            location:
                (group as any).metadata?.city ??
                (group as any).metadata?.location,
            region: (group as any).metadata?.region,
            deviceCount: Array.isArray(group.devices)
                ? group.devices.length
                : 0,
            onlineCount: 0
        }))
    );

    async function refresh(): Promise<void> {
        state.value = 'loading';
        error.value = null;
        try {
            await store.fetchGroups();
            state.value = 'ready';
        } catch (err) {
            error.value = err instanceof Error ? err.message : String(err);
            state.value = 'error';
        }
    }

    return {state, loading, data, error, refresh};
}

export function useGroup(id: number): ComputedRef<HostGroup | null> {
    const store = useGroupsStore();
    return computed(() => {
        const group = store.groups[id];
        if (!group) return null;
        return {
            id: group.id,
            name: group.name,
            parentGroupId: group.parentGroupId,
            metadata: (group as any).metadata ?? {},
            location:
                (group as any).metadata?.city ??
                (group as any).metadata?.location,
            region: (group as any).metadata?.region,
            deviceCount: Array.isArray(group.devices)
                ? group.devices.length
                : 0,
            onlineCount: 0,
            devices: group.devices
        };
    });
}

/**
 * Contract-compliant group actions: {create, update, addDevice, removeDevice}
 * each as HostAction<{pending, error, run}>. Templates use these to mutate
 * group state via the standard FM RPCs (group.create / group.update /
 * group.addmembers / group.removemembers).
 */
export function useGroupActions() {
    const store = useGroupsStore();
    const createPending = ref(false);
    const createError = ref<string | null>(null);
    const updatePending = ref(false);
    const updateError = ref<string | null>(null);
    const addPending = ref(false);
    const addError = ref<string | null>(null);
    const removePending = ref(false);
    const removeError = ref<string | null>(null);

    return {
        create: {
            pending: createPending,
            error: createError,
            async run(input: {
                name: string;
                metadata?: Record<string, unknown>;
            }) {
                createPending.value = true;
                createError.value = null;
                try {
                    // GROUP_CREATE_PARAMS schema does not accept parentGroupId
                    // (additionalProperties: false). Top-level groups are
                    // implicit — leave parentGroupId out entirely.
                    const created = await hostRpc<{id: number; name: string}>(
                        'group.create',
                        {
                            name: input.name,
                            metadata: input.metadata ?? {}
                        }
                    );
                    await store.fetchGroups();
                    return {
                        id: String(created.id),
                        name: created.name,
                        metadata: input.metadata ?? {},
                        deviceCount: 0,
                        onlineCount: 0
                    } as unknown as HostGroup;
                } catch (e) {
                    createError.value =
                        e instanceof Error ? e.message : String(e);
                    throw e;
                } finally {
                    createPending.value = false;
                }
            }
        },
        update: {
            pending: updatePending,
            error: updateError,
            async run(id: string, patch: Partial<HostGroup>) {
                updatePending.value = true;
                updateError.value = null;
                try {
                    await hostRpc('group.update', {
                        id: Number(id),
                        patch: {
                            ...(patch.name !== undefined
                                ? {name: patch.name}
                                : {}),
                            ...(patch.metadata !== undefined
                                ? {metadata: patch.metadata}
                                : {})
                        }
                    });
                    await store.fetchGroups();
                } catch (e) {
                    updateError.value =
                        e instanceof Error ? e.message : String(e);
                    throw e;
                } finally {
                    updatePending.value = false;
                }
            }
        },
        addDevice: {
            pending: addPending,
            error: addError,
            async run(groupId: string, deviceIds: string[]) {
                addPending.value = true;
                addError.value = null;
                try {
                    await hostRpc('group.addmembers', {
                        id: Number(groupId),
                        members: deviceIds.map((d) => ({
                            subjectType: 'device',
                            subjectId: d
                        }))
                    });
                    await store.fetchGroups();
                } catch (e) {
                    addError.value = e instanceof Error ? e.message : String(e);
                    throw e;
                } finally {
                    addPending.value = false;
                }
            }
        },
        removeDevice: {
            pending: removePending,
            error: removeError,
            async run(groupId: string, deviceIds: string[]) {
                removePending.value = true;
                removeError.value = null;
                try {
                    await hostRpc('group.removemembers', {
                        id: Number(groupId),
                        members: deviceIds.map((d) => ({
                            subjectType: 'device',
                            subjectId: d
                        }))
                    });
                    await store.fetchGroups();
                } catch (e) {
                    removeError.value =
                        e instanceof Error ? e.message : String(e);
                    throw e;
                } finally {
                    removePending.value = false;
                }
            }
        }
    };
}

export const groups = {
    list(
        params: {
            parentGroupId?: number | null;
            query?: string;
            groupType?: string;
            includeSummary?: boolean;
        } = {}
    ): Promise<Group[]> {
        return hostListAll<Group>('group.list', params);
    },
    get(id: number, includeSummary = true): Promise<Group> {
        return hostRpc<Group>('group.get', {id, includeSummary});
    },
    children(id: number): Promise<Group[]> {
        return hostListAll<Group>('group.children', {id});
    },
    async path(id: number): Promise<GroupBreadcrumbEntry[]> {
        const res = await hostRpc<{items: GroupBreadcrumbEntry[]}>(
            'group.path',
            {id}
        );
        return res.items ?? [];
    },
    members(id: number, subjectType?: GroupMemberRef['subjectType']) {
        return hostListAll<GroupMemberRef>('group.listmembers', {
            id,
            ...(subjectType ? {subjectType} : {})
        });
    },
    addMembers(id: number, members: GroupMemberRef[]): Promise<Group> {
        return hostRpc<Group>('group.addmembers', {id, members});
    },
    removeMembers(id: number, members: GroupMemberRef[]): Promise<Group> {
        return hostRpc<Group>('group.removemembers', {id, members});
    },
    activity(id: number): Promise<GroupActivityEntry[]> {
        return hostListAll<GroupActivityEntry>('group.listactivity', {id});
    }
};

export type {HostAsyncState, HostGroup, HostLoadState};
