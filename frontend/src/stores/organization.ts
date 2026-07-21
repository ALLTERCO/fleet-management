// Caller-org profile (sidebar brand mark). Fetched once after login;
// Organization.ProfileUpdated triggers a guarded refetch.

import type {OrganizationProfile} from '@api/organization';
import {defineStore} from 'pinia';
import {computed, ref} from 'vue';
import * as ws from '@/tools/websocket';

export const useOrganizationStore = defineStore('organization', () => {
    const profile = ref<OrganizationProfile | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);
    let inFlight: Promise<OrganizationProfile | null> | null = null;

    async function fetchProfile(): Promise<OrganizationProfile | null> {
        if (profile.value) return profile.value;
        return refetchProfile();
    }

    // WS liveness entry — always hits the backend; a read, never a bump.
    async function refetchProfile(): Promise<OrganizationProfile | null> {
        if (inFlight) return inFlight;
        loading.value = true;
        error.value = null;
        inFlight = (async () => {
            try {
                const res = await ws.sendRPC<OrganizationProfile>(
                    'FLEET_MANAGER',
                    'organization.getprofile',
                    {}
                );
                profile.value = res;
                return res;
            } catch (e) {
                error.value = e instanceof Error ? e.message : String(e);
                console.error('[organization] profile fetch failed', e);
                return null;
            } finally {
                loading.value = false;
                inFlight = null;
            }
        })();
        return inFlight;
    }

    const brandInitials = computed(() => profile.value?.brandInitials ?? null);
    const brandColor = computed(() => profile.value?.brandColor ?? null);

    function $dispose() {
        profile.value = null;
        loading.value = false;
        error.value = null;
        inFlight = null;
    }

    return {
        profile,
        loading,
        error,
        fetchProfile,
        refetchProfile,
        brandInitials,
        brandColor,
        $dispose
    };
});
