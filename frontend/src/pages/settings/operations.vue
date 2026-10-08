<template>
    <PageTemplate title="Operations" fill>
        <OperationsCatalogPanel
            :operations="store.registry?.operations ?? []"
            :policies="store.policies"
            :loading="store.loading"
            :saving="store.saving"
            :error="store.error"
            :can-write="canWrite"
            @retry="load"
            @save="save"
            @remove="remove"
        />
    </PageTemplate>
</template>

<script setup lang="ts">
import type {OperationalPolicyFamily} from '@api/operations';
import {computed, onMounted} from 'vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import OperationsCatalogPanel from '@/components/pages/settings/operations/OperationsCatalogPanel.vue';
import {useAuthStore} from '@/stores/auth';
import {useOperationalPoliciesStore} from '@/stores/operationalPolicies';

defineOptions({name: 'OperationsSettings'});

const store = useOperationalPoliciesStore();
const auth = useAuthStore();
const canWrite = computed(() =>
    auth.canPerformComponent('organizations', 'update')
);

function load(): void {
    void store.fetch();
}

function save(
    family: OperationalPolicyFamily,
    policy: Record<string, unknown>
): void {
    void store.save(family, policy);
}

function remove(family: OperationalPolicyFamily, policyId: string): void {
    void store.remove(family, policyId);
}

onMounted(load);
</script>
