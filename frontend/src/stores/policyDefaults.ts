import type {AlertSeverity} from '@api/alert';
import type {GroupType} from '@api/group';
import type {
    GroupTypePolicy,
    PolicyDefaults,
    PolicyFieldKey
} from '@api/policy';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import * as ws from '../tools/websocket';
import {useToastStore} from './toast';

export interface SetDefaultPatch {
    severityFloor?: AlertSeverity | null;
    retentionDays?: number | null;
    auditRetentionDays?: number | null;
    ifUnchangedSince?: string;
}

export const usePolicyDefaultsStore = defineStore('policyDefaults', () => {
    const toast = useToastStore();

    const items = ref<GroupTypePolicy[]>([]);
    const envFallback = ref<PolicyDefaults['envFallback'] | null>(null);
    const loading = ref(true);

    function upsertItem(row: GroupTypePolicy) {
        const idx = items.value.findIndex((r) => r.groupType === row.groupType);
        if (idx >= 0) items.value[idx] = row;
        else items.value.push(row);
    }

    async function fetchDefaults() {
        loading.value = true;
        try {
            const res = await ws.sendRPC<PolicyDefaults>(
                'FLEET_MANAGER',
                'policy.getdefaults',
                {}
            );
            items.value = res.items;
            envFallback.value = res.envFallback;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load policy defaults');
        } finally {
            loading.value = false;
        }
    }

    // Returns true on success, false on RPC failure (409 stale-update included).
    async function setDefault(
        groupType: GroupType,
        patch: SetDefaultPatch
    ): Promise<boolean> {
        try {
            const row = await ws.sendRPC<GroupTypePolicy>(
                'FLEET_MANAGER',
                'policy.UpdateDefaults',
                {groupType, ...patch}
            );
            upsertItem(row);
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to save policy default');
            return false;
        }
    }

    async function resetDefault(
        groupType: GroupType,
        fields: PolicyFieldKey[]
    ): Promise<boolean> {
        try {
            const row = await ws.sendRPC<GroupTypePolicy>(
                'FLEET_MANAGER',
                'policy.resetdefault',
                {groupType, fields}
            );
            upsertItem(row);
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to reset policy default');
            return false;
        }
    }

    return {
        items,
        envFallback,
        loading,
        fetchDefaults,
        setDefault,
        resetDefault
    };
});
