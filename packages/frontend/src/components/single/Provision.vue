<template>
    <div class="card" style="background-color: transparent;">
        <header class="card-header" @click="shown = !shown" style="border-bottom: 1px solid white; border-radius: 0px;">
            <div class="card-header-title card-header-title-shelly has-text-white is-clickable is-unselectable">
                <span class="icon" style="border-right: 1px solid white;">
                    <i class="fas fa-bolt"></i>
                </span>
                <template v-if="shown">
                    <span class="icon">
                        <i class="fas fa-chevron-down"></i>
                    </span>
                </template>
                <template v-else>
                    <span class="icon">
                        <i class="fas fa-chevron-right"></i>
                    </span>
                </template>
                <p style="padding-left: 0px">
                    Provision
                </p>
            </div>
        </header>
        <Transition name="slidedown">
            <div class="card-content has-background-shelly" style="text-align: left;" v-show="shown">
                <div class="field">
                    <label class="label has-text-white">WiFi SSID</label>
                    <div class="control has-icons-left has-icons-right">
                        <input class="input" type="text" placeholder="WiFi SSID" v-model="provisionData.wifi.ssid">
                        <span class="icon is-small is-left">
                            <i class="fas fa-wifi"></i>
                        </span>
                    </div>
                </div>

                <div class="field">
                    <label class="label has-text-white">WiFi Password</label>
                    <div class="control has-icons-left has-icons-right">
                        <input class="input" type="email" placeholder="WiFi Password" v-model="provisionData.wifi.pass">
                        <span class="icon is-small is-left">
                            <i class="fas fa-key"></i>
                        </span>
                    </div>
                </div>

                <div class="field">
                    <label class="label has-text-white">Webscoket Address</label>
                    <div class="control has-icons-left has-icons-right">
                        <input class="input" type="email" placeholder="http://localhost:7011"
                            v-model="provisionData.wsServer">
                        <span class="icon is-small is-left">
                            <i class="fas fa-wifi"></i>
                        </span>
                    </div>
                </div>
                <button class="button is-success is-fullwidth" @click="clicked">Provision</button>
            </div>
        </Transition>
    </div>

</template>

<script lang="ts">
import { defineComponent, reactive, toRefs, ref } from 'vue';
import * as http from '@/tools/http';
import ShellyDevice from '@/ShellyDevice';
import { useToast } from '@/stores/toast';

export default defineComponent({
    props: {
        device: {
            type: Object as () => ShellyDevice,
            required: true
        }
    },
    setup(props) {
        const { device } = toRefs(props);
        const toast = useToast();

        const provisionData = reactive({
            wifi: {
                ssid: "",
                pass: ""
            },
            wsServer: `ws://${window.location.host}/shelly`
        })

        const clicked = async () => {
            try {
                toast.addToast(`Attempting to provision '${device.value.shellyID}'`, 'success');
                let res;
                try {
                    res = await http.provision(device.value.shellyID, provisionData.wsServer, provisionData.wifi);
                    if (!res.ok) {
                        toast.addToast(`Failed to provision '${device.value.shellyID}'`, 'danger')
                        return;
                    }
                    res = await res.json();
                    console.log(res);
                    toast.addToast(`Provisioned '${device.value.shellyID}'`, 'success')
                } catch (error) {
                    toast.addToast(`Failed to provision '${device.value.shellyID}'`, 'danger')
                }

            } catch (error) {
                console.error(error);
            }
        }

        const shown = ref(true);

        return { provisionData, clicked, shown }
    }
})

</script>