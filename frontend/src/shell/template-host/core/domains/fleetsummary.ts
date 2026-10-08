// One number for the top of a page: what the whole fleet is doing now.
//
// Live load and cumulative energy for the org, already aggregated. A template
// that instead lists every device and adds it up gets a different answer —
// the backend filters by what the caller may see, and sums three-phase meters
// correctly, which a client-side sum does not.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type FleetsummaryMethod = Extract<
    HostMethod,
    `fleetsummary.${string}` | 'fleet.getcapabilities'
>;

export type FleetFleetSummaryDomain = ReturnType<
    typeof createFleetSummaryDomain
>;

export function createFleetSummaryDomain(access: FleetRpcAccess) {
    const fleetsummary = namespaceCaller<FleetsummaryMethod>(access);

    return {
        /** Org-wide live load and cumulative energy. */
        energy: (params: HostParams<'fleetsummary.getenergy'> = {}) =>
            fleetsummary('fleetsummary.getenergy', params),

        /** What a scope's devices can actually report, so a page can decide
         *  which panels to draw instead of rendering empty ones. */
        capabilities: (params: HostParams<'fleet.getcapabilities'> = {}) =>
            fleetsummary('fleet.getcapabilities', params)
    };
}
