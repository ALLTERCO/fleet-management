import {shallowRef} from 'vue';
import {hostRpcAccess} from './api';
import type {HostLocation} from './core/data-contract';
import {
    createLocationDomain,
    type LocationListParams
} from './core/domains/locations';
import type {HostResource} from './types';
import {useHostResource} from './vue/composables/useHostResource';

export type {
    LocationCreateInput,
    LocationListParams,
    LocationUpdateInput
} from './core/domains/locations';

export function useLocations(
    params: LocationListParams = {}
): HostResource<HostLocation[]> {
    const items = shallowRef<HostLocation[]>([]);

    return useHostResource(
        async () => {
            // Pass the row through whole. A hand-written field list silently
            // drops everything it forgets — it already lost `kindFields`, which
            // carries timezone/siteType/geo — and drifts from the React
            // `useLocations`, which returns the same HostLocation unmapped.
            items.value = await locations.list(params);
        },
        () => items.value
    );
}

export const locations = createLocationDomain(hostRpcAccess);
