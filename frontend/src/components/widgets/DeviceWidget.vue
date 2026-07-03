<template>
    <Widget
        :selected
        :loading="device?.loading"
        :online="isOnline"
        :sleeping="isSleeping"
        :last-seen="lastSeenTs"
        :battery="batteryPercent"
        :accent-color="accentColor"
        v-if="showNormalWidget"
        :editMode="editMode"
    >
        <template #upper-corner>
            {{ getAppName(device?.info) }}
        </template>

        <template #image>
            <img
                v-lazyload
                :data-url="getLogo(device)"
                :alt="getDeviceName(device?.info, device_id)"
                @error="handleImgError"
            />
        </template>

        <template #name>
            {{ getDeviceName(device?.info, device_id) }}
        </template>

        <template #description>
            <div v-if="device?.loading" class="mx-auto w-7 h-7">
                <Spinner />
            </div>
        </template>

        <template #action>
            <template v-if="editMode">
                <Button type="red" size="sm" :narrow="true" title="Delete" aria-label="Delete" @click="emit('delete')">
                    <i class="fas fa-trash" aria-hidden="true"></i>
                </Button>
            </template>
        </template>
    </Widget>

    <Widget :loading="device?.loading" :selected :online="false" accent-color="#F04E5E" v-else>
        <template #upper-corner>
            Device
        </template>
        <template #name>
            {{ deviceId }}
        </template>
    </Widget>
</template>

<script lang="ts" setup>
import {computed, toRefs} from 'vue';
import Button from '@/components/core/Button.vue';
import {
    getAppName,
    getDeviceCategoryAccent,
    getDeviceName,
    getLevelIndicator,
    getLogo,
    handleDeviceImgError
} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';
import Spinner from '../core/Spinner.vue';
import Widget from './WidgetsTemplates/DeviceWidget.vue';

type props_t = {
    deviceId: string;
    editMode?: boolean;
    selected?: boolean;
};

const props = withDefaults(defineProps<props_t>(), {
    editMode: false,
    selected: false
});

const emit = defineEmits<{
    delete: [];
}>();

const {deviceId: device_id, editMode} = toRefs(props);

const deviceStore = useDevicesStore();

const device = computed(() => deviceStore.devices[device_id.value]);
const showNormalWidget = computed(() => !!device.value);
const isOnline = computed(
    () => !!device.value?.online && !device.value?.loading
);
const isSleeping = computed(() => !!device.value?.sleeping);

const OFFLINE_ACCENT = '#F04E5E';
const SLEEPING_ACCENT = '#8B5CF6';

const accentColor = computed(() => {
    if (isSleeping.value) return SLEEPING_ACCENT;
    if (!isOnline.value) return OFFLINE_ACCENT;
    return getDeviceCategoryAccent(device.value?.status);
});

const lastSeenTs = computed(() => {
    const s = device.value?.status;
    return s?.ts ?? s?.sys?.unixtime ?? 0;
});

const batteryPercent = computed(() => {
    const level = getLevelIndicator(device.value);
    return level.type === 'battery' ? level.value : null;
});

function handleImgError(e: Event) {
    handleDeviceImgError(e, device.value?.info?.model);
}
</script>
