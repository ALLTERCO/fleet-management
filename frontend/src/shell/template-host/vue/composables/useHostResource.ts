// The legacy `@host` lists on one core resource, so `updatedAt` and
// `freshness` mean the same thing everywhere. Each caller keeps its own
// reactive `read`, because a list projected from a Fleet store still has to
// follow that store between loads — a snapshot taken at load time would stop
// moving the moment a live event arrived.

import {computed} from 'vue';
import {createResource} from '../../core/resource';
import type {HostResource} from '../../types';
import {useFleetResource} from './useFleetResource';

export function useHostResource<T>(
    fetch: () => Promise<void>,
    read: () => T
): HostResource<T> {
    const bound = useFleetResource(
        createResource<T>({
            load: async () => {
                await fetch();
                return read();
            },
            initial: read()
        })
    );

    return {
        state: bound.state,
        loading: bound.loading,
        data: computed(read),
        error: computed(() => bound.error.value?.message ?? null),
        refresh: bound.refresh,
        updatedAt: bound.updatedAt,
        freshness: bound.freshness
    };
}
