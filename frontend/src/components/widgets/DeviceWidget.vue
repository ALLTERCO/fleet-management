<template>
    <Widget
        :selected
        :loading="device?.loading"
        :online="isOnline"
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
                <Button type="red" size="sm" :narrow="true" @click="emit('delete')">
                    <i class="fas fa-trash-alt"></i>
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
    getDeviceName,
    getLogo
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
const isOnline = computed(() => !!device.value?.online && !device.value?.loading);

const ONLINE_ACCENT = '#22D3A0';
const OFFLINE_ACCENT = '#F04E5E';

const accentColor = computed(() => {
    return isOnline.value ? ONLINE_ACCENT : OFFLINE_ACCENT;
});

function handleImgError(e: any) {
    e.target.src = getLogo();
}
</script>
