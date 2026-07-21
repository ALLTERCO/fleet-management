<template>
    <DCCard
        :label="displayLabel"
        :image="logo"
        :name="device.name"
        :accent-class="accentClass"
        :selected="selected"
        :offline="isOffline"
        @click="emit('click', $event)"
        @img-error="handleImgError"
    >
        <template #status>
            <DeviceCardStatus :device="statusDevice" />
        </template>
        <template v-if="stateLabel" #state>
            <span
                class="bthome-state"
                :class="[
                    `bthome-state--${stateTone}`,
                    {'bthome-state--stale': isOffline}
                ]"
            >
                {{ stateLabel }}
            </span>
        </template>
        <template
            v-if="showSummaryFooter"
            #footer
        >
            <span class="bthome-summary">{{ device.summary }}</span>
        </template>
    </DCCard>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import DCCard from '@/components/core/DCCard.vue';
import DeviceCardStatus from '@/components/devices/DeviceCardStatus.vue';
import {handleDeviceImgError} from '@/helpers/device';
import {resolveDeviceStatePill} from '@/helpers/deviceState';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {type SensorDevice, useSensorsStore} from '@/stores/sensors';

const KIND_LABELS: Record<string, string> = {
    door_window: 'Door / Window',
    button: 'Button',
    remote_controller: 'Remote Controller',
    motion_sensor: 'Motion Sensor',
    climate_sensor: 'Climate Sensor',
    distance_sensor: 'Distance Sensor',
    trv: 'TRV',
    weather_station: 'Weather Station',
    sensor: 'Sensor',
};

const KIND_ACCENTS: Record<string, string> = {
    door_window: 'dc-accent-green',
    motion_sensor: 'dc-accent-orange',
    climate_sensor: 'dc-accent-pink',
    weather_station: 'dc-accent-pink',
    button: 'dc-accent-purple',
    remote_controller: 'dc-accent-purple',
    distance_sensor: 'dc-accent-teal',
    trv: 'dc-accent-red',
};

const props = defineProps<{
    device: SensorDevice;
    selected?: boolean;
}>();

const emit = defineEmits<{
    click: [event: Event];
}>();

const {getLogo} = useSensorsStore();
const deviceStore = useDevicesStore();
const entityStore = useEntityStore();

// Fallback when the runtime overview summary is absent: the promoted device's
// durable displayValue via the shared resolver. Neutral pill = a reading.
const durableReading = computed(() => {
    const shellyID = props.device.shellyID;
    if (!shellyID) return '';
    const full = deviceStore.devices[shellyID];
    if (!full) return '';
    const pill = resolveDeviceStatePill(full, (id) => entityStore.entities[id]);
    return pill?.tone === 'neutral' ? pill.label : '';
});

const logo = computed(() => getLogo(props.device));
const displayLabel = computed(
    () => KIND_LABELS[props.device.kind] ?? 'Sensor'
);
const accentClass = computed(
    () => KIND_ACCENTS[props.device.kind] ?? 'dc-accent-blue'
);
// The active channel is the remote's only data value.
const channelLabel = computed(() =>
    props.device.kind === 'remote_controller' && props.device.activeChannelLabel
        ? props.device.activeChannelLabel
        : ''
);
const stateLabel = computed(() => {
    switch (props.device.kind) {
        case 'door_window':
            return props.device.state === 'open'
                ? 'Open'
                : props.device.state === 'closed'
                  ? 'Closed'
                  : '';
        case 'motion_sensor':
            return props.device.state === 'open'
                ? 'Motion'
                : props.device.state === 'closed'
                  ? 'Clear'
                  : '';
        case 'button':
            return 'No events';
        case 'remote_controller':
            return channelLabel.value;
        case 'weather_station':
            return (
                props.device.primaryDisplayValue ||
                durableReading.value ||
                props.device.summary ||
                ''
            );
        default:
            return (
                props.device.summary || durableReading.value
            );
    }
});
const showSummaryFooter = computed(
    () =>
        Boolean(props.device.summary) &&
        !stateLabel.value &&
        !isOffline.value &&
        !channelLabel.value &&
        props.device.kind !== 'remote_controller'
);
const statusDevice = computed(() => ({
    online: props.device.online,
    source: 'bluetooth',
    status: {
        bluetoothdevice: {
            battery: props.device.battery
        }
    }
}));
const stateTone = computed(() => {
    if (
        props.device.kind === 'door_window' ||
        props.device.kind === 'motion_sensor'
    ) {
        return props.device.state ?? 'neutral';
    }
    return 'neutral';
});

// undefined → treat as online; matches the gateway-card convention.
const isOffline = computed(() => props.device.online === false);

function handleImgError(e: Event) {
    handleDeviceImgError(
        e,
        props.device.imageModel ?? props.device.modelId
    );
}
</script>

<style scoped>
/* .bthome-state now lives in styles/components.css — shared with fleet cards. */
.bthome-summary {
    overflow: hidden;
    max-width: 100%;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.bthome-summary {
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: 600;
}
</style>
