import type {
    DestinationGroup,
    DestinationMemberRef,
    DestinationMemberType,
    DestinationModel
} from '@api/notification';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {type PagedEnvelope, paginate} from '@/helpers/pagination';
import {runOptimisticMutation} from '@/stores/optimisticMutation';
import * as ws from '../tools/websocket';
import {useToastStore} from './toast';

export type {
    DestinationGroup,
    DestinationMemberRef,
    DestinationMemberType,
    DestinationModel
};

const MAX_DESTINATIONS_PER_PAGE = 1000;
const MAX_MEMBERS_PER_PAGE = 1000;

export interface CreateDestinationParams {
    name: string;
    description?: string | null;
    enabled?: boolean;
}

export interface UpdateDestinationPatch {
    name?: string;
    description?: string | null;
    enabled?: boolean;
}

export const useDestinationsStore = defineStore('destinations', () => {
    const destinations = ref<Record<number, DestinationGroup>>({});
    const members = ref<Record<number, DestinationMemberRef[]>>({});
    const model = ref<DestinationModel | null>(null);
    const loading = ref(true);
    const toast = useToastStore();

    async function fetchModel(): Promise<DestinationModel | null> {
        if (model.value) return model.value;
        try {
            model.value = await ws.sendRPC<DestinationModel>(
                'FLEET_MANAGER',
                'notification.destination.getmodel',
                {}
            );
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load destination model');
        }
        return model.value;
    }

    async function fetchDestinations() {
        loading.value = true;
        try {
            const items = await paginate<DestinationGroup>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<DestinationGroup>>(
                        'FLEET_MANAGER',
                        'notification.destination.list',
                        {limit: MAX_DESTINATIONS_PER_PAGE, offset}
                    ),
                MAX_DESTINATIONS_PER_PAGE
            );
            const next: Record<number, DestinationGroup> = {};
            for (const d of items) next[d.id] = d;
            destinations.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load destinations');
        } finally {
            loading.value = false;
        }
    }

    async function fetchDestination(
        id: number
    ): Promise<DestinationGroup | null> {
        try {
            const d = await ws.sendRPC<DestinationGroup>(
                'FLEET_MANAGER',
                'notification.destination.get',
                {id}
            );
            destinations.value = {...destinations.value, [d.id]: d};
            return d;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load destination');
            return null;
        }
    }

    async function fetchMembers(id: number): Promise<DestinationMemberRef[]> {
        try {
            const items = await paginate<DestinationMemberRef>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<DestinationMemberRef>>(
                        'FLEET_MANAGER',
                        'notification.destination.listmembers',
                        {id, limit: MAX_MEMBERS_PER_PAGE, offset}
                    ),
                MAX_MEMBERS_PER_PAGE
            );
            members.value = {...members.value, [id]: items};
            return items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load members');
            return [];
        }
    }

    async function createDestination(
        params: CreateDestinationParams
    ): Promise<DestinationGroup | null> {
        try {
            const d = await ws.sendRPC<DestinationGroup>(
                'FLEET_MANAGER',
                'notification.destination.create',
                params
            );
            destinations.value = {...destinations.value, [d.id]: d};
            return d;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to create destination');
            return null;
        }
    }

    async function updateDestination(
        id: number,
        patch: UpdateDestinationPatch
    ): Promise<DestinationGroup | null> {
        try {
            const d = await ws.sendRPC<DestinationGroup>(
                'FLEET_MANAGER',
                'notification.destination.update',
                {id, patch}
            );
            destinations.value = {...destinations.value, [d.id]: d};
            return d;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update destination');
            return null;
        }
    }

    async function deleteDestination(id: number): Promise<boolean> {
        try {
            await ws.sendRPC(
                'FLEET_MANAGER',
                'notification.destination.delete',
                {
                    id
                }
            );
            const next = {...destinations.value};
            delete next[id];
            destinations.value = next;
            const nextMembers = {...members.value};
            delete nextMembers[id];
            members.value = nextMembers;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete destination');
            return false;
        }
    }

    async function addMembers(
        id: number,
        memberList: DestinationMemberRef[]
    ): Promise<boolean> {
        return mutateMembers({
            id,
            members: memberList,
            mode: 'add',
            method: 'notification.destination.addmembers',
            failureMessage: 'Failed to add members'
        });
    }

    async function removeMembers(
        id: number,
        memberList: DestinationMemberRef[]
    ): Promise<boolean> {
        return mutateMembers({
            id,
            members: memberList,
            mode: 'remove',
            method: 'notification.destination.removemembers',
            failureMessage: 'Failed to remove members'
        });
    }

    type MemberMutationMode = 'add' | 'remove';

    interface DestinationMembersSnapshot {
        destination?: DestinationGroup;
        members?: DestinationMemberRef[];
    }

    async function mutateMembers(input: {
        id: number;
        members: DestinationMemberRef[];
        mode: MemberMutationMode;
        method:
            | 'notification.destination.addmembers'
            | 'notification.destination.removemembers';
        failureMessage: string;
    }): Promise<boolean> {
        if (input.members.length === 0) return true;
        try {
            await runOptimisticMutation({
                snapshot: () => snapshotMembers(input.id),
                apply: () => applyMemberMutation(input),
                commit: () => commitMemberMutation(input),
                rollback: (snapshot) => restoreMembers(input.id, snapshot),
                reconcile: async () => {
                    await Promise.all([
                        fetchMembers(input.id),
                        fetchDestination(input.id)
                    ]);
                },
                onError: (err) =>
                    toastRpcError(toast, err, input.failureMessage)
            });
            return true;
        } catch (_err) {
            return false;
        }
    }

    function snapshotMembers(id: number): DestinationMembersSnapshot {
        return {
            destination: destinations.value[id],
            members: members.value[id]
        };
    }

    function restoreMembers(
        id: number,
        snapshot: DestinationMembersSnapshot | undefined
    ): void {
        restoreDestination(id, snapshot?.destination);
        restoreMemberList(id, snapshot?.members);
    }

    function restoreDestination(
        id: number,
        destination: DestinationGroup | undefined
    ): void {
        const next = {...destinations.value};
        if (destination === undefined) {
            delete next[id];
        } else {
            next[id] = destination;
        }
        destinations.value = next;
    }

    function restoreMemberList(
        id: number,
        previous: DestinationMemberRef[] | undefined
    ): void {
        const next = {...members.value};
        if (previous === undefined) {
            delete next[id];
        } else {
            next[id] = previous;
        }
        members.value = next;
    }

    function applyMemberMutation(input: {
        id: number;
        members: DestinationMemberRef[];
        mode: MemberMutationMode;
    }): void {
        const current = members.value[input.id] ?? [];
        const nextMembers =
            input.mode === 'add'
                ? withAddedMembers(current, input.members)
                : withoutRemovedMembers(current, input.members);
        members.value = {...members.value, [input.id]: nextMembers};
        applyMemberCount(input.id, nextMembers.length);
    }

    function withAddedMembers(
        current: DestinationMemberRef[],
        added: DestinationMemberRef[]
    ): DestinationMemberRef[] {
        const byKey = new Map(
            current.map((member) => [memberKey(member), member])
        );
        for (const member of added) byKey.set(memberKey(member), member);
        return Array.from(byKey.values());
    }

    function withoutRemovedMembers(
        current: DestinationMemberRef[],
        removed: DestinationMemberRef[]
    ): DestinationMemberRef[] {
        const removedKeys = new Set(removed.map(memberKey));
        return current.filter((member) => !removedKeys.has(memberKey(member)));
    }

    function memberKey(member: DestinationMemberRef): string {
        return `${member.memberType}:${member.memberId}`;
    }

    function applyMemberCount(id: number, count: number): void {
        const destination = destinations.value[id];
        if (!destination) return;
        destinations.value = {
            ...destinations.value,
            [id]: {
                ...destination,
                counts: {...destination.counts, members: count}
            }
        };
    }

    async function commitMemberMutation(input: {
        id: number;
        members: DestinationMemberRef[];
        method:
            | 'notification.destination.addmembers'
            | 'notification.destination.removemembers';
    }): Promise<void> {
        await ws.sendRPC('FLEET_MANAGER', input.method, {
            id: input.id,
            members: input.members
        });
    }

    return {
        destinations,
        members,
        model,
        loading,
        fetchModel,
        fetchDestinations,
        fetchDestination,
        fetchMembers,
        createDestination,
        updateDestination,
        deleteDestination,
        addMembers,
        removeMembers
    };
});
