<template>
    <DCCard
        :label="resolvedLabel"
        :logo="deviceLogo"
        :name="deviceName"
        :accent-class="resolvedAccent"
        :selected="selected"
        :offline="!isOnline"
        :accent-color="accentColor"
        @click="onClick"
        @img-error="onImgError"
    >
        <template #status>
            <DeviceCardStatus :device="device" />
        </template>
        <template v-if="statePill" #state>
            <span :class="statePillClass">{{ statePill.label }}</span>
        </template>
        <template v-if="$slots.footer" #footer>
            <slot name="footer" />
        </template>
    </DCCard>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import DCCard from '@/components/core/DCCard.vue';
import DeviceCardStatus from '@/components/devices/DeviceCardStatus.vue';
import {
    getAppName,
    getDeviceName,
    handleDeviceImgError
} from '@/helpers/device';
import {resolveDeviceLiveness} from '@/helpers/deviceLiveness';
import {resolveDeviceCardLogo} from '@/helpers/deviceLogo';
import {resolveDeviceStatePill} from '@/helpers/deviceState';
import {useEntityStore} from '@/stores/entities';

const props = defineProps<{
    device: {
        shellyID: string;
        online?: boolean;
        sleeping?: boolean;
        loading?: boolean;
        info?: Record<string, any>;
        status?: Record<string, any>;
        meta?: Record<string, any>;
        source?: string;
        entities?: string[];
    };
    selected?: boolean;
    accentColor?: string;
    label?: string;
}>();

const emit = defineEmits<{
    click: [event: Event];
    select: [];
}>();

function onClick(e: Event) {
    emit('click', e);
    emit('select');
}

// One resolver owns online/sleeping/stale/heartbeat for the whole card.
const liveness = computed(() => resolveDeviceLiveness(props.device));
const isOnline = computed(() => liveness.value.online);
const isSleeping = computed(() => liveness.value.sleeping);

const deviceName = computed(() =>
    getDeviceName(props.device.info, props.device.shellyID)
);

const resolvedLabel = computed(
    () => props.label ?? getAppName(props.device.info)
);

const deviceLogo = computed(() => resolveDeviceCardLogo(props.device as never));

const resolvedAccent = computed(() => {
    if (props.accentColor) return '';
    return autoAccentClass.value;
});

// Extract component type prefixes once (status keys rarely change — only on connect)
const componentTypes = computed(() => {
    const status = props.device.status;
    if (!status || typeof status !== 'object') return new Set<string>();
    const types = new Set<string>();
    for (const key of Object.keys(status)) {
        const i = key.indexOf(':');
        if (i > 0) types.add(key.substring(0, i));
    }
    return types;
});

const autoAccentClass = computed(() => {
    if (!isOnline.value) return 'dc-accent-off';
    if (isSleeping.value) return 'dc-accent-sleep';

    const types = componentTypes.value;
    if (types.size === 0) return 'dc-accent-blue';

    if (types.has('em') || types.has('em1') || types.has('pm1'))
        return 'dc-accent-amber';
    if (
        types.has('light') ||
        types.has('rgbw') ||
        types.has('rgb') ||
        types.has('cct') ||
        types.has('rgbcct')
    )
        return 'dc-accent-purple';
    if (types.has('cover')) return 'dc-accent-teal';
    if (types.has('thermostat')) return 'dc-accent-red';
    if (types.has('motion')) return 'dc-accent-orange';
    if (types.has('door') || types.has('flood')) return 'dc-accent-green';
    if (types.has('switch')) return 'dc-accent-blue';
    if (types.has('input')) return 'dc-accent-orange';
    if (types.has('temperature') || types.has('humidity'))
        return 'dc-accent-pink';

    return 'dc-accent-blue';
});

// Live device state — resolver is the single home; null for out-of-scope types.
const entityStore = useEntityStore();
const statePill = computed(() =>
    resolveDeviceStatePill(props.device, (id) => entityStore.entities[id])
);

// Reuses the pre-existing .bthome-state sensor-card visual (components.css).
const statePillClass = computed(() => [
    'bthome-state',
    `bthome-state--${statePill.value?.tone}`,
    {'bthome-state--stale': statePill.value?.stale === true}
]);

function onImgError(e: Event) {
    handleDeviceImgError(e, props.device.info?.model);
}
</script>
