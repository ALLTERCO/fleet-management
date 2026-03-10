import {defineStore, storeToRefs} from 'pinia';
import {ref, watch} from 'vue';
import * as ws from '@/tools/websocket';
import {useAuthStore} from './auth';

export const useSystemStore = defineStore('system', () => {
    const config = ref({
        ble: false,
        mdns: {enable: false},
        grafana: {} as any
    });

    const devMode = ref(false);

    async function updateConfig() {
        try {
            config.value = await ws.getServerConfig();
            devMode.value = await ws
                .sendRPC('FLEET_MANAGER', 'FleetManager.GetVariables')
                .then((variables) => {
                    return !!variables['dev-mode'];
                });
        } catch (error) {
            console.error('failed to get server config');
        }
    }

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
        updateConfig,
        devMode
    };
});
