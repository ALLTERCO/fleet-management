// Tags: the labels a customer puts on their own things.
//
// There was no domain here at all — only an untyped passthrough. So a template
// asking for tags got `Record<string, unknown>` rows and had to build
// `/api/assets/<uuid>` itself to draw one, which is the fake-image bug we
// already fixed once for devices.
//
// A tag carries icon, colour and an uploaded image, so it goes through the
// same visual rule devices use: the host resolves the picture, the template
// renders the descriptor and never computes an address.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess, HostVisual} from '../types';
import {visualField} from '../visual';

type TagMethod = Extract<HostMethod, `tag.${string}`>;

type TagRow = HostResult<'tag.list'>['items'][number];

/** A tag as a template receives it: the row, plus a picture it can draw. */
export type HostTag = TagRow & {logo?: HostVisual};

export type FleetTagDomain = ReturnType<typeof createTagDomain>;

/** The row already carries icon/colour/image; the host turns them into one
 *  descriptor so every surface draws a tag the same way. */
function toHostTag(tag: TagRow): HostTag {
    return {...tag, ...visualField(tag)};
}

export function createTagDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<TagMethod>(access);

    return {
        async list(params: HostParams<'tag.list'> = {}): Promise<HostTag[]> {
            const rows = await access.rpcListAll<TagRow>('tag.list', params);
            return rows.map(toHostTag);
        },
        async get(params: HostParams<'tag.get'>): Promise<HostTag> {
            return toHostTag((await call('tag.get', params)) as TagRow);
        },
        create: (params: HostParams<'tag.create'>) =>
            call('tag.create', params),
        update: (params: HostParams<'tag.update'>) =>
            call('tag.update', params),
        delete: (params: HostParams<'tag.delete'>) =>
            call('tag.delete', params),

        /** Idempotent both ways: assigning twice is not an error, and neither
         *  is removing something that was never there. */
        assign: (params: HostParams<'tag.assign'>) =>
            call('tag.assign', params),
        unassign: (params: HostParams<'tag.unassign'>) =>
            call('tag.unassign', params),

        /** Who carries this tag. */
        assignments: (params: HostParams<'tag.listassignments'>) =>
            call('tag.listassignments', params),
        /** What this one thing is tagged with — the other direction. */
        forSubject: (params: HostParams<'tag.listforsubject'>) =>
            call('tag.listforsubject', params)
    };
}
