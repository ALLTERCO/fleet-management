// Fuzzy search over fuse.js. Empty query returns source unchanged.
// Options sourced from UI_CONFIG.search (env-driven via runtime config).

import Fuse, {type IFuseOptions} from 'fuse.js';
import {computed, type MaybeRefOrGetter, toValue} from 'vue';
import {UI_CONFIG} from '@/config/ui';

function baseOptions<T>(): IFuseOptions<T> {
    return {
        threshold: UI_CONFIG.search.threshold,
        ignoreLocation: UI_CONFIG.search.ignoreLocation,
        useExtendedSearch: true
    };
}

export function useFuzzySearch<T>(
    items: MaybeRefOrGetter<T[]>,
    query: MaybeRefOrGetter<string>,
    options: IFuseOptions<T> = {}
) {
    const fuse = computed(
        () => new Fuse<T>(toValue(items), {...baseOptions<T>(), ...options})
    );

    return computed<T[]>(() => {
        const q = toValue(query).trim();
        if (!q) return toValue(items);
        return fuse.value.search(q).map((r) => r.item);
    });
}
