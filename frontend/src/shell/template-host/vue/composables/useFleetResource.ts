// Projects a core resource onto the Vue shape templates already use.

import {type ComputedRef, computed, getCurrentScope, onScopeDispose} from 'vue';
import type {FleetSdkError} from '../../core/errors';
import type {FleetResource} from '../../core/resource';
import type {
    FleetFreshness,
    FleetResourceState,
    HostLoadState
} from '../../core/types';
import {useExternalStore} from '../external-store';

export type VueFleetResource<T> = {
    state: ComputedRef<HostLoadState>;
    loading: ComputedRef<boolean>;
    data: ComputedRef<T>;
    error: ComputedRef<FleetSdkError | null>;
    freshness: ComputedRef<FleetFreshness>;
    updatedAt: ComputedRef<number | null>;
    refresh: () => Promise<void>;
};

export function useFleetResource<T>(
    resource: FleetResource<T>
): VueFleetResource<T> {
    const snapshot = useExternalStore<FleetResourceState<T>>(resource);
    resource.attach();
    if (getCurrentScope()) onScopeDispose(() => resource.dispose());

    return {
        state: computed(() => snapshot.value.status),
        loading: computed(() => snapshot.value.status === 'loading'),
        data: computed(() => snapshot.value.data),
        error: computed(() => snapshot.value.error),
        freshness: computed(() => snapshot.value.freshness),
        updatedAt: computed(() => snapshot.value.updatedAt),
        refresh: () => resource.refresh()
    };
}
