import type {ComputedRef, InjectionKey, Ref} from 'vue';
import {computed, inject, ref} from 'vue';

export interface DashboardContext {
    locationId: number | null;
    refreshSignal: Ref<number>;
}

export const DASHBOARD_CONTEXT_KEY: InjectionKey<
    ComputedRef<DashboardContext>
> = Symbol('dashboardContext');

/** Inject the dashboard context provided by [id].vue. Returns a default (no-op) context when used outside a dashboard. */
export function useDashboardContext(): ComputedRef<DashboardContext> {
    // Create the fallback outside the computed so the same ref instance is returned
    // on every computed access, rather than a new one being created on each read.
    const fallbackSignal = ref(0);
    return (
        inject(DASHBOARD_CONTEXT_KEY) ??
        computed(() => ({
            locationId: null as null,
            refreshSignal: fallbackSignal
        }))
    );
}
