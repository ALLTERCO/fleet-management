<template>
    <span class="csb" :class="`csb--${descriptor.variant}`">
        <i class="csb__dot" aria-hidden="true" />
        {{ descriptor.label }}
    </span>
</template>

<script setup lang="ts">
import {computed} from 'vue';

interface Descriptor {
    label: string;
    variant: 'verified' | 'pending' | 'failed' | 'disabled' | 'unknown';
}

const props = defineProps<{
    verificationStatus?: string | null;
    disabledReason?: string | null;
}>();

const STATUS_MAP: Readonly<Record<string, Descriptor>> = {
    verified: {label: 'Verified', variant: 'verified'},
    pending: {label: 'Pending', variant: 'pending'},
    failed: {label: 'Failed', variant: 'failed'},
    unverified: {label: 'Unverified', variant: 'pending'}
};

const FALLBACK: Descriptor = {label: 'Unknown', variant: 'unknown'};
const DISABLED: Descriptor = {label: 'Disabled', variant: 'disabled'};

const descriptor = computed<Descriptor>(() => {
    if (props.disabledReason) return DISABLED;
    const key = (props.verificationStatus ?? '').toLowerCase();
    return STATUS_MAP[key] ?? FALLBACK;
});
</script>

<style scoped>
.csb {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    border: 1px solid currentColor;
    background-color: color-mix(in srgb, currentColor 12%, transparent);
    line-height: 1;
}

.csb__dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background-color: currentColor;
    box-shadow: 0 0 6px currentColor;
}

.csb--verified { color: var(--color-status-on); }
.csb--pending  { color: var(--color-status-warn); }
.csb--failed   { color: var(--color-status-off); }
.csb--disabled { color: var(--color-text-tertiary); }
.csb--unknown  { color: var(--color-text-tertiary); }

.csb--pending .csb__dot {
    animation: csb-pulse 1.4s ease-in-out infinite;
}

@keyframes csb-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.4; transform: scale(0.7); }
}

@media (prefers-reduced-motion: reduce) {
    .csb--pending .csb__dot { animation: none; }
}
</style>
