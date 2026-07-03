import type {
    AlertInstance,
    AlertRule,
    AlertRuleKindDescriptor,
    AlertTransition
} from '@api/alert';
import {type ComputedRef, computed, type Ref, ref} from 'vue';
import {type InstanceFilters, useAlertsStore} from '@/stores/alerts';
import {hostListAll, hostRpc} from './rpc';
import type {HostAsyncState, HostLoadState} from './types';

export function useAlerts(
    filters: InstanceFilters = {}
): HostAsyncState<AlertInstance[]> {
    const store = useAlertsStore();
    const state: Ref<HostLoadState> = ref('idle');
    const loading = computed(() => state.value === 'loading');
    const error = ref<string | null>(null);
    const data: ComputedRef<AlertInstance[]> = computed(() =>
        Object.values(store.instances)
    );

    async function refresh(): Promise<void> {
        state.value = 'loading';
        error.value = null;
        try {
            await store.fetchInstances(filters);
            state.value = 'ready';
        } catch (err) {
            error.value = err instanceof Error ? err.message : String(err);
            state.value = 'error';
        }
    }

    return {state, loading, data, error, refresh};
}

export function useSupervisedAlerts(filters: InstanceFilters = {}) {
    return useAlerts(filters);
}

export const alerts = {
    listInstances(filters: InstanceFilters = {}): Promise<AlertInstance[]> {
        return hostListAll<AlertInstance>('alert.instance.list', filters);
    },
    getInstance(id: number): Promise<AlertInstance> {
        return hostRpc<AlertInstance>('alert.instance.get', {id});
    },
    transitions(id: number): Promise<AlertTransition[]> {
        return hostListAll<AlertTransition>('alert.instance.listtransitions', {
            id
        });
    },
    acknowledge(id: number): Promise<AlertInstance> {
        return hostRpc<AlertInstance>('alert.instance.ack', {id});
    },
    unacknowledge(id: number): Promise<AlertInstance> {
        return hostRpc<AlertInstance>('alert.instance.unack', {id});
    },
    silence(
        id: number,
        until: string,
        reason?: string | null
    ): Promise<AlertInstance> {
        return hostRpc<AlertInstance>('alert.instance.silence', {
            id,
            until,
            ...(reason ? {reason} : {})
        });
    },
    unsilence(id: number): Promise<AlertInstance> {
        return hostRpc<AlertInstance>('alert.instance.unsilence', {id});
    },
    resolve(id: number): Promise<AlertInstance> {
        return hostRpc<AlertInstance>('alert.instance.resolvemanual', {id});
    },
    listRules(): Promise<AlertRule[]> {
        return hostListAll<AlertRule>('alert.rule.list');
    },
    listKinds(): Promise<AlertRuleKindDescriptor[]> {
        return hostRpc<{items: AlertRuleKindDescriptor[]}>(
            'alert.rule.listkinds'
        ).then((res) => res.items ?? []);
    }
};
