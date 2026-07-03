<template>
  <BTHomeDevicePanel
    :shelly-id="props.shellyID"
    :status="status"
    :settings="config"
    :display-name="props.displayName"
    :addr="props.addr"
    show-header
    show-gateway-button
    @open-gateway="openGateway"
  />
</template>

<script setup lang="ts">
import {computed, watch} from 'vue';
import {DeviceBoard} from '@/helpers/components';
import {useDevicesStore} from '@/stores/devices';
import {useRightSideMenuStore} from '@/stores/right-side';
import {sendRPC} from '@/tools/websocket';
import BTHomeDevicePanel from './BTHomeDevicePanel.vue';

const props = defineProps<{
    shellyID: string;
    bthomeDeviceId: number;
    addr: string;
    displayName?: string;
}>();

const deviceStore = useDevicesStore();
const rightSideStore = useRightSideMenuStore();

const componentKey = computed(() => `bthomedevice:${props.bthomeDeviceId}`);
const device = computed(() => deviceStore.devices[props.shellyID]);
const config = computed(
    () =>
        device.value?.settings?.[componentKey.value] as Record<
            string,
            any
        > | null
);
const status = computed(
    () =>
        device.value?.status?.[componentKey.value] as Record<string, any> | null
);

let fetchToken = 0;
watch(
    () => [props.shellyID, props.bthomeDeviceId] as const,
    async () => {
        const token = ++fetchToken;
        try {
            const fullDevice = await sendRPC('FLEET_MANAGER', 'device.Get', {
                shellyID: props.shellyID
            });
            if (token !== fetchToken) return;
            if (fullDevice) {
                deviceStore.handleNewDevice(fullDevice);
            }
        } catch {
            // Non-fatal — the slim device list is enough for the inspector shell.
        }
    },
    {immediate: true}
);

function openGateway() {
    rightSideStore.showInspector(DeviceBoard, {shellyID: props.shellyID});
}
</script>
