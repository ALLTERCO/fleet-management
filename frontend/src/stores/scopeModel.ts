// Backend-owned form vocabulary. Fetched once, cleared on ws teardown.

import type {OrganizationScopeModel} from '@api/organization';
import {defineStore} from 'pinia';
import {computed, ref} from 'vue';
import * as ws from '@/tools/websocket';

export const useScopeModelStore = defineStore('scopeModel', () => {
    const model = ref<OrganizationScopeModel | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);
    let inFlight: Promise<OrganizationScopeModel | null> | null = null;

    async function fetch(): Promise<OrganizationScopeModel | null> {
        if (model.value) return model.value;
        if (inFlight) return inFlight;
        loading.value = true;
        error.value = null;
        inFlight = (async () => {
            try {
                const res = await ws.sendRPC<OrganizationScopeModel>(
                    'FLEET_MANAGER',
                    'organization.getscopemodel',
                    {}
                );
                model.value = res;
                return res;
            } catch (e) {
                error.value = e instanceof Error ? e.message : String(e);
                console.error('[scopeModel] fetch failed', e);
                return null;
            } finally {
                loading.value = false;
                inFlight = null;
            }
        })();
        return inFlight;
    }

    const locationKinds = computed(() => model.value?.locationKinds ?? []);
    const groupTypes = computed(() => model.value?.groupTypes ?? []);
    const membershipModes = computed(() => model.value?.membershipModes ?? []);
    const groupMemberTypes = computed(
        () => model.value?.groupMemberTypes ?? []
    );
    const tagAssignmentTypes = computed(
        () => model.value?.tagAssignmentTypes ?? []
    );
    const locationAssignmentTypes = computed(
        () => model.value?.locationAssignmentTypes ?? []
    );
    const capabilities = computed(() => model.value?.capabilities ?? null);
    const legacyTransition = computed(
        () => model.value?.legacyTransition ?? null
    );

    function $dispose() {
        model.value = null;
        loading.value = false;
        error.value = null;
        inFlight = null;
    }

    return {
        model,
        loading,
        error,
        fetch,
        locationKinds,
        groupTypes,
        membershipModes,
        groupMemberTypes,
        tagAssignmentTypes,
        locationAssignmentTypes,
        capabilities,
        legacyTransition,
        $dispose
    };
});
