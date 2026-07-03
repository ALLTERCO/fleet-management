<template>
    <transition name="pin-tip">
        <div
            v-if="pin"
            class="pin-tip"
            :style="{left: `${position.x}px`, top: `${position.y}px`}"
            role="tooltip"
        >
            <span
                class="pin-tip__pip"
                :class="`pin-tip__pip--${pin.status ?? 'unknown'}`"
                aria-hidden="true"
            />
            <div class="pin-tip__body">
                <div class="pin-tip__name">{{ pin.label ?? 'Site' }}</div>
                <div v-if="subtitle" class="pin-tip__sub">{{ subtitle }}</div>
            </div>
        </div>
    </transition>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import type {MapPin} from '@/types/map';

const props = defineProps<{
    pin: MapPin | null;
    position: {x: number; y: number};
}>();

const subtitle = computed(() => {
    if (!props.pin) return '';
    const count = props.pin.alertCount ?? 0;
    if (count > 0) return `${count} open alert${count === 1 ? '' : 's'}`;
    return STATUS_LABEL[props.pin.status ?? 'unknown'];
});

const STATUS_LABEL: Record<string, string> = {
    on: 'All devices online',
    warn: 'Some devices offline',
    off: 'All devices offline',
    unknown: 'No device data'
};
</script>

<style scoped>
.pin-tip {
    position: absolute;
    transform: translate(-50%, calc(-100% - 18px));
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--glass-4-bg);
    backdrop-filter: var(--glass-4-filter);
    -webkit-backdrop-filter: var(--glass-4-filter);
    border: 1px solid var(--color-border-medium);
    box-shadow: var(--glass-shadow);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    pointer-events: none;
    white-space: nowrap;
    z-index: 6;
}
.pin-tip__pip {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: 50%;
    flex-shrink: 0;
}
.pin-tip__pip--on {
    background: var(--color-status-on);
    box-shadow: 0 0 6px var(--color-status-on);
}
.pin-tip__pip--warn {
    background: var(--color-status-warn);
    box-shadow: 0 0 6px var(--color-status-warn);
}
.pin-tip__pip--off {
    background: var(--color-status-off);
    box-shadow: 0 0 6px var(--color-status-off);
}
.pin-tip__pip--unknown {
    background: var(--color-primary);
}
.pin-tip__name {
    font-weight: var(--font-bold);
}
.pin-tip__sub {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    margin-top: 1px;
}
.pin-tip-enter-active,
.pin-tip-leave-active {
    transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.pin-tip-enter-from,
.pin-tip-leave-to {
    opacity: 0;
}
</style>
