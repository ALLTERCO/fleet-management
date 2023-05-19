<script setup lang="ts">
import { computed } from "vue";
import { useDevicesStore } from '@/stores/devices';
import Badge from "@/components/Badge.vue";

const props = defineProps<{ source?: string }>();
const deviceStore = useDevicesStore();

const devices = computed(() => {
    const devices = Object.values(deviceStore.devices); 
    if(props.source){
        return devices.filter((d) => d.source == props.source);
    }
    return devices;
})
</script>

<template>
    <div class="block devices" v-if="devices.length > 0">
        <Badge v-for="device in devices" :device_mac="device.shellyID" :stripped="true" :link="false" :key="device.shellyID"
            @click="device.selected = !device.selected" :class="{ 'selected': device.selected }" />
    </div>
    <div class="notification is-danger" v-else>
        <h1 class="title has-text-white">No devices found</h1>
    </div>
</template>

<style scoped>
.devices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-gap: 1rem;
}

@media screen and (max-width: 760px) {
    .devices {
        grid-template-columns: 1fr;
    }
}

.selected {
    border: 1px solid greenyellow;
}
</style>