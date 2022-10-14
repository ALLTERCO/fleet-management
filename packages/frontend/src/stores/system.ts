import { defineStore } from 'pinia';
import * as http from '../tools/http'

export const useSystemStore = defineStore('system', {
    state: () => {
        return {
            backendUri: process.env['VUE_APP_BACKEND_URI'] || '',
            backendConnected: true
        }
    },
    actions: {
        async pingBackend() {
            try {
                this.backendConnected = await http.healthCheck()
                    .then(res => res.online === true);
            } catch (error) {
                this.backendConnected = false;
            }
        }
    }
})