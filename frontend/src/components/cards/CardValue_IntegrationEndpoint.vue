<template>
    <div
        class="iec"
        :class="{'iec--selected': selected, 'iec--disabled': !endpoint.enabled}"
        tabindex="0"
        @click="$emit('open-preview')"
        @keydown.enter="$emit('open-preview')"
    >
        <div class="iec-hdr">
            <ProviderLogo :provider="endpoint.provider" />
            <div class="iec-hdr-text">
                <div class="iec-name">{{ endpoint.name }}</div>
                <div class="iec-provider">{{ providerLabel }}</div>
            </div>
            <span
                class="iec-state"
                :class="`iec-state--${endpoint.enabled ? 'on' : 'off'}`"
            >
                {{ endpoint.enabled ? 'Enabled' : 'Disabled' }}
            </span>
        </div>

        <div class="iec-body">
            <div v-if="lastDeliveryLabel" class="iec-line">
                <i class="fas fa-paper-plane iec-line-icon" />
                {{ lastDeliveryLabel }}
            </div>
            <div v-if="lastTestLabel" class="iec-line">
                <i class="fas fa-flask iec-line-icon" />
                {{ lastTestLabel }}
            </div>
            <div v-if="endpoint.secretState.hasSecretFields" class="iec-line">
                <i class="fas fa-lock iec-line-icon" />
                Secret configured
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {Channel} from '@api/channel';
import {computed} from 'vue';
import ProviderLogo from '@/components/core/ProviderLogo.vue';

const props = withDefaults(
    defineProps<{
        endpoint: Channel;
        providerLabel?: string;
        selected?: boolean;
    }>(),
    {selected: false, providerLabel: ''}
);

defineEmits<{'open-preview': []}>();

function relative(ts: string | null): string {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString();
}

const lastDeliveryLabel = computed(() => {
    const at = props.endpoint.lastDeliveryAt;
    if (!at) return '';
    const status = props.endpoint.lastDeliveryStatus;
    return `Last delivery: ${relative(at)}${status ? ` — ${status}` : ''}`;
});

const lastTestLabel = computed(() => {
    const at = props.endpoint.lastTestAt;
    if (!at) return '';
    const status = props.endpoint.lastTestStatus;
    return `Last test: ${relative(at)}${status ? ` — ${status}` : ''}`;
});
</script>

<style scoped>
.iec {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    cursor: pointer;
    transition:
        border-color var(--duration-fast),
        background var(--duration-fast);
}
.iec:hover {
    border-color: var(--color-primary);
    background: var(--color-surface-2);
    box-shadow: var(--shadow-brand-ring);
}
.iec:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.iec--selected {
    border-color: var(--color-primary);
}
.iec--disabled {
    opacity: 0.7;
}

.iec-hdr {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.iec-hdr-text {
    flex: 1;
    min-width: 0;
}
.iec-name {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.iec-provider {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}

.iec-state {
    font-size: var(--type-body);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid transparent;
    white-space: nowrap;
}
.iec-state--on {
    color: var(--color-success-text);
    background: var(--color-success-subtle);
    border-color: var(--color-success);
}
.iec-state--off {
    color: var(--color-text-disabled);
    background: var(--color-surface-2);
    border-color: var(--color-border-medium);
}

.iec-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.iec-line {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    display: flex;
    align-items: center;
    gap: var(--space-1);
}
.iec-line-icon {
    opacity: 0.6;
    width: var(--space-3);
}
</style>
