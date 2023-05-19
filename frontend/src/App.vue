<template>
    <template v-if="backend.connected">
        <DefaultLayout v-if="loggedIn">
            <router-view />
        </DefaultLayout>
        <BasicLayout v-else>
            <Login style="margin: auto" />
        </BasicLayout>
    </template>
    <BasicLayout v-else>
        <div class="is-flex" style="align-items: center; justify-content: center; height: 100vh;">
            <article class="message is-danger m-auto">
                <div class="message-body">
                    Failed to connect to backend. Please check your configuration.
                </div>
            </article>
        </div>
    </BasicLayout>
    <Toast />
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { watch } from "vue";
import { useSystemStore } from "@/stores/system";
import { useDevicesStore } from "@/stores/devices";
import Toast from "@/components/Toast.vue";
import Login from "@/views/Login.vue";
import BasicLayout from "./layouts/BasicLayout.vue";
import DefaultLayout from "./layouts/DefaultLayout.vue";

const systemStore = useSystemStore();
const deviceStore = useDevicesStore();
const { backend } = storeToRefs(systemStore);
const { loggedIn } = storeToRefs(systemStore);
systemStore.updateConfig();
systemStore.updateGroups();

watch(backend, (backend) => {
    if (backend.connected && loggedIn.value) {
        deviceStore.fetchDevices();
    } else {
        deviceStore.devices = {};
    }
});
</script>