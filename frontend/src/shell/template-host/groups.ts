import {type ComputedRef, computed, ref} from 'vue';
import {useGroupsStore} from '@/stores/groups';
import {hostRpcAccess} from './api';
import {createGroupDomain} from './core/domains/groups';
import type {HostAsyncState, HostLoadState, HostResource} from './types';
import {useHostResource} from './vue/composables/useHostResource';

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

export function useGroups(): HostResource<HostGroup[]> {
    const store = useGroupsStore();
    const read = (): HostGroup[] =>
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
        }));

    return useHostResource(async () => {
        await store.fetchGroups({failureMode: 'throw'});
    }, read);
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
 * Group actions as {pending, error, run}.
 *
 * The four blocks here each hand-wrote their own RPC call and their own
 * pending/error/try/catch, so the same four calls existed twice — once here
 * and once in the core group domain — and the boilerplate existed four times.
 * The calls now come from the domain; the state shape is written once below.
 */
function hostAction<TArgs extends unknown[], TResult>(
    run: (...args: TArgs) => Promise<TResult>
) {
    const pending = ref(false);
    const error = ref<string | null>(null);
    return {
        pending,
        error,
        async run(...args: TArgs): Promise<TResult> {
            pending.value = true;
            error.value = null;
            try {
                return await run(...args);
            } catch (e) {
                error.value = e instanceof Error ? e.message : String(e);
                throw e;
            } finally {
                pending.value = false;
            }
        }
    };
}

const deviceMembers = (deviceIds: string[]) =>
    deviceIds.map((subjectId) => ({subjectType: 'device' as const, subjectId}));

export function useGroupActions() {
    const store = useGroupsStore();
    // Every action refreshes the store, so a caller sees its own write.
    const andRefresh = async <T>(work: Promise<T>): Promise<T> => {
        const result = await work;
        await store.fetchGroups();
        return result;
    };

    return {
        create: hostAction(
            async (input: {
                name: string;
                metadata?: Record<string, unknown>;
            }) => {
                // group.create rejects parentGroupId (additionalProperties:
                // false). Top-level groups are implicit — leave it out.
                const created = await andRefresh(
                    groups.create({
                        name: input.name,
                        metadata: input.metadata ?? {}
                    })
                );
                return {
                    id: String(created.id),
                    name: created.name,
                    metadata: input.metadata ?? {},
                    deviceCount: 0,
                    onlineCount: 0
                } as unknown as HostGroup;
            }
        ),
        update: hostAction(async (id: string, patch: Partial<HostGroup>) => {
            await andRefresh(
                groups.update({
                    id: Number(id),
                    patch: {
                        ...(patch.name !== undefined ? {name: patch.name} : {}),
                        ...(patch.metadata !== undefined
                            ? {metadata: patch.metadata}
                            : {})
                    }
                })
            );
        }),
        addDevice: hostAction(async (groupId: string, deviceIds: string[]) => {
            await andRefresh(
                groups.addMembers(Number(groupId), deviceMembers(deviceIds))
            );
        }),
        removeDevice: hostAction(
            async (groupId: string, deviceIds: string[]) => {
                await andRefresh(
                    groups.removeMembers(
                        Number(groupId),
                        deviceMembers(deviceIds)
                    )
                );
            }
        )
    };
}

export const groups = createGroupDomain(hostRpcAccess);

export type {HostAsyncState, HostGroup, HostLoadState};
