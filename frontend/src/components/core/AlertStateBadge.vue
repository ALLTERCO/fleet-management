<template>
    <Pill :variant="meta.variant" :icon="meta.icon" :title="meta.tooltip">
        {{ meta.label }}
    </Pill>
</template>

<script setup lang="ts">
import type {AlertState} from '@api/alert';
import {computed} from 'vue';
import Pill from '@/components/core/Pill.vue';

// Silenced is an active state with a future silencedUntil — surface it
// distinctly so ops can see it at a glance.
type DisplayState = AlertState | 'silenced';

type PillVariant = 'danger' | 'warning' | 'success' | 'neutral';

const META: Record<
    DisplayState,
    {label: string; icon: string; tooltip: string; variant: PillVariant}
> = {
    pending: {
        label: 'Pending',
        icon: 'fas fa-hourglass-half',
        tooltip: 'Condition is true but waiting for the hold time',
        variant: 'warning'
    },
    active: {
        label: 'Active',
        icon: 'fas fa-circle',
        tooltip: 'Firing; awaiting acknowledgement',
        variant: 'danger'
    },
    acknowledged: {
        label: 'Acknowledged',
        icon: 'fas fa-check',
        tooltip: 'Seen by a user but still active',
        variant: 'warning'
    },
    recovering: {
        label: 'Recovering',
        icon: 'fas fa-arrow-trend-down',
        tooltip: 'Condition is recovering but not fully resolved',
        variant: 'success'
    },
    resolved: {
        label: 'Resolved',
        icon: 'fas fa-circle-check',
        tooltip: 'No longer firing',
        variant: 'success'
    },
    // Latched lifecycle: alarm condition cleared but the event hasn't been
    // acknowledged yet (cleared_unack) vs both cleared and acknowledged.
    cleared_unack: {
        label: 'Cleared (unack)',
        icon: 'fas fa-bell-slash',
        tooltip: 'Condition cleared, awaiting acknowledgement',
        variant: 'warning'
    },
    cleared_ack: {
        label: 'Cleared',
        icon: 'fas fa-circle-check',
        tooltip: 'Condition cleared and acknowledged',
        variant: 'success'
    },
    no_data: {
        label: 'No data',
        icon: 'fas fa-circle-question',
        tooltip: 'Rule cannot evaluate because data is missing',
        variant: 'neutral'
    },
    evaluation_error: {
        label: 'Evaluation error',
        icon: 'fas fa-triangle-exclamation',
        tooltip: 'Rule evaluation failed',
        variant: 'danger'
    },
    silenced: {
        label: 'Silenced',
        icon: 'fas fa-bell-slash',
        tooltip: 'Active but notifications suppressed until expiry',
        variant: 'neutral'
    }
};

const props = defineProps<{
    state: AlertState;
    silencedUntil?: string | null;
}>();

const effectiveState = computed<DisplayState>(() => {
    if (props.state !== 'active') return props.state;
    if (!props.silencedUntil) return 'active';
    const expiresAt = new Date(props.silencedUntil).getTime();
    return Number.isFinite(expiresAt) && expiresAt > Date.now()
        ? 'silenced'
        : 'active';
});

const meta = computed(() => META[effectiveState.value]);
</script>
