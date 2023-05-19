import { defineStore } from 'pinia';
import * as ws from '@/tools/websocket'
import { healthCheck } from '@/tools/http'
import { useDevicesStore } from './devices';
import { computed, reactive, ref, Ref } from 'vue';

export const useSystemStore = defineStore('system', () => {
    const config = ref({
        ble: false,
    });
    const groups: Ref<Record<string, string[]>> = ref({});
    const backend = reactive({
        url: `http://${window.location.host}`,
        connected: true
    });
    const token = ref(localStorage.getItem('fleet-management-token') || '');

    const loggedIn = computed(() => {
        if (token.value.length == 0) {
            return false;
        }
        let decoded;
        try {
            decoded = JSON.parse(atob(token.value.split(".")[1]));
        } catch (error) {
            return false;
        }

        return Number(decoded.exp) > Date.now() / 1000;
    });

    async function updateConfig() {
        try {
            config.value = await ws.getServerConfig();
        } catch (error) {
            console.error("failed to get server config")
        }
    }

    async function updateGroups() {
        try {
            groups.value = await ws.listGroups();
        } catch (error) {
            console.error("failed to get server config")
        }
    }

    async function pingBackend() {
        try {
            backend.connected = await healthCheck().then(res => res.online === true);
        } catch (error) {
            console.error("error in backend health check", error)
            backend.connected = false;
        }
    }

    function setToken(pass_token: string) {
        token.value = pass_token;
        localStorage.setItem('fleet-management-token', pass_token);
        useDevicesStore().fetchDevices();
    }

    return {
        config, groups, backend, token, loggedIn,
        updateConfig, updateGroups, pingBackend, setToken
    };
});