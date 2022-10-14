import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { createPinia } from 'pinia'
import * as websocket from './tools/websocket';
import './tools/http';

const pinia = createPinia();

createApp(App).use(pinia).use(router).mount('#app');

import { useHistoryStore } from "@/stores/history";
import { useEventStore } from "@/stores/events";
import { useDevicesStore } from "@/stores/devices";
import { useRpcStore } from "@/stores/rpc";
import { useSystemStore } from "@/stores/system";
const systemStore = useSystemStore();
useHistoryStore().fetch();
useEventStore().changePage(1);
useDevicesStore().fetch();
useRpcStore().fetchTemplates();
systemStore.pingBackend();
console.table(process.env)
setInterval(() => {
    systemStore.pingBackend();
}, 2500);

websocket.connect();
