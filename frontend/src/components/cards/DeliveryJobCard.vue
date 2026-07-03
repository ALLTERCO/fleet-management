<template>
    <div
        class="djc"
        :class="`djc--${job.state}`"
        tabindex="0"
        @click="$emit('open')"
        @keydown.enter="$emit('open')"
    >
        <div class="djc-hdr">
            <ProviderLogo v-if="endpoint" :provider="endpoint.provider" />
            <div class="djc-hdr-text">
                <div class="djc-name">
                    {{ endpoint ? endpoint.name : `Channel #${job.channelId}` }}
                </div>
                <div class="djc-meta">
                    Job #{{ job.id }} · {{ formatTs(job.createdAt) }}
                </div>
            </div>
            <span class="djc-state" :class="`djc-state--${job.state}`">
                {{ job.state }}
            </span>
        </div>
        <div class="djc-footer">
            <span class="djc-attempts">
                <i class="fas fa-arrows-rotate djc-icon" />
                {{ job.attemptCount }} attempt{{ job.attemptCount === 1 ? '' : 's' }}
            </span>
            <span v-if="job.completedAt" class="djc-completed">
                Completed {{ formatTs(job.completedAt) }}
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {Channel} from '@api/channel';
import type {DeliveryJob} from '@api/notification';
import ProviderLogo from '@/components/core/ProviderLogo.vue';

defineProps<{
    job: DeliveryJob;
    endpoint?: Channel | null;
}>();

defineEmits<{open: []}>();

function formatTs(ts: string): string {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString();
}
</script>

<style scoped>
.djc {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border-default);
    border-left: 4px solid var(--color-border-medium);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    cursor: pointer;
    transition: background var(--duration-fast);
}
.djc:hover {
    background: var(--color-surface-2);
    box-shadow: var(--shadow-brand-ring);
}
.djc:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.djc--succeeded {
    border-left-color: var(--color-success);
}
.djc--failed {
    border-left-color: var(--color-danger);
}
.djc--queued,
.djc--processing {
    border-left-color: var(--color-info);
}
.djc-hdr {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.djc-hdr-text {
    flex: 1;
    min-width: 0;
}
.djc-name {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.djc-meta {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.djc-state {
    font-size: var(--type-body);
    font-weight: 600;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px solid transparent;
}
.djc-state--succeeded {
    color: var(--color-success-text);
    background: var(--color-success-subtle);
    border-color: var(--color-success);
}
.djc-state--failed {
    color: var(--color-danger-text);
    background: var(--color-danger-subtle);
    border-color: var(--color-danger);
}
.djc-state--queued,
.djc-state--processing {
    color: var(--color-info-text);
    background: var(--color-info-subtle);
    border-color: var(--color-info);
}
.djc-footer {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
}
.djc-attempts,
.djc-completed {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.djc-icon {
    opacity: 0.6;
}
</style>
