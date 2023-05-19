<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import Badge from "@/components/Badge.vue";
import { useDevicesStore } from "@/stores/devices";
import { useToastStore } from "@/stores/toast";
import JSONViewer from '@/components/JSONViewer.vue';
import Dropdown from "@/components/Dropdown.vue";
import { getProposedWs } from "@/tools/system";
import * as http from "@/tools/http";

const route = useRoute();
const router = useRouter();
const device_mac = ref(route.params.device_mac as string);
const deviceStore = useDevicesStore();
const toastStore = useToastStore();
const device = computed(() => deviceStore.devices[device_mac.value]);
const showNotification = ref(true)
const showWebsocketNotification = ref(true);
const outboundWebsocket = ref(getProposedWs())
const deviceNameField = ref(device.value.info.name);

onMounted(() => {
    if (device.value == undefined) {
        toastStore.addToast(`Cannot find '${device_mac.value}'`, 'danger')
        router.push("/")
    }
})

function mountDevice() {
    const { info, shellyID } = device.value;
    
    http.requestMountAccess(shellyID).then(() => {
        localStorage.setItem("SHELLY_TYPE", info.app);
        localStorage.setItem("SHELLY_ADDRESS", `${window.location.host}/mount/${shellyID}`);
        window.open(`${window.location.origin}/embedded/${info.app}/`, "_blank");
    });
}

function submitWebsocket() {
    deviceStore.sendRPC(device_mac.value, 'WS.SetConfig', {
        config: {
            enable: true,
            server: outboundWebsocket.value
        }
    }).then((resp) => {
        if (resp.error) {
            toastStore.addToast(`Failed to apply websocket settings to '${device_mac.value}'`, 'danger');
            console.error('error response', resp);
            return;
        }
        if (resp.result) {
            toastStore.addToast(`Applied websocket settings to '${device_mac.value}'`, 'success')
            if (resp.result.restart_required) {
                toastStore.addToast(`Sending restart to '${device_mac.value}'`, 'success')
                deviceStore.sendRPC(device_mac.value, 'Shelly.Reboot').then(() => {
                    toastStore.addToast(`Restarting device '${device_mac.value}'`, 'success')
                })
            }
        }
    });
}

function goToSettings() {
    router.push("/settings")
}

function saveDeviceName(){
    toastStore.addToast(`Changing device name to '${deviceNameField.value}'`, 'success');
    deviceStore.sendRPC(device_mac.value, 'Sys.SetConfig', { config: { device: { name: deviceNameField.value }}})

}
</script>

<template>
    <div v-if="device != undefined">
        <nav class="breadcrumb" aria-label="breadcrumbs">
            <ul>
                <li @click="router.push('/')" v-if="device.source == 'ws'"><a>Devices</a></li>
                <li @click="router.push('/discovered')" v-if="device.source == 'local'"><a>Discovered</a></li>
                <li class="is-active"><a href="#" class="has-text-grey-dark" aria-current="page">{{ device.info.name ||
                    device.info.id }}</a></li>
            </ul>
        </nav>
        <div class="columns">
            <div class="column is-half">
                <Badge :channel="0" :link="true" :device_mac="device_mac" />
                <div class="notification is-warning my-2" v-if="showNotification && device?.source !== 'ws'">
                    <button class="delete" @click="showNotification = false"></button>
                    This device is <strong>not</strong> connected via websocket. Some features may be limited or not even
                    work at all.
                    Device state is <strong>not</strong> proactively reported. Settings and statuses will remain static
                    unless manually updated.
                </div>
                <button class="button mt-2 is-link is-fullwidth" @click="mountDevice"
                    v-if="device.source == 'ws'">Mount</button>
                <Dropdown title="Connect to WS" class="mt-2" v-if="device.source == 'local'">
                    <div>
                        <div class="notification is-link" v-if="showWebsocketNotification">
                            <div class="delete" @click="showWebsocketNotification = false"></div>
                            You can change default ws address is <a @click="goToSettings">Settings</a> tab
                        </div>
                        <div class="field">
                            <div class="control">
                                <input class="input" type="text" placeholder="Outbound Websocket Address"
                                    v-model="outboundWebsocket">
                            </div>
                            <p class="help">Fleet Management address usually starts with ws:// or wss:// and ends in /shelly
                            </p>
                        </div>
                        <div class="control">
                            <button class="button is-primary" @click="submitWebsocket">Submit</button>
                        </div>
                    </div>
                </Dropdown>
            </div>
            <div class="column is-half" style="overflow: hidden;">
                <Dropdown title="Device" class="mb-3 mt-0">
                    <div class="field">
                        <label class="label">Device name</label>
                        <div class="control">
                            <input class="input" type="text" placeholder="Enter the default websocket address"
                                v-model="deviceNameField">
                        </div>
                    </div>
                    <button class="button is-link" @click="saveDeviceName">Submit</button>
                </Dropdown>

                <Dropdown title="Info" class="my-3">
                    <JSONViewer :data="device.info" />
                </Dropdown>

                <Dropdown title="Status" class="my-3">
                    <JSONViewer :data="device.status" />
                </Dropdown>

                <Dropdown title="Settings" class="mt-3 mb-1">
                    <JSONViewer :data="device.settings" />
                </Dropdown>

                <Dropdown title="Groups" class="mt-3 mb-1">
                    <JSONViewer :data="device.groups" />
                </Dropdown>
            </div>
        </div>
    </div>
    <span v-else>device not found</span>
</template>

