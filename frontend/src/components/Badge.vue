<template>
    <div :tabindex="tabindex ?? 0" class="badge has-background-shelly is-unselectable is-clickable" @click="clicked()" v-if="(device && device.info)">
        <div class="badge-icons py-1">
            <span class="icon is-small" :style="{ color: icons.wifi ? 'white' : 'grey' }">
                <i class="fas is-small fa-wifi"></i>
            </span>
            <span class="icon is-small" :style="{ color: icons.bluetooth ? 'white' : 'grey' }">
                <span class="fa-brands fa-bluetooth"></span>
            </span>
            <span class="icon is-small" :style="{ color: icons.local ? 'white' : 'grey' }">
                <i class="fas fa-network-wired"></i>
            </span>
        </div>
        <div class="media"
            style="border-right: 1px solid black; border-left: 1px solid black; min-width: 80px; width: 80px;">
            <figure class="image">
                <img :src="getLogo()" alt="Shelly" style="width: 80px !important">
            </figure>
        </div>
        <div class="media-content badge-content pl-2 mt-1">
            <p class="has-text-white" style="font-weight: 600; white-space: nowrap;">{{ getName() }}</p>
            <p class="has-text-white">{{ device?.info['app'] + " (" +
                device?.info['model'] + ")"
            }}</p>
            <div class="tags" v-if="!stripped">
                <span class="tag" v-for="tag of tags" :key="tag">
                    {{ tag }}
                </span>
            </div>
        </div>
        <div class="m-auto" v-if="!stripped && device.source === 'ws'">
            <button class="button is-small is-link" :class="{ 'is-loading': waitingForResponse }"
                @click.stop="toggleClicked">
                {{ field.output ? 'turn off' : 'turn on' }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, reactive, onMounted } from 'vue';
import { useRouter } from "vue-router";
import { useDevicesStore } from '@/stores/devices';
import { storeToRefs } from 'pinia';

const props = withDefaults(
    defineProps<{ device_mac: string, tabindex?: number, channel?: number, link?: boolean, stripped?: boolean }>(), {
        stripped: false,
        link: true,
        channel: 0
    }
);

const devicesStore = useDevicesStore();
const { devices } = storeToRefs(devicesStore);
const router = useRouter();
const clicked = () => {
    if (props.link) {
        router.push("/device/" + props.device_mac);
    }
}
const waitingForResponse = ref(false);
let waitingForResponseTimeout: ReturnType<typeof setTimeout>;

const icons = reactive({
    wifi: false,
    bluetooth: false,
    local: false
})

function getLogo() {
    const deviceInfo = device.value?.info;
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

function getName() {
    const deviceInfo = device.value?.info;
    if (deviceInfo == undefined) {
        return "unknown";
    }
    if (deviceInfo['name'] == undefined || deviceInfo['name'] == 'null') {
        return props.device_mac;
    }
    return `${deviceInfo['name']} (${props.device_mac})`;
}

const device = computed(() => {
    return devices.value[props.device_mac];
});

const field = computed(() => {
    const status = device.value?.status;
    if (status == undefined) return {};
    const field = status['switch:' + props.channel];
    if (field == undefined) return {};
    return field;
});

const tags = computed(() => {
    const tags = [] as string[];
    for (const [k, v] of Object.entries(field.value)) {
        if (v == '0') continue;
        switch (k) {
            case 'apower':
                tags.push(v + ' W');
                break;

            case 'voltage':
                tags.push(v + ' V');
                break;

            case 'total':
                tags.push(v + ' Wh');
                break;

            case 'current':
                tags.push(v + ' A');
                break;
        }
    }
    for (const [key, value] of Object.entries(device.value?.status)) {
        if (key.startsWith('temperature') && typeof (<any>value).tC !== 'undefined') {
            tags.push((<any>value).tC + ' °C');
        } else if (key.startsWith('humidity') && typeof (<any>value).rh !== 'undefined') {
            tags.push('RH ' + (<any>value).rh + '%');

        }
    }
    return tags;
})

function toggleClicked() {
    devicesStore.sendRPC(props.device_mac, 'Switch.Toggle', { id: String(props.channel) });
    waitingForResponse.value = true;
    waitingForResponseTimeout = setTimeout(() => {
        waitingForResponse.value = false;
    }, 10000); // timeout after 10 seconds
}

watch(field, (old, field) => {
    if (old.output != field.output) {
        waitingForResponse.value = false;
        if(waitingForResponseTimeout){
            clearInterval(waitingForResponseTimeout)
        }
    }
})

onMounted(() => {
    const dev = device.value;
    if (dev == undefined) return;
    icons.wifi = (dev.source === 'ws');
    icons.bluetooth = (dev.source === 'ble');
    icons.local = (dev.source === 'local');
});
</script>

<style>
.badge {
    display: flex;
    flex-flow: row nowrap;
    align-items: flex-start;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.25);
    max-width: 546px;
}

.badge-content {
    overflow: hidden;
    text-align: left;
    min-height: 70px;
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

.tags { 
    display: flex;
    flex-flow: nowrap;
    overflow-x: scroll;
    gap: 0.125rem;
}

.tag {
    color: white !important;
    background-color: black !important;
}
</style>