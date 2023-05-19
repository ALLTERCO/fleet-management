<template>
    <div class="response" v-if="lastResponses.length">
        <div class="panel is-link">
            <div class="select">
                <select>
                    <option v-for="(resp, index) in lastResponses" @click="selected = index" class="has-text-white"
                        style="border-color: var(--shelly-bg)" :key="resp.mac">{{ resp.mac }}</option>
                </select>
            </div>
            <div class="panel block has-background-shelly" v-if="lastResponses[selected] != undefined">
                <div class="content">
                    <pre
                        class="has-background-shelly has-text-white">{{ JSON.stringify(JSON.parse(lastResponses[selected].response), undefined, 2) }}</pre>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRpcStore } from "@/stores/rpc";
import { storeToRefs } from "pinia";

const rpcStore = useRpcStore();
const { lastResponses } = storeToRefs(rpcStore);
const selected = ref(0);
</script>

<style scoped>
.response {
    text-align: left;
}
</style>