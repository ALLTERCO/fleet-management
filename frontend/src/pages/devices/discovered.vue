<template>
    <PageTemplate
        fill
        v-model:search="nameFilter"
        title="Discovered Devices"
        :searchable="mdnsEnabled"
        search-placeholder="Search by device name…"
        :empty="isEmpty"
        :empty-title="emptyTitle"
        :empty-sub="emptySub"
    >
        <template v-if="!mdnsEnabled" #empty-cta>
            <Button type="blue" @click="goToSettings">Go to Settings</Button>
        </template>
        <template v-else-if="hasNameFilterButNoMatches" #empty-cta>
            <Button type="blue" @click="nameFilter = ''">Reset search</Button>
        </template>

        <div class="dd-grid">
            <DeviceWidget
                v-for="device in devices"
                :key="device.shellyID"
                :device-id="device.shellyID"
                :selected="activeDevice === device.shellyID"
                :vertical="false"
                class="dd-tile"
                @click.stop="clicked(device)"
            />
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useRouter} from 'vue-router';
import Button from '@/components/core/Button.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import DeviceWidget from '@/components/widgets/DeviceWidget.vue';
import {SETTINGS_PATH} from '@/constants';
import {DeviceBoard} from '@/helpers/components';
import {isDiscovered} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useSystemStore} from '@/stores/system';
import type {shelly_device_t} from '@/types';

const router = useRouter();
const deviceStore = useDevicesStore();
const system = useSystemStore();
const rightSideStore = useRightSideMenuStore();

const nameFilter = ref('');
const activeDevice = ref<string>();

const mdnsEnabled = computed(() => system.config.mdns.enable);

const devices = computed(() =>
    Object.values(deviceStore.devices).filter((d) => filterDevice(d))
);

const hasAnyDiscoveredDevice = computed(() =>
    Object.values(deviceStore.devices).some((d) => isDiscovered(d.shellyID))
);

const hasNameFilterButNoMatches = computed(
    () =>
        nameFilter.value.length > 1 &&
        hasAnyDiscoveredDevice.value &&
        devices.value.length === 0
);

const isEmpty = computed(
    () =>
        !mdnsEnabled.value ||
        !hasAnyDiscoveredDevice.value ||
        hasNameFilterButNoMatches.value
);

const emptyTitle = computed(() => {
    if (!mdnsEnabled.value) return 'mDNS is disabled in settings';
    if (!hasAnyDiscoveredDevice.value) return 'No devices found';
    return 'No devices match';
});

const emptySub = computed(() => {
    if (!mdnsEnabled.value) {
        return 'Enable mDNS to discover devices on your local network.';
    }
    if (!hasAnyDiscoveredDevice.value) {
        return 'Connect Shelly devices via their outbound websocket.';
    }
    return 'Try changing your search parameters.';
});

function filterDevice(device: shelly_device_t) {
    if (!isDiscovered(device.shellyID)) return false;
    if (nameFilter.value.length > 1) {
        // A freshly-discovered device commonly has no name yet; guard the
        // string access so a search doesn't crash the list render.
        const name = device.info?.name;
        return (
            typeof name === 'string' &&
            name.toLowerCase().includes(nameFilter.value.toLowerCase())
        );
    }
    return true;
}

function clicked(device: shelly_device_t) {
    rightSideStore.showInspector(DeviceBoard, {
        shellyID: device.shellyID
    });
    activeDevice.value = device.shellyID;
}

function goToSettings() {
    router.push(SETTINGS_PATH);
}
</script>

<style scoped>
.dd-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--gap-sm);
}

.dd-tile {
    cursor: pointer;
}
</style>
