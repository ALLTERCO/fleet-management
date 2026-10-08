// The device change journal: every state change a device reported.
//
// This is history, not live state. A template showing "what happened to this
// fridge overnight" reads here; a template showing "what is it doing now"
// reads the live status instead. Mixing them up produces a page that looks
// live and is hours old.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type DeviceeventsMethod = Extract<HostMethod, `deviceevents.${string}`>;

export type FleetDeviceEventsDomain = ReturnType<
    typeof createDeviceEventsDomain
>;

export function createDeviceEventsDomain(access: FleetRpcAccess) {
    const deviceevents = namespaceCaller<DeviceeventsMethod>(access);

    return {
        /** Newest first. Filter by device, component and kind. */
        query: (params: HostParams<'deviceevents.query'>) =>
            deviceevents('deviceevents.query', params)
    };
}
