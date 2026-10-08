// Curated group namespace as a factory over injected RPC access.

import type {Group} from '@api/group';
import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess, HostVisual} from '../types';
import {visualField} from '../visual';

export type GroupListParams = {
    parentGroupId?: number | null;
    query?: string;
    groupType?: string;
    includeSummary?: boolean;
};

export type FleetGroupDomain = ReturnType<typeof createGroupDomain>;

type GroupMethod = Extract<HostMethod, `group.${string}`>;

type GroupRow = HostResult<'group.get'>;
type GroupMember = HostResult<'group.listmembers'>['items'][number];

/** A group as a template receives it: the row, plus a picture it can draw.
 *  `visual` on the row is the raw decoration; `logo` is what the host made of
 *  it, under the same name a device already uses. */
export type HostGroupRow = GroupRow & {logo?: HostVisual};

function toHostGroup(group: GroupRow): HostGroupRow {
    return {
        ...group,
        ...visualField({...group.visual, imageAssetId: group.imageAssetId})
    };
}

export function createGroupDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<GroupMethod>(access);
    return {
        async list(params: GroupListParams = {}): Promise<HostGroupRow[]> {
            const rows = await access.rpcListAll<GroupRow>(
                'group.list',
                params
            );
            return rows.map(toHostGroup);
        },
        async get(id: number, includeSummary = true): Promise<HostGroupRow> {
            return toHostGroup(await call('group.get', {id, includeSummary}));
        },
        children(id: number): Promise<GroupRow[]> {
            return access.rpcListAll<GroupRow>('group.children', {id});
        },
        async path(id: number): Promise<HostResult<'group.path'>['items']> {
            const res = await call('group.path', {id});
            return res.items ?? [];
        },
        members(
            id: number,
            subjectType?: GroupMember['subjectType']
        ): Promise<GroupMember[]> {
            return access.rpcListAll<GroupMember>('group.listmembers', {
                id,
                ...(subjectType ? {subjectType} : {})
            });
        },
        // CONTRACT MISMATCH: the backend answers {id, added} / {id, removed},
        // not a Group. Left as-is pending a decision on which side moves.
        addMembers(id: number, members: GroupMember[]): Promise<Group> {
            return access.rpc<Group>('group.addmembers', {id, members});
        },
        removeMembers(id: number, members: GroupMember[]): Promise<Group> {
            return access.rpc<Group>('group.removemembers', {id, members});
        },
        activity(
            id: number
        ): Promise<HostResult<'group.listactivity'>['items']> {
            return access.rpcListAll<
                HostResult<'group.listactivity'>['items'][number]
            >('group.listactivity', {id});
        },
        create(
            input: HostParams<'group.create'>
        ): Promise<HostResult<'group.create'>> {
            return call('group.create', input);
        },
        /** Pass `expectedRevision` to fail on a concurrent edit instead of
         *  overwriting it. */
        update(
            input: HostParams<'group.update'>
        ): Promise<HostResult<'group.update'>> {
            return call('group.update', input);
        },
        // Members are not deleted with the group, only their membership.
        delete(id: number): Promise<HostResult<'group.delete'>> {
            return call('group.delete', {id});
        },
        /** Every device membership in one call — cheaper than asking each
         *  group for its members. */
        async listDeviceMemberships(
            ids?: number[]
        ): Promise<HostResult<'group.listdevicememberships'>['items']> {
            const res = await call(
                'group.listdevicememberships',
                ids ? {ids} : {}
            );
            return res.items ?? [];
        },
        kind: {
            async list(
                params: HostParams<'group.kind.list'> = {}
            ): Promise<HostResult<'group.kind.list'>['items']> {
                const res = await call('group.kind.list', params);
                return res.items ?? [];
            },
            get(
                params: HostParams<'group.kind.get'>
            ): Promise<HostResult<'group.kind.get'>> {
                return call('group.kind.get', params);
            }
        }
    };
}
