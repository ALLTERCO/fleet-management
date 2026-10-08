<template>
    <WizardStep name="pair" :lede="lede">
        <WizardState v-if="!gatewayId" tone="empty">
            Pick a gateway in the previous step first.
        </WizardState>

        <BluDiscoverPanel
            v-else
            :shelly-i-d="gatewayId"
            embedded
            @paired="(mac, meta) => emit('paired', mac, meta)"
        />
    </WizardStep>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import BluDiscoverPanel from '@/components/core/BluDiscoverPanel.vue';
import WizardState from '@/components/core/wizard/WizardState.vue';
import WizardStep from '@/components/core/wizard/WizardStep.vue';
import {useDevicesStore} from '@/stores/devices';

const props = defineProps<{gatewayId: string | null}>();
const emit = defineEmits<{
    paired: [mac: string, meta?: {alreadyPaired: boolean}];
}>();

const deviceStore = useDevicesStore();

// Pairing writes into the gateway's own firmware config, not into Fleet
// Manager, and nothing outside that gateway can undo it. Say so before it
// happens rather than after.
const lede = computed(() => {
    if (!props.gatewayId) return undefined;
    const name =
        deviceStore.devices[props.gatewayId]?.info?.name ?? props.gatewayId;
    return `Sensors you pair here are stored on ${name} itself. You can unpair them on the next step.`;
});
</script>
