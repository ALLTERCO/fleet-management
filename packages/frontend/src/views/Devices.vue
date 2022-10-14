<template>
    <div class="columns block" v-if="length > 0">
        <div class="column is-half devices" style="border-right: 1px solid rgb(49, 52, 56)">
            <div class="devices-title">
                <span class="has-text-white section-title" >Websocket</span>
            </div>
            <div class="devices-content">
                <Badge v-for="device in getDevicesWs()" :device_mac="device.shellyID" :link="true" />
            </div>
        </div>
        <div class="column is-half devices">
            <div class="devices-title">
                <span class="has-text-white section-title">Bluetooth</span>
            </div>
            <div class="devices-content">
                <Badge v-for="device in getDevicesBle()" :device_mac="device.shellyID" :link="true" />
            </div>
        </div>
    </div>
    <div class="notification is-danger" v-else>
        <h1 class="title has-text-white">No devices connected</h1>
        Connect shelly devices via their outbound webscoket.
    </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useDevicesStore } from "../stores/devices";
import Badge from "@/components/Badge.vue";

export default defineComponent({
    components: { Badge },
    setup() {
        const deviceStore = useDevicesStore();
        const length = computed(() => {
            return Object.keys(deviceStore.devices).length;
        })
        return {
            getDevicesBle: deviceStore.getDevicesBle,
            getDevicesWs: deviceStore.getDevicesWs,
            length,
        };
    },
});
</script>

<style scoped>
.devices {
    padding: 0px
}
.devices-title {
    border-bottom: 1px solid rgb(49, 52, 56);
    padding: 1rem
}
.devices-content {
    padding-left: 0.5rem;
    padding-right: 0.5rem;
}
.devices-content>* {
    margin-bottom: 1rem;
}
.section-title {
    display: block;
    text-align: center;
}
</style>
