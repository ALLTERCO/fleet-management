<template>
    <div class="column block" v-if="selected">
        <div class="request">
            <div class="panel">
                <header class="card-header" style="border-bottom: 1px solid white; border-radius: 0px;">
                    <div class="card-header-title card-header-title-shelly has-text-white is-clickable is-unselectable">
                        <p style="padding-left: 0px">Request</p>
                    </div>
                </header>
                <p class="panel-block">
                <div class="content has-shelly-background">
                    <input class="input" type="text" placeholder="RPC Method" v-model="selected.request.method"
                        readonly />
                    <table class="table is-bordered has-background-shelly has-text-white"
                        v-show="selected.request.rowData && selected.request.rowData[0] && (selected.request.rowData[0].reduce((acc, curr) => acc + curr).length > 0)">
                        <thead>
                            <tr>
                                <th class="has-text-white">param</th>
                                <th class="has-text-white">value</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in selected.request.rowData">
                                <td>
                                    {{ row[0] }}
                                </td>
                                <td>
                                    {{ row[1] }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                </p>
            </div>
        </div>
        <br />
        <div class="response">
            <div class="panel">
                <header class="card-header" style="border-bottom: 1px solid white; border-radius: 0px;">
                    <div class="card-header-title card-header-title-shelly has-text-white is-clickable is-unselectable">
                        <p style="padding-left: 0px">Response</p>
                    </div>
                </header>
                <div class="panel block has-shelly-background">
                    <div class="content">
                        <pre class="has-background-shelly has-text-white">{{ JSON.stringify(JSON.parse(selected.response), undefined, 2) }}</pre>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useHistoryStore } from "@/stores/history";

export default defineComponent({
    setup(props) {
        const historyStore = useHistoryStore();

        const selected = ref(historyStore.getSelected);

        historyStore.$subscribe((mutation, state) => {
            selected.value = historyStore.getSelected
        }, { detached: true });

        return {
            selected
        }
    }
})
</script>

<style scoped>
.column {
    overflow-y: scroll;
    max-height: 100vh;
    height: 100vh;
}

pre {
    text-align: left;
}

.response {
    text-align: left;
}
</style>