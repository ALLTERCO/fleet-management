<template>
    <div
        class="dgc"
        :class="{
            'dgc--selected': selected,
            'dgc--disabled': !destination.enabled
        }"
        tabindex="0"
        @click="$emit('open-preview')"
        @keydown.enter="$emit('open-preview')"
    >
        <div class="dgc-hdr">
            <div class="dgc-name">{{ destination.name }}</div>
            <span
                class="dgc-state"
                :class="`dgc-state--${destination.enabled ? 'on' : 'off'}`"
            >
                {{ destination.enabled ? 'Enabled' : 'Disabled' }}
            </span>
        </div>
        <p v-if="destination.description" class="dgc-desc">
            {{ destination.description }}
        </p>
        <div class="dgc-counts">
            <span class="dgc-count">
                <i class="fas fa-users dgc-count-icon" />
                {{ destination.counts.members }} member{{
                    destination.counts.members === 1 ? '' : 's'
                }}
            </span>
            <span v-if="destination.counts.rulesReferencing > 0" class="dgc-count">
                <i class="fas fa-link dgc-count-icon" />
                {{ destination.counts.rulesReferencing }} rule{{
                    destination.counts.rulesReferencing === 1 ? '' : 's'
                }}
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {DestinationGroup} from '@api/notification';

withDefaults(
    defineProps<{
        destination: DestinationGroup;
        selected?: boolean;
    }>(),
    {selected: false}
);

defineEmits<{'open-preview': []}>();
</script>

<style scoped>
.dgc {
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
.dgc:hover {
    border-color: var(--color-primary);
    background: var(--color-surface-2);
    box-shadow: var(--shadow-brand-ring);
}
.dgc:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.dgc--selected {
    border-color: var(--color-primary);
}
.dgc--disabled {
    opacity: 0.7;
}
.dgc-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}
.dgc-name {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.dgc-state {
    font-size: var(--type-body);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid transparent;
    white-space: nowrap;
}
.dgc-state--on {
    color: var(--color-success-text);
    background: var(--color-success-subtle);
    border-color: var(--color-success);
}
.dgc-state--off {
    color: var(--color-text-disabled);
    background: var(--color-surface-2);
    border-color: var(--color-border-medium);
}
.dgc-desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.dgc-counts {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
}
.dgc-count {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.dgc-count-icon {
    opacity: 0.6;
}
</style>
