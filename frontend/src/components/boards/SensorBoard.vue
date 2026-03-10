<template>
  <BoardTabs @back="rightSideStore.clearActiveComponent()">
    <template #header>
      <span class="font-semibold">{{ sensorName }}</span>
    </template>
    <template #title>
      <div class="flex flex-col items-center gap-2">
        <img :src="sensorLogo" class="w-16 h-16 object-contain" alt="Sensor" loading="lazy" decoding="async" />
        <span class="text-lg font-bold">{{ sensorName }}</span>
        <span class="text-xs text-[var(--color-text-tertiary)]">{{ sensorId }}</span>
      </div>
    </template>

    <template #info>
      <div class="p-4 w-full h-full overflow-auto">
        <h3 class="text-lg font-semibold">Gateways:</h3>
        <div class="grid w-full gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 mt-2">
          <div
            v-for="dev in gateways"
            :key="dev.shellyID"
            class="relative group flex flex-col items-center max-w-full"
          >
            <DeviceWidget
              :device-id="dev.shellyID"
              vertical
              class="w-full h-32"
            />
            <button
              @click.stop="confirmUnlink(dev)"
              class="absolute top-1 right-1 text-[var(--color-danger-text)] hover:text-[var(--color-danger-text)] z-10"
            >
              <i class="fas fa-trash"></i>
            </button>
            <div
              class="mt-2 text-xs text-[var(--color-text-disabled)] opacity-0 group-hover:opacity-100 transition-opacity whitespace-normal break-words w-full text-center leading-tight"
            >
              {{ dev.shellyID }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #debug>
      <div class="overflow-auto p-2 flex flex-col gap-4">
        <Collapse
          v-for="gw in gatewayData"
          :key="gw.shellyID"
          :title="gw.deviceName || gw.shellyID"
        >
          <div class="flex flex-col gap-4">
            <div>
              <h4 class="text-sm font-semibold mb-2">BTHome Device Settings</h4>
              <JSONViewer :data="gw.bthomeDeviceSettings" />
            </div>
            <div>
              <h4 class="text-sm font-semibold mb-2">BTHome Sensor Settings</h4>
              <JSONViewer :data="gw.bthomeSensorSettings" />
            </div>
            <div>
              <h4 class="text-sm font-semibold mb-2">BTHome Sensor Status</h4>
              <JSONViewer :data="gw.bthomeSensorStatus" />
            </div>
          </div>
        </Collapse>
      </div>
    </template>

  </BoardTabs>

  <ConfirmationModal ref="confirmModal">
    <template #title>
      <h1>Unlink sensor from gateway?</h1>
    </template>
    <template #default>
      <p class="p-4">
        Remove sensor <strong>{{ sensorName }}</strong> from gateway
        <strong>{{ toRemove?.shellyID }}</strong>?
      </p>
    </template>
  </ConfirmationModal>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import BoardTabs from '@/components/boards/BoardTabs.vue';
import Collapse from '@/components/core/Collapse.vue';
import JSONViewer from '@/components/JSONViewer.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import DeviceWidget from '@/components/widgets/DeviceWidget.vue';
import {useDevicesStore} from '@/stores/devices';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useSensorsStore} from '@/stores/sensors';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    sensorId: string;
    sensorName: string;
}>();

const devicesStore = useDevicesStore();
const sensorsStore = useSensorsStore();
const rightSideStore = useRightSideMenuStore();
const confirmModal = ref<InstanceType<typeof ConfirmationModal> | null>(null);
const toRemove = ref<{shellyID: string} | null>(null);

const sensor = computed(() =>
    sensorsStore.sensors.find((s) => s.id === props.sensorId)
);

const sensorLogo = computed(() => sensorsStore.getLogo(sensor.value));

const gateways = computed(() =>
    Object.values(devicesStore.devices).filter((dev) =>
        Object.entries(dev.settings).some(
            ([key, cfg]) =>
                key.startsWith('bthomedevice:') &&
                (cfg as any).addr === props.sensorId
        )
    )
);

const gatewayData = computed(() => {
    return gateways.value.map((dev) => {
        const settings = dev.settings as Record<string, any>;
        const status = dev.status as Record<string, any>;

        const bthomeDeviceSettings: Record<string, any> = {};
        const bthomeSensorSettings: Record<string, any> = {};
        const bthomeSensorStatus: Record<string, any> = {};

        for (const [key, value] of Object.entries(settings)) {
            if (
                key.startsWith('bthomedevice:') &&
                (value as any).addr === props.sensorId
            ) {
                bthomeDeviceSettings[key] = value;
            }
            if (
                key.startsWith('bthomesensor:') &&
                (value as any).addr === props.sensorId
            ) {
                bthomeSensorSettings[key] = value;
                const sensorId = (value as any).id;
                const statusKey = `bthomesensor:${sensorId}`;
                if (status[statusKey]) {
                    bthomeSensorStatus[statusKey] = status[statusKey];
                }
            }
        }

        return {
            shellyID: dev.shellyID,
            deviceName: dev.info?.name || dev.shellyID,
            bthomeDeviceSettings,
            bthomeSensorSettings,
            bthomeSensorStatus
        };
    });
});

function confirmUnlink(dev: {shellyID: string; settings: Record<string, any>}) {
    toRemove.value = dev;
    confirmModal.value?.storeAction(async () => {
        const compKey = Object.keys(dev.settings).find(
            (key) =>
                key.startsWith('bthomedevice:') &&
                (dev.settings[key] as any).addr === props.sensorId
        );
        if (!compKey) {
            console.error(
                'Could not find component ID for sensor',
                props.sensorId
            );
            return;
        }
        const id = parseInt(compKey.split(':')[1], 10);
        try {
            await sendRPC('FLEET_MANAGER', 'device.RemoveBTHomeDevice', {
                shellyID: dev.shellyID,
                id
            });
        } catch (err) {
            console.error('Failed to unlink sensor', err);
        }
    });
}
</script>

