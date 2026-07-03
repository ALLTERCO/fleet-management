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
        <template v-if="channelLabel || statusLabel" #status>
            <span v-if="channelLabel" class="bthome-channel-pill">
                <i class="fas fa-tower-broadcast" /> {{ channelLabel }}
            </span>
            <span
                v-if="statusLabel"
                class="bthome-state"
                :class="`bthome-state--${statusTone}`"
            >
                {{ statusLabel }}
            </span>
        </template>
        <template v-if="device.summary && !statusLabel && !channelLabel" #footer>
            <span class="bthome-summary">{{ device.summary }}</span>
        </template>
    </DCCard>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import DCCard from '@/components/core/DCCard.vue';
import {handleDeviceImgError} from '@/helpers/device';
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

const logo = computed(() => getLogo(props.device));
const displayLabel = computed(
    () => KIND_LABELS[props.device.kind] ?? 'Sensor'
);
const accentClass = computed(
    () => KIND_ACCENTS[props.device.kind] ?? 'dc-accent-blue'
);
// Remote controllers surface their active channel as a top pill (the backend
// otherwise leaks it into the summary footer at the bottom of the card).
const channelLabel = computed(() =>
    props.device.kind === 'remote_controller' && props.device.activeChannelLabel
        ? props.device.activeChannelLabel
        : ''
);
const statusLabel = computed(() => {
    if (isOffline.value) return 'Offline';
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
        case 'remote_controller':
            return props.device.lastEvent ?? '';
        default:
            return props.device.summary || batteryLabel.value;
    }
});
const batteryLabel = computed(() =>
    props.device.battery == null ? '' : `${props.device.battery}%`
);
const statusTone = computed(() => {
    if (isOffline.value) return 'offline';
    if (
        props.device.kind === 'door_window' ||
        props.device.kind === 'motion_sensor'
    ) {
        return props.device.state ?? 'neutral';
    }
    return 'event';
});

// undefined → treat as online; matches the gateway-card convention.
const isOffline = computed(() => props.device.online === false);

function handleImgError(e: Event) {
    handleDeviceImgError(e, props.device.modelId);
}
</script>

<style scoped>
.bthome-state,
.bthome-summary,
.bthome-channel-pill {
    overflow: hidden;
    max-width: 100%;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Active-channel pill — same rounded token pill as the fleet-card battery pill. */
.bthome-channel-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-2xl);
    background: color-mix(in srgb, var(--color-primary) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
    color: var(--color-primary);
    font-size: var(--type-caption);
    font-weight: 700;
    letter-spacing: 0.04em;
}

.bthome-channel-pill i {
    font-size: var(--type-caption);
}

.bthome-state {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    margin-left: auto;
    padding: 0 var(--space-2);
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: 700;
}

.bthome-state--open,
.bthome-state--event {
    background: color-mix(in srgb, var(--color-warning) 14%, transparent);
    color: var(--color-warning-text);
}

.bthome-state--closed {
    background: color-mix(in srgb, var(--color-success) 14%, transparent);
    color: var(--color-success-text);
}

.bthome-state--offline {
    background: rgba(232, 64, 87, 0.12);
    color: var(--color-status-off);
}

.bthome-summary {
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: 600;
}
</style>
