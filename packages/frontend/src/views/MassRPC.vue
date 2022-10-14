<template>
    <div v-if="Object.keys(devices).length > 0" class="block">
        <div class="columns">
            <div class="column">
                <RPC />
                <Responses />
            </div>
            <div class="column is-one-third">
                <div class="card" style="background-color: transparent;">
                    <header class="card-header" style="border-bottom: 1px solid white; border-radius: 0px;">
                        <div
                            class="card-header-title card-header-title-shelly has-text-white is-clickable is-unselectable">
                            <p style="padding-left: 0px">Devices</p>
                        </div>
                    </header>
                    <label class="panel-block has-background-shelly device-option" v-for="device in devices"
                        :key="device.shellyID" style="border-radius: 6px;">
                        <input type="checkbox" v-model="device.selected">
                        <span class="has-text-white">{{ device.shellyID }}</span>
                    </label>
                </div>
            </div>

        </div>
    </div>
    <div class="notification is-danger" v-else>
        <h1 class="title has-text-white">No devices connected</h1>
        Connect shelly devices via their outbound webscoket.
    </div>
    <Toast />
</template>

<script lang="ts">
import { storeToRefs } from "pinia";
import { defineComponent } from "vue";
import Discovered from "../components/Discovered.vue";
import { useDevicesStore } from "../stores/devices";
import RPC from "../components/RPC.vue";
import Toast from '@/components/Toast.vue';
import Responses from "@/components/Responses.vue";

export default defineComponent({
    components: { Discovered, RPC, Toast, Responses },
    setup() {
        const deviceStore = useDevicesStore();
        const { devices } = storeToRefs(deviceStore);

        return {
            devices,
        };
    },
});
</script>

<style scoped>
.devices {
    display: flex;
    flex-flow: row wrap;
    gap: 0.5rem;
}


.rpc>.left {
    display: flex;
    flex-flow: column nowrap;
    width: 500px;
}

.device-option {
    border-radius: 0px !important;
}

.device-option:hover {
    background-color: rgb(59, 62, 66);
}
</style>
