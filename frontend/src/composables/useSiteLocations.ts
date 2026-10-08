import {computed, type Ref} from 'vue';
import {useLocationsStore} from '@/stores/locations';

// The sites a site-scoped widget shows: every location of kind 'site', sorted by
// name, narrowed to a configured id set when one is given. One home for the rule
// the Site Grid and Cross-Site widgets both need.
export function useSiteLocations(locationIds: Ref<number[] | undefined>) {
    return computed(() => {
        const sites = Object.values(useLocationsStore().locations)
            .filter((loc) => loc.kind === 'site')
            .sort((a, b) => a.name.localeCompare(b.name));
        const allow = locationIds.value;
        if (!allow?.length) return sites;
        const set = new Set(allow);
        return sites.filter((loc) => set.has(loc.id));
    });
}
