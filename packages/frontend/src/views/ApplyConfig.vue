<template>
    <div class="columns" v-if="Object.keys(devices).length > 0">
        <div class="column">
            <div class="card" style="background-color: transparent;">
                <header class="card-header" style="border-bottom: 1px solid white; border-radius: 0px;">
                    <div class="card-header-title card-header-title-shelly has-text-white is-clickable is-unselectable">
                        <p style="padding-left: 0px">Configuration</p>
                    </div>
                </header>
                <div class="panel-block has-background-shelly mt-2" style="border-radius: 6px;">
                    <div class="field is-grouped">
                        <label class="has-text-white">Select source:</label>
                        <p class="control">
                        <div class="select" @change="sourceChange">
                            <select v-model="source">
                                <option v-for="src in sources">{{ src }}</option>
                            </select>
                        </div>
                        </p>

                        <p class="control" v-if="source == sources[0]">
                        <div class="select">
                            <select @change="templateChange()" v-model="selectedValue">
                                <option v-for="template in Object.keys(templates)">{{
                                template
                                }}</option>
                            </select>
                        </div>
                        </p>
                        <p class="control" v-if="source == sources[1]">
                        <div class="select">
                            <select @change="deviceChange" v-model="selectedDevice">
                                <option v-for="device in devices">{{ device.shellyID }}</option>
                            </select>
                        </div>
                        </p>
                    </div>
                </div>
                <div class="panel-block has-background-shelly mt-2" style="border-radius: 6px; position: relative;" v-if="config">
                    <pre>{{ formattedConfig }}</pre>
                    <span class="icon has-text-primary is-clickable" style="position: absolute; top: 0.5rem; right: 0.5rem" @click="openModal = true">
                        <i class="fas fa-edit"></i>
                    </span>
                </div>
                <button class="button is-fullwidth is-primary mt-2" @click="apply">Apply Configuration To Selected
                    Devices</button>

            </div>
        </div>
        <div class="column is-one-third">
            <div class="card" style="background-color: transparent;">
                <header class="card-header" style="border-bottom: 1px solid white; border-radius: 0px;">
                    <div class="card-header-title card-header-title-shelly has-text-white is-clickable is-unselectable">
                        <p style="padding-left: 0px">Apply To</p>
                    </div>
                </header>
                <label class="panel-block has-background-shelly device-option" v-for="device in devices"
                    :key="device.shellyID" style="border-radius: 6px;">
                    <input type="checkbox" v-model="device.selected">
                    <span class="has-text-white">{{ device.shellyID }}</span>
                </label>
            </div>
        </div>
    </div>
    <div class="notification is-danger" v-else>
        <h1 class="title has-text-white">No devices connected</h1>
        Connect shelly devices via their outbound webscoket.
    </div>
    <div class="modal" :class="{'is-active': openModal}">
        <div class="modal-background"></div>
        <div class="modal-content" style="width: 70vw; height: 70vh;">
            <textarea class="textarea has-background-shelly has-text-white" style="height: 70vh"
                        v-model="displayConfig">{{ displayConfig }}</textarea>
        </div>
        <button class="modal-close is-large" aria-label="close" @click="openModal = false"></button>
    </div>
</template>

<script lang="ts">
import { storeToRefs } from "pinia";
import { defineComponent, onMounted, reactive, ref, watch } from "vue";
import { useDevicesStore } from "../stores/devices";
import { applyConfig } from '@/tools/http';
import { computed } from "@vue/reactivity";
import Toast from '@/components/Toast.vue'
import { useToast } from "@/stores/toast";

const sources = ['Template', 'From device'];

const templates = reactive({
    "Disable Bluetooth": { ble: { enable: false } },
    "Enable Bluetooth": { ble: { enable: true } },
} as { [key: string]: object });

export default defineComponent({
    components: { Toast },
    setup() {
        const deviceStore = useDevicesStore();
        const { devices } = storeToRefs(deviceStore);
        const source = ref(sources[0])
        const config = ref({} as any);
        const displayConfig = ref("");
        const selectedValue = ref(Object.keys(templates)[0]);
        const selectedDevice = ref(devices.value[0] ? devices.value[0].shellyID : "");
        const openModal = ref(false);

        const toast = useToast();

        const templateChange = () => {
            config.value = templates[selectedValue.value];
        }

        watch(config, () => {
            displayConfig.value = JSON.stringify(config.value, undefined, 2);
        })

        const formattedConfig = computed(() => {
            try {
                return JSON.stringify(JSON.parse(displayConfig.value), undefined, 2);
            } catch (error) {
                return (error as any).message;
            }
        })

        const deviceChange = async () => {
            try {
                config.value = "loading...";
                const device = deviceStore.devices[selectedDevice.value];
                if (device == undefined) return;
                const resp = await deviceStore.sendRPC(device.shellyID, 'Shelly.GetConfig');
                if (resp == undefined) return;
                config.value = resp;
            } catch (error) {
                config.value = "";
            }
        }

        const sourceChange = () => {
            if (source.value == sources[0]) {
                templateChange();
            } else if (source.value == sources[1]) {
                deviceChange();
            }
        }

        onMounted(() => {
            sourceChange()
        })

        const apply = () => {
            let conf: any;
            try {
                conf = JSON.parse(displayConfig.value);
            } catch (error: any) {
                toast.addToast("Failed to apply config. " + error.message);
                return;
            }
            toast.addToast('Applying configuration...', 'success')
            deviceStore.getSelected.forEach(
                dev => applyConfig(dev.shellyID, conf)
                    .then(() => toast.addToast("Confid applied to " + dev.shellyID, 'success'),
                        () => toast.addToast('Failed to apply config to ' + dev.shellyID)))
        }

        return {
            devices,
            source,
            sources,
            templates,
            config,
            selectedValue,
            templateChange,
            deviceChange,
            selectedDevice,
            sourceChange,
            apply,
            displayConfig,
            formattedConfig,
            openModal
        };
    },
});
</script>

<style scoped>
.device-option {
    border-radius: 0px !important;
}

.device-option:hover {
    background-color: rgb(59, 62, 66);
}

pre {
    text-align: left;
    background-color: var(--shelly-comp-bg);
    color: white;
    max-height: 50vh;
    width: 100%;
}

.panel-block {
    border-bottom: 0px;
}
</style>