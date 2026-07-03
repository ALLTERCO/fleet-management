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
            <template v-if="device.loading">
                <div class="dc-dot dc-dot-loading" />
            </template>
            <span v-else-if="virtualStatus" :class="virtualStatus.className">
                <span class="dc-pill-dot" />
                {{ virtualStatus.label }}
            </span>
            <span v-else-if="!isOnline" class="dc-pill-off">
                <span class="dc-pill-dot" />
                Offline
            </span>
            <div v-else-if="isSleeping" class="dc-sleep-badge" :title="lastSeenText">
                <i class="fas fa-moon dc-sleep-moon" />
            </div>
            <template v-else>
                <span v-if="batteryPercent != null" :class="batteryPillClass">
                    <i :class="batteryIcon" /> {{ batteryPercent }}%
                </span>
                <div v-else class="dc-dot dc-dot-on" />
            </template>
        </template>
        <template v-if="$slots.footer" #footer>
            <slot name="footer" />
        </template>
    </DCCard>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import DCCard from '@/components/core/DCCard.vue';
import {
    getAppName,
    getDeviceName,
    getLevelIndicator,
    getLogoFromShellyID,
    handleDeviceImgError
} from '@/helpers/device';
import {resolveDeviceLogo} from '@/helpers/deviceLogo';

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

const isOnline = computed(
    () =>
        (props.device.online !== false || !!props.device.sleeping) &&
        !props.device.loading
);

const isSleeping = computed(() => !!props.device.sleeping);

const virtualStatus = computed(() => {
    const source = props.device.source;
    const isVirtual =
        source === 'virtual' || props.device.meta?.virtualDevice != null;
    if (!isVirtual) return null;
    if (props.device.meta?.preview === true) {
        return {label: 'Preview', className: 'dc-pill-virtual dc-pill-virtual--preview'};
    }
    const health = props.device.status?.virtualdevice?.health?.status;
    const presence = props.device.status?.virtualdevice?.presence;
    if (health === 'degraded' || presence === 'degraded') {
        return {label: 'Degraded', className: 'dc-pill-virtual dc-pill-virtual--warn'};
    }
    if (!isOnline.value || health === 'offline' || presence === 'offline') {
        return {label: 'Offline', className: 'dc-pill-off'};
    }
    return {label: 'Ready', className: 'dc-pill-virtual dc-pill-virtual--ready'};
});

const batteryPercent = computed(() => {
    const level = getLevelIndicator(props.device as any);
    return level.type === 'battery' ? level.value : null;
});

const batteryPillClass = computed(() => {
    const b = batteryPercent.value ?? 100;
    if (b <= 25) return 'dc-pill-battery dc-pill-battery--red';
    if (b <= 50) return 'dc-pill-battery dc-pill-battery--orange';
    return 'dc-pill-battery';
});

const batteryIcon = computed(() => {
    const b = batteryPercent.value ?? 100;
    if (b <= 10) return 'fas fa-battery-empty';
    if (b <= 25) return 'fas fa-battery-quarter';
    if (b <= 50) return 'fas fa-battery-half';
    if (b <= 75) return 'fas fa-battery-three-quarters';
    return 'fas fa-battery-full';
});

const lastSeenText = computed(() => {
    const s = props.device.status;
    const ts = s?.ts ?? s?.sys?.unixtime ?? 0;
    if (!ts) return 'Sleeping';
    const diffS = Math.floor(Date.now() / 1000 - ts);
    if (diffS < 60) return 'Last seen just now';
    if (diffS < 3600) return `Last seen ${Math.floor(diffS / 60)}m ago`;
    if (diffS < 86400) return `Last seen ${Math.floor(diffS / 3600)}h ago`;
    return `Last seen ${Math.floor(diffS / 86400)}d ago`;
});

const deviceName = computed(() =>
    getDeviceName(props.device.info, props.device.shellyID)
);

const resolvedLabel = computed(
    () => props.label ?? getAppName(props.device.info)
);

const deviceLogo = computed(() => {
    const resolved = resolveDeviceLogo(props.device as never);
    if (
        resolved.kind === 'image' &&
        resolved.src === '/images/branding/shelly_logo_black.jpg' &&
        props.device.shellyID
    ) {
        return {
            kind: 'image' as const,
            src: getLogoFromShellyID(props.device.shellyID)
        };
    }
    return resolved;
});

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

function onImgError(e: Event) {
    handleDeviceImgError(e, props.device.info?.model);
}
</script>

<style scoped>
/* Loading dot — pulsing neutral */
.dc-dot-loading {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-text-disabled);
    animation: dc-loading-pulse 1.2s ease-in-out infinite;
}

@keyframes dc-loading-pulse {
    0%,
    100% {
        opacity: 0.3;
    }
    50% {
        opacity: 1;
    }
}

/* Battery pill */
.dc-pill-battery {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-2xl);
    background: rgba(var(--color-success-rgb), 0.12);
    border: 1px solid rgba(var(--color-success-rgb), 0.35);
    font-size: var(--type-body);
    font-weight: 700;
    letter-spacing: 0.04em;
    color: rgba(var(--color-success-rgb), 0.9);
}

.dc-pill-battery i {
    font-size: var(--type-body);
}

.dc-pill-virtual {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 7px;
    border-radius: var(--radius-2xl);
    font-size: 7.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
}

.dc-pill-virtual--ready {
    background: rgba(var(--color-success-rgb), 0.12);
    border: 1px solid rgba(var(--color-success-rgb), 0.35);
    color: rgba(var(--color-success-rgb), 0.9);
}

.dc-pill-virtual--ready .dc-pill-dot {
    background: rgba(var(--color-success-rgb), 0.9);
}

.dc-pill-virtual--warn {
    background: rgba(var(--color-warning-rgb), 0.12);
    border: 1px solid rgba(var(--color-warning-rgb), 0.35);
    color: rgba(var(--color-warning-rgb), 0.95);
}

.dc-pill-virtual--warn .dc-pill-dot {
    background: rgba(var(--color-warning-rgb), 0.95);
}

.dc-pill-virtual--preview {
    background: rgba(var(--color-info-rgb), 0.12);
    border: 1px solid rgba(var(--color-info-rgb), 0.35);
    color: rgba(var(--color-info-rgb), 0.95);
}

.dc-pill-virtual--preview .dc-pill-dot {
    background: rgba(var(--color-info-rgb), 0.95);
}

.dc-pill-battery--orange {
    background: rgba(var(--color-warning-rgb), 0.12);
    border-color: rgba(var(--color-warning-rgb), 0.35);
    color: rgba(var(--color-warning-rgb), 0.9);
}

.dc-pill-battery--red {
    background: rgba(var(--color-danger-rgb), 0.12);
    border-color: rgba(var(--color-danger-rgb), 0.35);
    color: rgba(var(--color-danger-rgb), 0.9);
}

/* Sleeping moon — pulsating purple */
.dc-sleep-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    animation: dc-sleep-pulse 2.5s ease-in-out infinite;
}

.dc-sleep-moon {
    font-size: var(--type-body);
    color: color-mix(in srgb, var(--color-accent) 90%, transparent);
    filter: drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent) 60%, transparent));
}

@keyframes dc-sleep-pulse {
    0%,
    100% {
        box-shadow: 0 0 0 0 transparent;
    }
    50% {
        box-shadow:
            0 0 0 3px color-mix(in srgb, var(--color-accent) 22%, transparent),
            0 0 14px color-mix(in srgb, var(--color-accent) 70%, transparent);
    }
}
</style>
