// Time-driven jobs on a device.
//
// `deleteAll` is here because a device being handed to a new tenant must not
// keep firing the old one's schedules. It is the one verb people forget and
// the one that leaks between customers.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type ScheduleMethod = Extract<HostMethod, `schedule.${string}`>;

export type FleetSchedulesDomain = ReturnType<typeof createSchedulesDomain>;

export function createSchedulesDomain(access: FleetRpcAccess) {
    const schedule = namespaceCaller<ScheduleMethod>(access);

    return {
        list: (params: HostParams<'schedule.list'>) =>
            schedule('schedule.list', params),
        create: (params: HostParams<'schedule.create'>) =>
            schedule('schedule.create', params),
        update: (params: HostParams<'schedule.update'>) =>
            schedule('schedule.update', params),
        delete: (params: HostParams<'schedule.delete'>) =>
            schedule('schedule.delete', params),
        /** Clears every schedule on the device. Use when reassigning it. */
        deleteAll: (params: HostParams<'schedule.deleteall'>) =>
            schedule('schedule.deleteall', params)
    };
}
