import {defineStore, storeToRefs} from 'pinia';
import {computed, ref, watch} from 'vue';
import * as ws from '@/tools/websocket';
import {useAuthStore} from './auth';

export const useSystemStore = defineStore('system', () => {
    const config = ref({
        ble: false,
        mdns: {enable: false},
        grafana: {} as any
    });

    async function updateConfig() {
        try {
            config.value = await ws.getServerConfig();
        } catch (_error) {
            console.error('failed to get server config');
        }
    }

    // Grafana is a SaaS add-on; absent from OSS / basic deployments.
    // Empty config object means the backend isn't proxying /grafana.
    const grafanaConfigured = computed(() => {
        const cfg = config.value.grafana;
        return Boolean(cfg && Object.keys(cfg).length > 0);
    });

    const authStore = useAuthStore();
    const {permissionsLoaded} = storeToRefs(authStore);
    watch(
        permissionsLoaded,
        (loaded) => {
            if (loaded) {
                updateConfig();
            }
        },
        {immediate: true}
    );

    return {
        config,
        grafanaConfigured,
        updateConfig
    };
});
