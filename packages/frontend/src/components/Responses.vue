<template>
    <div class="response" v-if="last_responses.length">
        <div class="panel is-link">
            <header class="card-header" style="border-bottom: 1px solid white; border-radius: 0px;">
                <div class="card-header-title card-header-title-shelly has-text-white is-clickable is-unselectable">
                    <p style="padding-left: 0px">RPC Response</p>
                </div>
            </header>
            <div class="select">
                <select>
                    <option v-for="(resp, index) in last_responses" @click="selected = index" class="has-text-white"
                        style="border-color: var(--shelly-bg)">{{ resp.mac }}</option>
                </select>
            </div>
            <div class="panel block has-background-shelly" v-if="last_responses[selected] != undefined">
                <div class="content">
                    <pre
                        class="has-background-shelly has-text-white">{{ JSON.stringify(JSON.parse(last_responses[selected].response), undefined, 2) }}</pre>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useRpcStore } from "../stores/rpc";
import { storeToRefs } from "pinia";

export default defineComponent({
    setup() {
        const rpcStore = useRpcStore();
        const { last_responses } = storeToRefs(rpcStore);
        const selected = ref(0);

        return { last_responses, selected };
    }
})
</script>

<style scoped>
.response {
    text-align: left;
}
</style>