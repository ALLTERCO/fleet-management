<template>
    <div class="ec-status">
        <!-- Sleeping — purple pulsing moon -->
        <span v-if="isSleeping" class="ep ep-sleep" :title="lastSeenText">
            <i class="fas fa-moon ep-sleep-moon" />
        </span>

        <!-- Offline pill -->
        <span v-else-if="isOffline" class="ep ep-off">
            <span class="ep-dot" />
            OFF
        </span>

        <!-- Battery pill (hidden when sleeping — moon takes its place; and on
             battery cards, whose whole face already shows the level) -->
        <span
            v-if="resolvedBattery != null && !isSleeping && !hideBattery"
            class="ec-batt"
            :class="batteryClass"
        >
            <i :class="batteryIcon" class="ec-batt-icon" />
            {{ resolvedBattery }}%
        </span>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useDevicesStore} from '@/stores/devices';

const props = defineProps<{
    battery?: number | null;
    isOffline: boolean;
    shellyId?: string;
    hideBattery?: boolean;
}>();

const deviceStore = useDevicesStore();

const device = computed(() =>
    props.shellyId ? deviceStore.devices[props.shellyId] : null
);

const isSleeping = computed(() => !!device.value?.sleeping);

const lastSeenText = computed(() => {
    const s = device.value?.status;
    const ts = s?.ts ?? s?.sys?.unixtime ?? 0;
    if (!ts) return 'Sleeping';
    const diffS = Math.floor(Date.now() / 1000 - ts);
    if (diffS < 60) return 'Last seen just now';
    if (diffS < 3600) return `Last seen ${Math.floor(diffS / 60)}m ago`;
    if (diffS < 86400) return `Last seen ${Math.floor(diffS / 3600)}h ago`;
    return `Last seen ${Math.floor(diffS / 86400)}d ago`;
});

// Auto-detect battery from device store if not explicitly passed
const resolvedBattery = computed(() => {
    if (props.battery != null) return props.battery;
    if (!device.value?.status) return null;
    const s = device.value.status;
    return (
        s?.['devicepower:0']?.battery?.percent ??
        s?.devicepower?.battery?.percent ??
        null
    );
});

const batteryClass = computed(() => {
    if (resolvedBattery.value == null) return '';
    if (resolvedBattery.value < 20) return 'batt-crit';
    if (resolvedBattery.value < 60) return 'batt-warn';
    return '';
});

const batteryIcon = computed(() => {
    const b = resolvedBattery.value ?? 100;
    if (b <= 10) return 'fas fa-battery-empty';
    if (b <= 25) return 'fas fa-battery-quarter';
    if (b <= 50) return 'fas fa-battery-half';
    if (b <= 75) return 'fas fa-battery-three-quarters';
    return 'fas fa-battery-full';
});
</script>

<style scoped>
.ec-batt-icon {
    font-size: var(--type-body);
}
.batt-crit {
    color: var(--color-status-off);
    animation: pulse-batt 2s ease-in-out infinite;
}
.batt-crit :deep(i) {
    color: var(--color-status-off);
}
.ep-sleep {
    display: inline-flex;
    align-items: center;
}
.ep-sleep-moon {
    font-size: var(--type-body);
    color: color-mix(in srgb, var(--color-accent) 90%, transparent);
    filter: drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent) 60%, transparent));
    animation: pulse-sleep-moon 2.5s ease-in-out infinite;
}
@keyframes pulse-sleep-moon {
    0%, 100% { opacity: 1; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent) 60%, transparent)); }
    50% { opacity: 0.5; filter: drop-shadow(0 0 8px color-mix(in srgb, var(--color-accent) 30%, transparent)); }
}
.batt-warn {
    color: var(--color-warning-text);
}
</style>
