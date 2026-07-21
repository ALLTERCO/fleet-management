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
import {createStaleGuard} from '@/stores/staleGuard';
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

    // Writes bump so an in-flight read can't clobber them; reads never bump.
    const destinationsGuard = createStaleGuard();
    const membersGuard = createStaleGuard();

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
            // List fetch: bump so the latest fetch wins between racing fetches.
            const token = destinationsGuard.bump();
            const items = await paginate<DestinationGroup>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<DestinationGroup>>(
                        'FLEET_MANAGER',
                        'notification.destination.list',
                        {limit: MAX_DESTINATIONS_PER_PAGE, offset}
                    ),
                MAX_DESTINATIONS_PER_PAGE
            );
            if (destinationsGuard.isStale(token)) return;
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
        // Read: snapshot before the RPC; a write mid-flight discards the merge.
        const token = destinationsGuard.current();
        try {
            const d = await ws.sendRPC<DestinationGroup>(
                'FLEET_MANAGER',
                'notification.destination.get',
                {id}
            );
            if (!destinationsGuard.isStale(token)) {
                destinations.value = {...destinations.value, [d.id]: d};
            }
            return d;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load destination');
            return null;
        }
    }

    async function fetchMembers(id: number): Promise<DestinationMemberRef[]> {
        try {
            const token = membersGuard.current();
            const items = await paginate<DestinationMemberRef>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<DestinationMemberRef>>(
                        'FLEET_MANAGER',
                        'notification.destination.listmembers',
                        {id, limit: MAX_MEMBERS_PER_PAGE, offset}
                    ),
                MAX_MEMBERS_PER_PAGE
            );
            if (membersGuard.isStale(token)) return items;
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
            destinationsGuard.bump();
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
            destinationsGuard.bump();
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
            destinationsGuard.bump();
            membersGuard.bump();
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
                apply: () => applyMemberMutation(input),
                commit: () => commitMemberMutation(input),
                // Rollback refetches server truth; snapshots erase concurrent commits.
                rollback: () => reconcileMembers(input.id),
                reconcile: () => reconcileMembers(input.id),
                onError: (err) =>
                    toastRpcError(toast, err, input.failureMessage)
            });
            return true;
        } catch (_err) {
            return false;
        }
    }

    async function reconcileMembers(id: number): Promise<void> {
        await Promise.all([fetchMembers(id), fetchDestination(id)]);
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
        membersGuard.bump();
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
        destinationsGuard.bump();
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
