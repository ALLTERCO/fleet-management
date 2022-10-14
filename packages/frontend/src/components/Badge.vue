<template>
    <div class="badge has-background-shelly my-4 is-unselectable is-clickable" @click="clicked($event)">
        <div class="badge-icons py-1">
            <span class="icon is-small" :style="{color: icons.wifi ? 'white' : 'grey'}">
                <i class="fas is-small fa-wifi"></i>
            </span>
            <span class="icon is-small" :style="{color: icons.bluetooth ? 'white' : 'grey'}">
                <i class="fas fa-broadcast-tower"></i>
            </span>
            <span class="icon is-small" :style="{color: icons.sync ? 'white' : 'grey'}">
                <i class="fas fa-sync"></i>
            </span>
        </div>
        <div class="media" style="border-right: 1px solid black; border-left: 1px solid black">
            <figure class="image">
                <img :src="getLogo()" alt="Shelly" style="width: 80px !important">
            </figure>
        </div>
        <div class="media-content" style="text-align: left; margin: auto; padding-left: 0.5rem;">
            <p class="has-text-white" style="font-weight: 600;">{{ getName() }}</p>
            <p class="has-text-white">{{ device?.deviceInfo['app'] + " (" +
            device?.deviceInfo['model'] + ")" }}</p>
            <div class="tags">
                <span class="tag" v-for="tag of tags">
                    {{tag}}
                </span>
            </div>
        </div>
        <button class="button toggleButton" 
            v-if="device.channels > 0"
            @click.capture="toggleClicked"
            :style="{ 'box-shadow': field?.output ? '0px 0px 1rem blue' : 'unset', 'color': field?.output ? 'blue' : 'black'}">
            <span class="icon">
                <i class="fas fa-power-off"></i>
            </span>
        </button>
    </div>
</template>

<script lang="ts">
import { defineComponent, toRef, computed, reactive, onMounted } from 'vue';
import { useRouter } from "vue-router";
import { useDevicesStore } from '@/stores/devices';
import { storeToRefs } from 'pinia';

export default defineComponent({
    props: {
        device_mac: {
            type: String,
            required: true
        },
        channel: {
            type: Number,
            required: false,
            default: 0
        },
        link: {
            type: Boolean,
            default: false
        },
    },
    setup(props) {
        const { device_mac, channel } = props;
        const link = toRef(props, 'link');
        const devicesStore = useDevicesStore();
        const { devices } = storeToRefs(devicesStore);
        const router = useRouter();
        const clicked = (event: any) => {
            const arr = Array.from(event.target.classList); 
            if(arr.includes('toggleButton') || arr.includes('fa-power-off') || arr.includes('icon')) return;
            if (link) {
                router.push("/device/" + device_mac);
            }
        }

        const icons = reactive({
            wifi: false,
            bluetooth: false,
            sync: false
        })

        const getLogo = () => {
            const deviceInfo = device.value?.deviceInfo;
            if (deviceInfo == undefined || deviceInfo.model == undefined) {
                return "/shelly_logo_black.jpg";
            }
            let model = deviceInfo.model as string;
            if (model.charAt(2) == 'S' && model.charAt(3) == 'W' && model.charAt(5) != '0') {
                let temp = model.split("")
                temp[5] = '0';
                model = temp.join('')
            }
            return `https://home.shelly.cloud/images/device_images/${model}.png`

        }

        const getName = () => {
            const deviceInfo = device.value?.deviceInfo;
            if (deviceInfo == undefined) {
                return "unknown";
            }
            if (deviceInfo['name'] == undefined || deviceInfo['name'] == 'null') {
                return device_mac;
            }
            return `${deviceInfo['name']} (${device_mac})`;
        }

        const device = computed(() => {
            return devices.value[device_mac];
        });

        const field = computed(() => {
            const fields = device.value?.fields;
            if(fields == undefined) return {};
            const field = fields['switch:' + channel];
            if(field == undefined) return {};
            return field;
        });

        const tags = computed(() => {
            const tags = [] as string[];
            for (const [k, v] of Object.entries(field.value)) {
                if(v == 0) continue;
                switch (k) {
                    case 'apower':
                        tags.push(v + ' W')
                        break;

                    case 'voltage':
                        tags.push(v + ' V')
                        break;

                    case 'total':
                        tags.push(v + ' Wh')
                        break;

                    case 'current':
                        tags.push(v + ' A')
                        break;
                }
            }
            return tags;
        })

        const toggleClicked = () => {
            devicesStore.sendRPC(device_mac, 'Switch.Toggle', { id: String(channel) })
        }

        onMounted(() => {
            const dev = device.value;
            if (dev == undefined) return;
            icons.wifi = (dev.source === 'ws');
            icons.bluetooth = (dev.source === 'ble');
            icons.sync = true;
        });

        return { device_mac, clicked, device, getName, getLogo, icons, field, toggleClicked, tags };
    }
});
</script>

<style>
.toggleButton {
    margin: auto;
    margin-right: 1rem;
    border-radius: 50%;
}

.badge {
    display: flex;
    flex-flow: row nowrap;
    align-items: baseline;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.25);
}

.badge-icons {
    align-self: flex-start;
    color: white;
    min-width: 32px;
    height: 80px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    gap: 5px;
    align-items: center;
}

svg {
    width: 1rem !important;
}

.fa-sync>svg {
    width: 0.75rem !important;
}

.tag {
    color: white !important;
    background-color: black !important;
}
</style>