import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { createPinia } from 'pinia'
import * as websocket from './tools/websocket';
import './tools/http';
import './assets/style.scss'

const pinia = createPinia();

createApp(App).use(pinia).use(router).mount('#app');

import { useDevicesStore } from "./stores/devices";
import { useRpcStore } from "./stores/rpc";
import { useSystemStore } from "./stores/system";
const systemStore = useSystemStore();
if(systemStore.loggedIn){
    useDevicesStore().fetchDevices();
}
useRpcStore().fetchTemplates();
systemStore.pingBackend();
setInterval(() => {
    systemStore.pingBackend();
}, 30000);

websocket.connect();