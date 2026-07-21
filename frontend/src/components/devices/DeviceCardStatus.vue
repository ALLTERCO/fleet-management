<template>
    <template v-if="device.loading">
        <span class="dc-dot dc-dot-loading" role="status" aria-label="Loading" />
    </template>
    <span v-else-if="virtualStatus" :class="virtualStatus.className">
        <span class="dc-pill-dot" />
        {{ virtualStatus.label }}
    </span>
    <span v-else-if="!isOnline" class="dc-pill-off" :title="lastSeenTitle">
        <span class="dc-pill-dot" />
        Offline
    </span>
    <span
        v-else-if="isSleeping"
        class="dc-sleep-badge"
        :title="lastSeenText"
        role="status"
        :aria-label="lastSeenText"
    >
        <i class="fas fa-moon dc-sleep-moon" aria-hidden="true" />
    </span>
    <span v-else-if="showBatteryBadge" :class="batteryPillClass">
        <i :class="batteryIcon" /> {{ batteryPercent }}%
    </span>
    <span
        v-else
        class="dc-dot dc-dot-on"
        :class="{'dc-dot-stale': isStale}"
        :title="lastSeenTitle"
        role="status"
        :aria-label="isStale ? 'Online, status stale' : 'Online'"
    />
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {
    getLevelIndicator,
    shouldShowBatteryBadge
} from '@/helpers/device';
import {resolveDeviceLiveness} from '@/helpers/deviceLiveness';

const props = defineProps<{
    device: {
        online?: boolean;
        sleeping?: boolean;
        loading?: boolean;
        source?: string;
        info?: Record<string, any>;
        status?: Record<string, any>;
        meta?: Record<string, any>;
    };
}>();

const liveness = computed(() => resolveDeviceLiveness(props.device));
const isOnline = computed(() => liveness.value.online);
const isSleeping = computed(() => liveness.value.sleeping);
const isStale = computed(() => liveness.value.stale);

const virtualStatus = computed(() => {
    const isVirtual =
        props.device.source === 'virtual' ||
        props.device.meta?.virtualDevice != null;
    if (!isVirtual) return null;
    if (props.device.meta?.preview === true) {
        return {
            label: 'Preview',
            className: 'dc-pill-virtual dc-pill-virtual--preview'
        };
    }
    const health = props.device.status?.virtualdevice?.health?.status;
    const presence = props.device.status?.virtualdevice?.presence;
    if (health === 'degraded' || presence === 'degraded') {
        return {
            label: 'Degraded',
            className: 'dc-pill-virtual dc-pill-virtual--warn'
        };
    }
    if (!isOnline.value || health === 'offline' || presence === 'offline') {
        return {label: 'Offline', className: 'dc-pill-off'};
    }
    return {
        label: 'Ready',
        className: 'dc-pill-virtual dc-pill-virtual--ready'
    };
});

const batteryPercent = computed(() => {
    const level = getLevelIndicator(props.device as never);
    return level.type === 'battery' ? level.value : null;
});
const showBatteryBadge = computed(() =>
    shouldShowBatteryBadge(batteryPercent.value)
);
const batteryPillClass = computed(() => {
    const level = batteryPercent.value ?? 100;
    if (level <= 25) return 'dc-pill-battery dc-pill-battery--red';
    if (level <= 50) return 'dc-pill-battery dc-pill-battery--orange';
    return 'dc-pill-battery';
});
const batteryIcon = computed(() => {
    const level = batteryPercent.value ?? 100;
    if (level <= 10) return 'fas fa-battery-empty';
    if (level <= 25) return 'fas fa-battery-quarter';
    if (level <= 50) return 'fas fa-battery-half';
    if (level <= 75) return 'fas fa-battery-three-quarters';
    return 'fas fa-battery-full';
});

const lastSeenText = computed(() => {
    const reportMs = liveness.value.lastReportMs;
    if (!reportMs) return 'Sleeping';
    const diffS = Math.floor((Date.now() - reportMs) / 1000);
    if (diffS < 60) return 'Last seen just now';
    if (diffS < 3600) return `Last seen ${Math.floor(diffS / 60)}m ago`;
    if (diffS < 86400) return `Last seen ${Math.floor(diffS / 3600)}h ago`;
    return `Last seen ${Math.floor(diffS / 86400)}d ago`;
});
const lastSeenTitle = computed(() =>
    liveness.value.lastReportMs ? lastSeenText.value : undefined
);
</script>

<style scoped>
.dc-dot-stale {
    background: var(--color-text-disabled);
    box-shadow: none;
    animation: none;
    opacity: var(--opacity-dim);
}
.dc-dot-loading {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: 50%;
    background: var(--color-text-disabled);
    animation: dc-loading-pulse 1.2s ease-in-out infinite;
}
@keyframes dc-loading-pulse {
    0%,
    100% { opacity: 0.3; }
    50% { opacity: 1; }
}
.dc-pill-battery,
.dc-pill-virtual {
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-2xl);
    font-weight: var(--font-bold);
}
.dc-pill-battery {
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border: var(--space-px) solid rgba(var(--color-success-rgb), 0.35);
    background: rgba(var(--color-success-rgb), 0.12);
    color: rgba(var(--color-success-rgb), 0.9);
    font-size: var(--type-body);
}
.dc-pill-battery i { font-size: var(--type-body); }
.dc-pill-virtual {
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--type-caption);
}
.dc-pill-virtual--ready {
    border: var(--space-px) solid rgba(var(--color-success-rgb), 0.35);
    background: rgba(var(--color-success-rgb), 0.12);
    color: rgba(var(--color-success-rgb), 0.9);
}
.dc-pill-virtual--ready .dc-pill-dot { background: rgba(var(--color-success-rgb), 0.9); }
.dc-pill-virtual--warn {
    border: var(--space-px) solid rgba(var(--color-warning-rgb), 0.35);
    background: rgba(var(--color-warning-rgb), 0.12);
    color: rgba(var(--color-warning-rgb), 0.95);
}
.dc-pill-virtual--warn .dc-pill-dot { background: rgba(var(--color-warning-rgb), 0.95); }
.dc-pill-virtual--preview {
    border: var(--space-px) solid rgba(var(--color-info-rgb), 0.35);
    background: rgba(var(--color-info-rgb), 0.12);
    color: rgba(var(--color-info-rgb), 0.95);
}
.dc-pill-virtual--preview .dc-pill-dot { background: rgba(var(--color-info-rgb), 0.95); }
.dc-pill-battery--orange {
    border-color: rgba(var(--color-warning-rgb), 0.35);
    background: rgba(var(--color-warning-rgb), 0.12);
    color: rgba(var(--color-warning-rgb), 0.9);
}
.dc-pill-battery--red {
    border-color: rgba(var(--color-danger-rgb), 0.35);
    background: rgba(var(--color-danger-rgb), 0.12);
    color: rgba(var(--color-danger-rgb), 0.9);
}
.dc-sleep-badge {
    display: inline-flex;
    width: var(--space-6);
    height: var(--space-6);
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    animation: dc-sleep-pulse 2.5s ease-in-out infinite;
}
.dc-sleep-moon {
    color: color-mix(in srgb, var(--color-accent) 90%, transparent);
    filter: drop-shadow(0 0 var(--space-1) color-mix(in srgb, var(--color-accent) 60%, transparent));
    font-size: var(--type-body);
}
@keyframes dc-sleep-pulse {
    0%,
    100% { box-shadow: 0 0 0 0 transparent; }
    50% {
        box-shadow:
            0 0 0 var(--space-1) color-mix(in srgb, var(--color-accent) 22%, transparent),
            0 0 var(--space-3) color-mix(in srgb, var(--color-accent) 70%, transparent);
    }
}

@media (prefers-reduced-motion: reduce) {
    .dc-dot-loading,
    .dc-sleep-badge {
        animation: none;
    }
}
</style>
