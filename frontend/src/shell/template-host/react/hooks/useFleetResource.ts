// Generic async-resource hook. Load, stale-request, session and cleanup rules
// live in the core resource, so React and Vue cannot drift apart on them.

import {useEffect} from 'react';
import type {ExternalStore} from '../../core/external-store';
import {createResource, type FleetResource} from '../../core/resource';
import type {FleetSessionIdentity} from '../../core/session';
import type {FleetResourceState} from '../../core/types';
import {useFleetStore} from './useFleetStore';
import {useRetained} from './useRetained';

export type UseFleetResourceOptions<T> = {
    load: () => Promise<T>;
    initial: T;
    /** Values that change the request. A change rebuilds and reloads. */
    deps?: readonly unknown[];
    /** Skip the initial load, for a resource behind a user action. */
    immediate?: boolean;
    session?: ExternalStore<FleetSessionIdentity>;
};

export type UseFleetResourceResult<T> = FleetResourceState<T> & {
    refresh: () => Promise<void>;
};

/** Binds an already-built core resource: first load plus current snapshot. */
export function useResourceState<T>(
    resource: FleetResource<T>,
    immediate = true
): UseFleetResourceResult<T> {
    useEffect(() => {
        if (!immediate) return;
        void resource.refresh();
    }, [resource, immediate]);

    const snapshot = useFleetStore(resource);
    return {...snapshot, refresh: resource.refresh};
}

export function useFleetResource<T>(
    options: UseFleetResourceOptions<T>
): UseFleetResourceResult<T> {
    // The loader closure changes every render; the resource must not. `deps`
    // is the caller-declared request identity.
    const resource = useRetained(
        () =>
            createResource({
                load: options.load,
                initial: options.initial,
                session: options.session
            }),
        options.deps ?? []
    );

    return useResourceState(resource, options.immediate !== false);
}
