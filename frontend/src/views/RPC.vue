<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { useRpcStore } from "../stores/rpc";
import { useToastStore } from "@/stores/toast";
import DeviceListSelectable from "@/components/rpc/DeviceListSelectable.vue";
import Responses from "@/components/rpc/Responses.vue";
import Schedule from "@/components/rpc/Schedule.vue";
import Dropdown from "@/components/Dropdown.vue";

const rpcStore = useRpcStore();
const { builder, selected, lastResponses } = rpcStore;
const toast = useToastStore();
const schedule = reactive({
    enabled: false,
    cron: ""
});

watch(schedule, (schedule) => {
    console.log(schedule)
})

type picked_t = "builder" | "json" | "template";
const picked = ref("builder" as picked_t);

async function send() {
    try {
        let cron: string | undefined = undefined;
        if (schedule.enabled) {
            if (schedule.cron.length == 0) {
                toast.addToast("Invalid cron", 'danger');
                return;
            }
            cron = schedule.cron;
        }
        toast.addToast("Attempting to send RPC calls...", 'success');
        const responses = await rpcStore.send(cron);
        toast.addToast("RPC call send", "success");
        Object.entries(responses).forEach(([mac, resp]) => {
            toast.addToast(`Received RPC response from ${mac}`, 'success')
        });
    } catch (error: any) {
        toast.addToast(error.message, "danger");
    }
}

function saveCron(cron: string) {
    schedule.cron = cron;
    toast.addToast(`Cron '${cron}' saved.`, 'success')
}
</script>

<template>
    <div class="box">
        <div class="mb-2">
            <span class="title is-4 has-text-light">Mass RPC</span>
            {{ picked }}
        </div>
        <div style="display: inline-flex;">
            <strong class="has-text-white mr-2">Load from template:</strong>
            <div class="control">
                <label class="radio">
                    <input type="radio" name="rsvp" value="builder" v-model="picked">
                    Builder
                </label>
                <label class="radio">
                    <input type="radio" name="rsvp" value="template" v-model="picked" disabled>
                    Template
                </label>
                <label class="radio">
                    <input type="radio" name="rsvp" value="json" v-model="picked" disabled>
                    JSON
                </label>
            </div>
        </div>
    </div>
    <Dropdown title="1. Build RPC" class="my-3">
        <div class="builder" v-if="picked == 'builder'">
            <div class="is-flex is-align-items-center is-flex-direction-row">
                <strong class="has-text-white mr-2">Select method:</strong>
                <div class="select is-link">
                    <select v-model="selected.group">
                        <option v-for="group in rpcStore.getGroupNames()" :key="group" @click="rpcStore.selectGroup(group)">
                            {{ group }}</option>
                    </select>
                </div>
                <div class="select is-link">
                    <select v-model="selected.template">
                        <option v-for="template in rpcStore.getSelectedGroup()" :key="template.name"
                            @click="rpcStore.selectTemplate(template.name)">
                            {{ template.name }}</option>
                    </select>
                </div>
            </div>
            <div v-show="builder.rows.length > 0">
                <hr />
                <table class="table has-text-light" style="background-color:transparent">
                    <thead>
                        <tr>
                            <th class="has-text-light">Parameter</th>
                            <th class="has-text-light">Value</th>
                            <th class="has-text-light">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(row, index) in builder.rows">
                            <td>
                                <input type="text" class="input" v-model="row[0]">
                            </td>
                            <td>
                                <input type="text" class="input" v-model="row[1]">
                            </td>
                            <td>
                                <button class="button" @click="builder.rows.splice(index, 1)">
                                    <span class="icon is-small">
                                        <i class="fas fa-trash has-text-light"></i>
                                    </span>
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </Dropdown>

    <Dropdown title="2. Select devices" class="my-3">
        <DeviceListSelectable />
    </Dropdown>

    <Dropdown title="3. Scheduling">
        <div class="field">
            <div class="control">
                <label class="checkbox">
                    <input type="checkbox" v-model="schedule.enabled">
                    Enable Schedule
                </label>
            </div>
        </div>

        <Schedule v-if="schedule.enabled" @change="(cron) => saveCron(cron)" />
    </Dropdown>

    <button class="button is-link my-3 is-fullwidth" @click="send">Send</button>

    <Dropdown title="4. Responses" class="my-3" v-if="lastResponses.length">
        <Responses />
    </Dropdown>
</template>

<style>
table {
    width: 100%;
}
</style>