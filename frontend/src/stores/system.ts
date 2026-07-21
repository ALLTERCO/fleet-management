import {defineStore, storeToRefs} from 'pinia';
import {computed, ref, watch} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import * as ws from '@/tools/websocket';
import {useAuthStore} from './auth';
import {useToastStore} from './toast';

export const useSystemStore = defineStore('system', () => {
    const toast = useToastStore();
    const config = ref({
        ble: false,
        mdns: {enable: false},
        grafana: {} as any
    });

    async function updateConfig() {
        try {
            config.value = await ws.getServerConfig();
        } catch (error) {
            toastRpcError(toast, error, 'Failed to load server configuration');
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
