<template>
    <div>
        <EmptyBlock v-if="!system.config.mdns.enable" class="space-y-2">
            <p class="text-xl font-semibold pb-2">mDNS is disabled in settings</p>
            <p class="text-sm pb-2">Try enabling this feature to discover devices in your local network.</p>
            <Button type="blue" @click="goToSettings">Go to Settings</Button>
        </EmptyBlock>
        <div v-else class="space-y-2">
            <BasicBlock title="All mDNS devices" bordered blurred padding="sm" class="relative">
                <Input v-model="nameFilter" class="max-w-sm mt-2" label="Device name" />
            </BasicBlock>

            <EmptyBlock v-if="Object.keys(deviceStore.devices).length == 0">
                <p class="text-xl font-semibold pb-2">No devices found</p>
                <p class="text-sm pb-2">Connect shelly devices via their outbound websocket.</p>
            </EmptyBlock>
            <template v-else>
                <EmptyBlock v-if="Object.keys(devices).length == 0">
                    <p class="text-xl font-semibold pb-2">No devices found</p>
                    <p class="text-sm pb-2">Try changing you search parameters.</p>
                    <Button type="blue" @click="nameFilter = ''">Reset search</Button>
                </EmptyBlock>
                <div :class="[small ? 'flex flex-col gap-2' : 'widget-grid']">
                    <DeviceWidget
                        v-for="device in devices"
                        :key="device.shellyID"
                        :device-id="device.shellyID"
                        :selected="activeDevice === device.shellyID"
                        :vertical="small"
                        class="hover:cursor-pointer"
                        @click.stop="clicked(device)"
                    />
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useRouter} from 'vue-router/auto';
import BasicBlock from '@/components/core/BasicBlock.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Input from '@/components/core/Input.vue';
import {useDevicesStore} from '@/stores/devices';
import type {shelly_device_t} from '@/types';

const router = useRouter();

import Button from '@/components/core/Button.vue';
import DeviceWidget from '@/components/widgets/DeviceWidget.vue';
import {DeviceBoard} from '@/helpers/components';
import {isDiscovered} from '@/helpers/device';
import {small} from '@/helpers/ui';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useSystemStore} from '@/stores/system';

const deviceStore = useDevicesStore();
const system = useSystemStore();
const rightSideStore = useRightSideMenuStore();

const devices = computed(() =>
    Object.values(deviceStore.devices).filter((d) => filterDevice(d))
);
const nameFilter = ref('');
const activeDevice = ref<string>();

function filterDevice(device: shelly_device_t) {
    if (!isDiscovered(device.shellyID)) {
        return false;
    }

    if (nameFilter.value.length > 1) {
        if (
            !device.info.name
                .toLowerCase()
                .includes(nameFilter.value.toLowerCase())
        ) {
            return false;
        }
    }

    return true;
}

function clicked(device: shelly_device_t) {
    rightSideStore.setActiveComponent(DeviceBoard, {
        shellyID: device.shellyID
    });
    activeDevice.value = device.shellyID;
}

function goToSettings() {
    router.push('/settings/app');
}
</script>
