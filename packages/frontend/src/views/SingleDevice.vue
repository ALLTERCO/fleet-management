<template>
    <div class="container" v-if="device != undefined">
        <div class="columns">
            <div class="column">
                <Badge :device_mac="device_mac" />
                <Consumption :device_mac="device_mac" class="block" v-if="device?.source === 'ws'" />
                <Provision :device="(device as any)" v-else/>
            </div>
            <div class="column">
                <SideMenu :device_mac="device_mac" :device="(device as any)" />
            </div>
        </div>
    </div>
    <span v-else>device not found</span>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import ConsumptionChart from "@/components/single/ConsumptionChart.vue";
import Consumption from "@/components/single/Consumption.vue";
import StatusView from "@/components/single/StatusView.vue";
import SideMenu from "@/components/single/SideMenu.vue";
import Badge from "@/components/Badge.vue";
import RPC from "@/components/single/RPC.vue";
import { useDevicesStore } from "@/stores/devices";
import Provision from "@/components/single/Provision.vue";

export default defineComponent({
    components: {
    ConsumptionChart,
    StatusView,
    Consumption,
    RPC,
    SideMenu,
    Badge,
    Provision
},
    setup() {
        const route = useRoute();
        const device_mac = ref(route.params.device_mac as string);
        const deviceStore = useDevicesStore();
        const device = computed(() => deviceStore.devices[device_mac.value]);

        if(device.value == undefined) {
            useRouter().push("/")
        }

        return { device_mac, device }
    }
})
</script>