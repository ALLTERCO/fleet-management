<template>
    <div class="mb-2">
        <span class="title is-4 has-text-light">Settings</span>
    </div>
    <Dropdown title="Default Websocket Address" class="mb-3">
        <div class="field">
            <label class="label">Websocket Address</label>
            <div class="control">
                <input class="input" type="text" placeholder="Enter the default websocket address" v-model="websocketAddress">
            </div>
        </div>
        <button class="button is-link" @click="saveWebsocketAddress">Submit</button>
    </Dropdown>
</template>

<script setup lang="ts">
import Dropdown from "@/components/Dropdown.vue";
import * as system from "@/tools/system";
import { ref } from 'vue';
import { useToastStore } from "@/stores/toast";

const toast = useToastStore();

const websocketAddress = ref(system.getProposedWs())
function saveWebsocketAddress(){
    system.saveProposedWs(websocketAddress.value);
    toast.addToast('Saved default websocket address', 'success');
}
</script>

<style scoped>
</style>
