// Pins for a map, one per location.
//
// Three separate snapshots rather than one, because a map usually colours by
// one thing at a time and fetching all three to show one is wasted work on
// every pan and zoom.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type FleetmapMethod = Extract<HostMethod, `fleetmap.${string}`>;

export type FleetFleetMapDomain = ReturnType<typeof createFleetMapDomain>;

/** All three snapshots take the same optional organization scope. */
export type HostFleetMapSnapshotParams =
    HostParams<'fleetmap.getenergysnapshot'>;
/** One pin per location: current load against its baseline. */
export type HostFleetMapEnergySnapshot =
    HostResult<'fleetmap.getenergysnapshot'>;
/** One pin per location: signal health and how many devices it covers. */
export type HostFleetMapSignalSnapshot =
    HostResult<'fleetmap.getsignalsnapshot'>;
/** One pin per location: open alerts, worst severity, oldest still active. */
export type HostFleetMapAlertSnapshot = HostResult<'fleetmap.getalertsnapshot'>;

export function createFleetMapDomain(access: FleetRpcAccess) {
    const fleetmap = namespaceCaller<FleetmapMethod>(access);

    return {
        /** Energy per location. */
        energy: (params: HostParams<'fleetmap.getenergysnapshot'> = {}) =>
            fleetmap('fleetmap.getenergysnapshot', params),
        /** Signal strength per location. */
        signal: (params: HostParams<'fleetmap.getsignalsnapshot'> = {}) =>
            fleetmap('fleetmap.getsignalsnapshot', params),
        /** Open alerts per location, with the worst severity leading. */
        alerts: (params: HostParams<'fleetmap.getalertsnapshot'> = {}) =>
            fleetmap('fleetmap.getalertsnapshot', params)
    };
}
