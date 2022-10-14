<template>
    <div v-if="device" class="box tile is-2 is-flex-direction-column" :class="selected ? 'selected' : ''">
        <span class="name">{{ device.name.replace(".local", '') }}</span>
        <span class="app">{{ device.app }} <small>(v. {{device.ver}})</small></span>
        <span class="node_name"><small>node: {{ device.node_name }}</small></span>
    </div>
</template>

<script lang="ts">
    import { defineComponent, toRef } from "vue";
    import { discovered_t } from "@/interfaces";
    import * as http from "@/tools/http";

    export default defineComponent({
        props: {
            device: Object as () => discovered_t,
            selected: Boolean
        },
        setup(props) {
            const device = toRef(props, "device");
            const selected = toRef(props, "selected");
            const addDevice = () => {
                if(device.value){
                    http.addDiscovered(device.value.node_name, device.value.name);
                } 
            };
            return {
                device,
                selected,
                addDevice
            };
        },
    });
</script>

<style scoped>
    .device {
        border: 1px solid lightgray;
        width: 350px;
        border-radius: 0.5rem;
        text-align: left;
        padding: 0.5rem;
        display: flex;
        flex-flow: column;
        overflow: hidden;
        cursor: pointer;
    }
    .selected {
        border: 3px solid grey
    }
    .name {
        font-weight: 700;
        display: flex;
        align-items: baseline;
    }
</style>
