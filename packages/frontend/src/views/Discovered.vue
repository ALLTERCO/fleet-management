<template>
    <span v-if="discovered.length == 0">
        No discovered devices
    </span>
    <div v-else>
        <h1 class="title">MDNS Discovered</h1>
        <div class="devices">
            <Discovered v-for="device in discovered" :key="device.name" :device="device" :selected="device.selected"
                @click="() => (device.selected = !device.selected)"/>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from "vue";
import Discovered from "../components/Discovered.vue";
import { discovered_t } from "../interfaces";
import * as http from "../tools/http";

export default defineComponent({
    components: { Discovered },
    setup() {
        const discovered = ref([] as (discovered_t & { selected: boolean })[]);
        onMounted(async () => {
            discovered.value = await http.getDiscovered();
        });
        return { discovered }
    }
});
</script>

<style scoped>
.devices {
    display: flex;
    flex-flow: row wrap;
    gap: 0.5rem;
}
</style>