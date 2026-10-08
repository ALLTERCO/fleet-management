import type {
    OperationalPolicies,
    OperationalPolicyFamily,
    OperationalPolicyRegistry,
    OperationalPolicySelectorCatalog
} from '@api/operations';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {formatRpcError} from '@/helpers/domainErrors';
import {createStaleGuard} from '@/stores/staleGuard';
import * as ws from '@/tools/websocket';

export type {
    OperationalPolicies,
    OperationalPolicyRegistry,
    OperationalPolicySelectorCatalog
};

export const useOperationalPoliciesStore = defineStore(
    'operationalPolicies',
    () => {
        const registry = ref<OperationalPolicyRegistry | null>(null);
        const policies = ref<OperationalPolicies | null>(null);
        const loading = ref(false);
        const saving = ref(false);
        const error = ref<string | null>(null);
        const guard = createStaleGuard();
        const selectorCatalog = ref<OperationalPolicySelectorCatalog | null>(
            null
        );
        const selectorLoading = ref(false);
        const selectorError = ref<string | null>(null);
        let selectorRequest = 0;

        async function fetch(organizationId?: string): Promise<void> {
            const token = guard.current();
            loading.value = true;
            error.value = null;
            try {
                const [nextRegistry, nextPolicies] = await Promise.all([
                    ws.sendRPC<OperationalPolicyRegistry>(
                        'FLEET_MANAGER',
                        'operations.getpolicyregistry',
                        {organizationId}
                    ),
                    ws.sendRPC<OperationalPolicies>(
                        'FLEET_MANAGER',
                        'operations.getpolicies',
                        {organizationId}
                    )
                ]);
                if (guard.isStale(token)) return;
                registry.value = nextRegistry;
                policies.value = nextPolicies;
            } catch (err) {
                if (guard.isStale(token)) return;
                error.value = formatRpcError(
                    err,
                    'Fleet could not load operational policies.'
                );
            } finally {
                if (!guard.isStale(token)) loading.value = false;
            }
        }

        function invalidate(): void {
            guard.bump();
            registry.value = null;
            policies.value = null;
            loading.value = false;
            error.value = null;
            selectorCatalog.value = null;
            selectorLoading.value = false;
            selectorError.value = null;
        }

        async function fetchSelectorCatalog(
            family: OperationalPolicyFamily,
            locationId?: number,
            organizationId?: string
        ): Promise<OperationalPolicySelectorCatalog | null> {
            const request = ++selectorRequest;
            selectorCatalog.value = null;
            selectorLoading.value = true;
            selectorError.value = null;
            try {
                const catalog =
                    await ws.sendRPC<OperationalPolicySelectorCatalog>(
                        'FLEET_MANAGER',
                        'operations.getpolicyselectorcatalog',
                        {organizationId, family, locationId}
                    );
                if (request !== selectorRequest) return null;
                selectorCatalog.value = catalog;
                selectorError.value = null;
                return catalog;
            } catch (err) {
                if (request !== selectorRequest) return null;
                selectorCatalog.value = null;
                selectorError.value = formatRpcError(
                    err,
                    'Fleet could not load policy source choices.'
                );
                return null;
            } finally {
                if (request === selectorRequest) selectorLoading.value = false;
            }
        }

        async function save(
            family: OperationalPolicyFamily,
            policy: Record<string, unknown>,
            organizationId?: string
        ): Promise<boolean> {
            guard.bump();
            saving.value = true;
            error.value = null;
            try {
                await ws.sendRPC('FLEET_MANAGER', 'operations.setpolicy', {
                    organizationId,
                    family,
                    policy
                });
                await fetch(organizationId);
                return true;
            } catch (err) {
                error.value = formatRpcError(
                    err,
                    'Fleet could not save this operational policy.'
                );
                return false;
            } finally {
                saving.value = false;
            }
        }

        async function remove(
            family: OperationalPolicyFamily,
            policyId: string,
            organizationId?: string
        ): Promise<boolean> {
            guard.bump();
            saving.value = true;
            error.value = null;
            try {
                await ws.sendRPC('FLEET_MANAGER', 'operations.deletepolicy', {
                    organizationId,
                    family,
                    policyId
                });
                await fetch(organizationId);
                return true;
            } catch (err) {
                error.value = formatRpcError(
                    err,
                    'Fleet could not delete this operational policy.'
                );
                return false;
            } finally {
                saving.value = false;
            }
        }

        return {
            registry,
            policies,
            loading,
            saving,
            error,
            selectorCatalog,
            selectorLoading,
            selectorError,
            fetch,
            fetchSelectorCatalog,
            invalidate,
            save,
            remove
        };
    }
);
