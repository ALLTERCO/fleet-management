// Shared name-substring matcher for picker grids. Empty / 1-char queries
// pass everything so the grid renders the full catalogue as soon as the
// tab opens — picker UX consistency across Tag / Location / Group /
// Action pickers.

import {type MaybeRefOrGetter, toValue} from 'vue';

export function useNameSearch(search: MaybeRefOrGetter<string>) {
    function matches(name: string): boolean {
        const query = toValue(search).toLowerCase().trim();
        return query.length < 2 || name.toLowerCase().includes(query);
    }
    return {matches};
}
