// What this install is doing, and why it is slow.
//
// Reads first. The operator mutations — first-boot bootstrap, the database
// write switch, observability and log levels — sit under `admin`, so a template
// author can see the boundary rather than discover it by flipping one.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type SystemMethod = Extract<HostMethod, `system.${string}`>;

export type FleetSystemDomain = ReturnType<typeof createSystemDomain>;

export function createSystemDomain(access: FleetRpcAccess) {
    const system = namespaceCaller<SystemMethod>(access);

    // Callable for the debug report, which is what `health` has always meant.
    // The rest of the health sub-namespace hangs off it rather than renaming it.
    const health = Object.assign(
        (params: HostParams<'system.health.getdebugreport'> = {}) =>
            system('system.health.getdebugreport', params),
        {
            /** Version, observability level and the authz runtime status. */
            full: (params: HostParams<'system.health.getfull'> = {}) =>
                system('system.health.getfull', params),
            /** Redis ingest. Dropped device data shows up here first. */
            streams: (params: HostParams<'system.health.getstreams'> = {}) =>
                system('system.health.getstreams', params),
            history: (params: HostParams<'system.health.gethistory'> = {}) =>
                system('system.health.gethistory', params)
        }
    );

    return {
        health,
        variables: (params: HostParams<'system.getvariables'> = {}) =>
            system('system.getvariables', params),
        topology: (params: HostParams<'system.gettopology'> = {}) =>
            system('system.gettopology', params),
        topologyDiff: (params: HostParams<'system.gettopologydiff'> = {}) =>
            system('system.gettopologydiff', params),
        moduleHistory: (params: HostParams<'system.getmodulehistory'>) =>
            system('system.getmodulehistory', params),
        /** Every open websocket. `connections` below inspects one of them. */
        listConnections: (params: HostParams<'system.listconnections'> = {}) =>
            system('system.listconnections', params),
        connections: (params: HostParams<'system.getconnectioninspector'>) =>
            system('system.getconnectioninspector', params),
        /** Frontend interaction counters. A write, but only into telemetry. */
        submitTelemetry: (params: HostParams<'system.submittelemetry'> = {}) =>
            system('system.submittelemetry', params),
        /** The raw websocket plumbing under `fleet.live`, which does its own
         *  bookkeeping. Use these only when you are managing ids yourself. */
        subscribe: (params: HostParams<'system.subscribe'>) =>
            system('system.subscribe', params),
        unsubscribe: (params: HostParams<'system.unsubscribe'>) =>
            system('system.unsubscribe', params),
        /** Where the time goes. Each returns the slowest of its kind. */
        slow: {
            rpcs: (params: HostParams<'system.getslowrpcs'> = {}) =>
                system('system.getslowrpcs', params),
            clients: (params: HostParams<'system.getslowclients'> = {}) =>
                system('system.getslowclients', params),
            builds: (params: HostParams<'system.getslowbuilds'> = {}) =>
                system('system.getslowbuilds', params),
            deviceCommands: (
                params: HostParams<'system.getslowdevicecommands'> = {}
            ) => system('system.getslowdevicecommands', params)
        },
        /** Operator permission required — these change how the install runs. */
        admin: {
            /** Re-runs first-boot setup and returns the runtime facts. */
            bootstrap: (params: HostParams<'system.bootstrap'> = {}) =>
                system('system.bootstrap', params),
            /** `set({disabled: true})` stops the system writing to its own
             *  database. Everything after that looks healthy and records nothing. */
            dbWrites: {
                get: (params: HostParams<'system.dbwrites.get'> = {}) =>
                    system('system.dbwrites.get', params),
                set: (params: HostParams<'system.dbwrites.set'>) =>
                    system('system.dbwrites.set', params)
            },
            /** Instance-wide detail level. High levels cost throughput. */
            observability: {
                set: (params: HostParams<'system.observability.set'>) =>
                    system('system.observability.set', params),
                reset: (
                    params: HostParams<'system.observability.reset'> = {}
                ) => system('system.observability.reset', params)
            },
            log: {
                levels: (params: HostParams<'system.log.listlevels'> = {}) =>
                    system('system.log.listlevels', params),
                setLevel: (params: HostParams<'system.log.setlevel'>) =>
                    system('system.log.setlevel', params)
            }
        }
    };
}
