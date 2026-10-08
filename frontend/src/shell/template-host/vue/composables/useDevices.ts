// The Vue half of the live device list. It runs the same core resource as the
// React hook, so the two renderers cannot disagree about the same events.

import type {HostDeviceListParams} from '../../core/data-contract';
import {createLiveDevices, loadDevicesByCursor} from '../../core/live-devices';
import type {HostDevice} from '../../core/types';
import {useFleetRuntime} from '../provider';
import {useFleetResource, type VueFleetResource} from './useFleetResource';

/** Loads the whole scope once, then tracks it from the live feed. */
export function useDevices(
    params: HostDeviceListParams = {}
): VueFleetResource<readonly HostDevice[]> {
    const runtime = useFleetRuntime();
    const domain = runtime.fleet.devices;
    const devices = createLiveDevices({
        load: () =>
            loadDevicesByCursor((page) => domain.listPage(page), params),
        loadByIds: (shellyIDs) =>
            domain.list({
                ...params,
                shellyIDs: [...shellyIDs],
                limit: shellyIDs.length
            }),
        live: runtime.fleet.live,
        session: runtime.session
    });
    devices.listen();
    // Binding owns teardown: leaving the scope disposes, which stops listening.
    const bound = useFleetResource(devices);
    void bound.refresh();
    return bound;
}
