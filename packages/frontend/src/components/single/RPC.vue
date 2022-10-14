<template>
    <div class="card-content has-background-shelly" v-show="shown">
        <div class="content">
            <div class="panel-block">
                <span class="has-text-white">Load from template:</span>
                <div class="select is-link">
                    <select v-model="selected_group_name" class="shelly-select">
                        <option v-for="group in rpcStore.getGroupNames" :key="group"
                            @click="response = ''; rpcStore.selectGroup(group)">{{ group }}</option>
                    </select>
                </div>
                <div class="select is-link">
                    <select v-model="selected_template_name">
                        <option v-for="template in rpcStore.getSelectedGroup" :key="template.name"
                            @click="response = ''; rpcStore.selectTemplate(template.name)">
                            {{ template.name }}</option>
                    </select>
                </div>
            </div>
            <div class="panel-block">
                <span class="has-text-white">Method:</span><input class="input" type="text" placeholder="RPC Method"
                    v-model="method" />
            </div>
            <div class="panel-block" v-show="rowData.length > 0">
                <table class="table">
                    <thead>
                        <tr>
                            <th>parameter</th>
                            <th>value</th>
                            <th>delete</th>
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
                            <td><button class="button table-button" @click="rowData.splice(index, 1)">✖</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div class="panel-block is-flex is-justify-content-space-around">
                <button class="button is-primary" @click="addRow">
                    {{ rowData.length > 0 ? "Add row" : "Add parameters" }}
                </button>
                <button class="button" @click="send">Send</button>
            </div>
            <div class="panel-block" v-if="response">
                <pre>{{response}}</pre>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, toRef } from "vue";
import { useRpcStore } from "@/stores/rpc";
import { useDevicesStore } from "@/stores/devices";
import { useToast } from "@/stores/toast";
import { storeToRefs } from "pinia";

export default defineComponent({
    props: {
        device_mac: {
            type: String,
            required: true
        }
    },
    setup(props) {
        const device_mac = toRef(props, 'device_mac');
        const rpcStore = useRpcStore();
        const deviceStore = useDevicesStore();
        const device = deviceStore.devices[device_mac.value];
        const { rowData, method, templates, selected_template_name, selected_group_name } = storeToRefs(rpcStore);
        const toast = useToast();
        const shown = ref(true);
        const response = ref();

        const addRow = () => {
            rowData.value.push(["", ""])
        }

        const send = async () => {
            try {
                if(device.source == 'ble'){
                    toast.addToast('Bluetooth device selected. Device make take up to 60 seconds to respond.')
                }
                deviceStore.selectOnlyOne(device_mac.value);
                const responses = await rpcStore.send();
                response.value = responses[device_mac.value] || {};
                toast.addToast(`RPC send to '${device_mac.value}'`, "success");
            } catch (error: any) {
                toast.addToast(`RPC failed sending to '${device_mac.value}'`, "danger");
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
            shown,
            response
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

table {
    background-color: transparent;
}

th {
    color: white !important;
}

.table-button {
    color: white;
    background-color: var(--shelly-bg);

}

pre {
	width: 100%;
	background-color: transparent;
	color: white;
	text-align: left;
	max-height: 50vh;
}
</style>