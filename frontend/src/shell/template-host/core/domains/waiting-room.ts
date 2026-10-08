// Device-onboarding namespace. Fleet permissions remain authoritative for
// every read and write; the SDK preserves the generated request contracts.
//
// A waiting device carries a picture just like a registered one, and it is
// resolved here for the same reason devices and tags resolve theirs here: the
// host owns every image rule, so no template ever computes an address. Without
// this the entry reached the template with no `logo` at all and every card in
// the waiting room fell back to a grey glyph.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess, HostVisual} from '../types';
import {visualField} from '../visual';

type WaitingRoomMethod = Extract<HostMethod, `waitingroom.${string}`>;

type WaitingRoomEntry = HostResult<'waitingroom.list'>['items'][number];

const WAITING_ROOM_PAGE_SIZE = 500;

/** An entry as a template receives it: the record, plus a picture to draw. */
export type HostWaitingRoomEntry = WaitingRoomEntry & {logo?: HostVisual};

export type FleetWaitingRoomDomain = ReturnType<typeof createWaitingRoomDomain>;

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
}

function trimmedString(
    source: Record<string, unknown>,
    key: string
): string | null {
    const value = source[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Which product image this entry should draw.
 *
 * A device that has not been admitted yet reports itself under
 * `status.sys.device`, nowhere near where a registered device keeps its model
 * (`info.model`), so the entry needs its own reader rather than the device
 * mapper's. A modular XT1 is keyed by the service it runs, not by its base
 * model — and an XT1 that has not said which service that is has no picture to
 * show, because its base model would draw the wrong product.
 */
function imageModelOf(entry: WaitingRoomEntry): string | null {
    const sys = asRecord(asRecord(entry.status).sys);
    const device = asRecord(sys.device);
    const serviceType = trimmedString(device, 'xt1SvcType');
    if (serviceType) return serviceType;
    if (sys.app === 'XT1') return null;
    return trimmedString(device, 'model');
}

/** The picture goes through the host's one model→image rule, same as a
 *  device's; `logo` is absent when the entry has not named a model yet. */
function toHostEntry(entry: WaitingRoomEntry): HostWaitingRoomEntry {
    return {...entry, ...visualField({imageModel: imageModelOf(entry)})};
}

export function createWaitingRoomDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<WaitingRoomMethod>(access);

    /** `getpending` answers with a map keyed by id, not a list envelope. */
    const pendingEntries = async (): Promise<
        Record<string, HostWaitingRoomEntry>
    > => {
        const res = await call('waitingroom.getpending', {});
        return Object.fromEntries(
            Object.entries(res).map(([key, entry]) => [key, toHostEntry(entry)])
        );
    };

    return {
        /** Both return collections. `get*` is what the RPC is called; these
         *  are the honest names, beside `list` which does the same job. */
        listPending: pendingEntries,
        listAllDenied: () => call('waitingroom.getdenied', {}),
        /** @deprecated reads as one row, returns many — use `listPending`.
         *  Removed in Fleet 2.0.0. */
        getPending: pendingEntries,
        /** @deprecated reads as one row, returns many — use `listAllDenied`.
         *  Removed in Fleet 2.0.0. */
        getDenied: () => call('waitingroom.getdenied', {}),
        counts: (params: HostParams<'waitingroom.getcounts'> = {}) =>
            call('waitingroom.getcounts', params),
        async list(params: HostParams<'waitingroom.list'> = {}) {
            const res = await call('waitingroom.list', params);
            return {...res, items: (res.items ?? []).map(toHostEntry)};
        },
        async listAll(
            params: Omit<
                HostParams<'waitingroom.list'>,
                'limit' | 'offset'
            > = {}
        ): Promise<HostWaitingRoomEntry[]> {
            const rows = await access.rpcListAll<WaitingRoomEntry>(
                'waitingroom.list',
                params,
                WAITING_ROOM_PAGE_SIZE
            );
            return rows.map(toHostEntry);
        },
        async get(entryId: string): Promise<HostWaitingRoomEntry> {
            return toHostEntry(await call('waitingroom.get', {entryId}));
        },
        probe: (entryId: string) => call('waitingroom.probe', {entryId}),
        listDenied: (params: HostParams<'waitingroom.listdenied'> = {}) =>
            call('waitingroom.listdenied', params),
        acceptPendingById: (
            params: HostParams<'waitingroom.acceptpendingbyid'>
        ) => call('waitingroom.acceptpendingbyid', params),
        acceptPendingByExternalId: (
            params: HostParams<'waitingroom.acceptpendingbyexternalid'>
        ) => call('waitingroom.acceptpendingbyexternalid', params),
        approve: (params: HostParams<'waitingroom.approve'>) =>
            call('waitingroom.approve', params),
        acceptBulkStart: (params: HostParams<'waitingroom.acceptbulkstart'>) =>
            call('waitingroom.acceptbulkstart', params),
        acceptAllStart: (
            params: HostParams<'waitingroom.acceptallstart'> = {}
        ) => call('waitingroom.acceptallstart', params),
        acceptBulkStatus: (
            params: HostParams<'waitingroom.acceptbulkstatus'>
        ) => call('waitingroom.acceptbulkstatus', params),
        acceptBulkCancel: (
            params: HostParams<'waitingroom.acceptbulkcancel'>
        ) => call('waitingroom.acceptbulkcancel', params),
        rejectPending: (params: HostParams<'waitingroom.rejectpending'>) =>
            call('waitingroom.rejectpending', params),
        reject: (params: HostParams<'waitingroom.reject'>) =>
            call('waitingroom.reject', params),
        quarantine: (params: HostParams<'waitingroom.quarantine'>) =>
            call('waitingroom.quarantine', params)
    };
}
