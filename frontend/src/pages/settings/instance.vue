<template>
    <PageTemplate title="Instance" :tabs="tabs">
        <div class="inst-layout">
            <h2 class="sr-only">Instance</h2>

            <BasicBlock darker title="Custom domains">
                <p class="inst-hint">
                    Domains that route requests to this Zitadel instance.
                </p>
                <DataList
                    :rows="info?.customDomains ?? []"
                    :columns="domainColumns"
                    row-key="domain"
                    :loading="loading"
                    empty-message="No custom domains configured."
                />
            </BasicBlock>

            <BasicBlock darker title="Trusted domains">
                <p class="inst-hint">
                    Domains trusted for OIDC discovery (proxies, custom login UIs).
                </p>
                <DataList
                    :rows="info?.trustedDomains ?? []"
                    :columns="domainColumns"
                    row-key="domain"
                    :loading="loading"
                    empty-message="No trusted domains configured."
                />
            </BasicBlock>

            <p v-if="error" class="inst-error">
                <i class="fas fa-exclamation-triangle" /> {{ error }}
            </p>
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {type ComputedRef, computed, inject, onMounted, ref} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import {useAuthStore} from '@/stores/auth';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

interface Domain {
    domain: string;
    instanceId?: string;
}

interface InstanceInfo {
    customDomains: Domain[];
    trustedDomains: Domain[];
}

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

const info = ref<InstanceInfo | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const authStore = useAuthStore();
const {canAccessPlatformAdmin} = storeToRefs(authStore);

const domainColumns: DataColumn[] = [
    {key: 'domain', label: 'Domain'},
    {key: 'instanceId', label: 'Instance ID'}
];

async function refresh(): Promise<void> {
    if (!canAccessPlatformAdmin.value) {
        error.value = 'Instance information is restricted to provider support.';
        return;
    }
    loading.value = true;
    error.value = null;
    try {
        info.value = await sendRPC<InstanceInfo>(
            'FLEET_MANAGER',
            'User.GetInstanceInfo',
            {}
        );
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        info.value = null;
    } finally {
        loading.value = false;
    }
}

onMounted(() => void refresh());
</script>

<style scoped>
.inst-layout {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.inst-hint {
    color: var(--color-text-tertiary);
    font-size: var(--type-card-footer);
    margin-bottom: var(--space-3);
}

.inst-error {
    color: var(--color-status-off);
}
</style>
