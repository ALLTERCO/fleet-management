import type {AlertInstance} from '@api/alert';
import {type InstanceFilters, useAlertsStore} from '@/stores/alerts';
import {hostRpcAccess} from './api';
import {createAlertDomain} from './core/domains/alerts';
import type {HostResource} from './types';
import {useHostResource} from './vue/composables/useHostResource';

export function useAlerts(
    filters: InstanceFilters = {}
): HostResource<AlertInstance[]> {
    const store = useAlertsStore();
    return useHostResource(
        async () => {
            await store.fetchInstances(filters, {failureMode: 'throw'});
        },
        () => Object.values(store.instances)
    );
}

export function useSupervisedAlerts(filters: InstanceFilters = {}) {
    return useAlerts(filters);
}

export const alerts = createAlertDomain(hostRpcAccess);
