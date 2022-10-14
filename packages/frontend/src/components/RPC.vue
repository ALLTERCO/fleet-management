<template>
    <div class="card" style="background-color:transparent">
        <header class="card-header" style="border-bottom: 1px solid white; border-radius: 0px;">
            <div class="card-header-title card-header-title-shelly has-text-white is-clickable is-unselectable">
                <p style="padding-left: 0px">RPC Call</p>
            </div>
        </header>
        <div class="card-content has-background-shelly my-2">
            <div class="content">
                <div class="panel-block">
                    <strong class="has-text-white">Load from template:</strong>
                    <div class="select is-link">
                        <select v-model="selected_group_name">
                            <option v-for="group in rpcStore.getGroupNames" :key="group"
                                @click="rpcStore.selectGroup(group)">{{ group }}</option>
                        </select>
                    </div>
                    <div class="select is-link">
                        <select v-model="selected_template_name">
                            <option v-for="template in rpcStore.getSelectedGroup" :key="template.name"
                                @click="rpcStore.selectTemplate(template.name)">
                                {{ template.name }}</option>
                        </select>
                    </div>
                </div>
                <div class="panel-block">
                    <strong class="has-text-white">Method:</strong><input class="input" type="text" placeholder="RPC Method"
                        v-model="method" />
                </div>
                <div class="panel-block" v-show="rowData.length > 0">
                    <table class="table is-borderless"  style="background-color:transparent">
                        <thead>
                            <tr>
                                <th class="has-text-white">param</th>
                                <th class="has-text-white">value</th>
                                <th class="has-text-white">delete</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(row, index) in rowData">
                                <td>
                                    <input type="text" class="input" v-model="row[0]">
                                </td>
                                <td>
                                    <input type="text" class="input" v-model="row[1]">
                                </td>
                                <td><button class="button" @click="rowData.splice(index, 1)">✖</button></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div class="panel-block buttons">
                    <button class="button is-primary" @click="addRow">
                        {{ rowData.length > 0 ? "Add row" : "Add parameters" }}
                    </button>
                    <button class="button is-link" @click="send">Send</button>
                </div>

            </div>
        </div>
    </div>


</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useRpcStore } from "../stores/rpc";
import { useToast } from "@/stores/toast";
import { storeToRefs } from "pinia";

export default defineComponent({
    setup(props) {
        const rpcStore = useRpcStore();
        const { rowData, method, templates, selected_template_name, selected_group_name } = storeToRefs(rpcStore);
        const toast = useToast();
        const shown = ref(true);

        const addRow = () => {
            rowData.value.push(["", ""])
        }

        const send = async () => {
            try {
                toast.addToast("Attempting to send RPC calls...", 'success');
                const responses = await rpcStore.send();
                toast.addToast("RPC call send", "success");
                Object.entries(responses).forEach(([mac, resp]) => {
                    toast.addToast(`Received RPC response from ${mac}`, 'success')
                });
            } catch (error: any) {
                toast.addToast(error.message, "danger");
            }
        }

        return {
            rowData,
            method,
            addRow,
            send,
            templates,
            rpcStore,
            selected_template_name,
            selected_group_name,
            shown
        }
    }
})
</script>

<style scoped>
.table {
    width: 100%;
}

.card-content {
    padding: 0;
}

.buttons {
	display: flex;
	justify-content: space-around;
}
</style>