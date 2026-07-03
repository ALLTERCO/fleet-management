<template>
    <ol class="tt">
        <li
            v-for="(t, idx) in transitions"
            :key="`${t.at}-${idx}`"
            class="tt__item"
        >
            <span class="tt__marker" :class="`tt__marker--${t.action}`">
                <i :class="iconFor(t.action)" />
            </span>
            <div class="tt__body">
                <div class="tt__headline">
                    <span class="tt__action">{{ labelFor(t.action) }}</span>
                    <span v-if="t.actor?.displayName || t.actor?.userId" class="tt__actor">
                        by {{ t.actor.displayName || t.actor.userId }}
                    </span>
                </div>
                <time class="tt__time">{{ formatTs(t.at) }}</time>
            </div>
        </li>
    </ol>
</template>

<script setup lang="ts">
import type {AlertTransition, AlertTransitionAction} from '@api/alert';

defineProps<{transitions: AlertTransition[]}>();

const LABELS: Record<AlertTransitionAction, string> = {
    created: 'Created',
    pending: 'Pending',
    triggered: 'Triggered',
    acknowledged: 'Acknowledged',
    unacknowledged: 'Un-acknowledged',
    silenced: 'Silenced',
    unsilenced: 'Un-silenced',
    recovering: 'Recovering',
    cleared_unack: 'Cleared (unack)',
    cleared_ack: 'Cleared',
    no_data: 'No data',
    evaluation_error: 'Evaluation error',
    resolved: 'Resolved'
};

const ICONS: Record<AlertTransitionAction, string> = {
    created: 'fas fa-plus',
    pending: 'fas fa-hourglass-half',
    triggered: 'fas fa-bolt',
    acknowledged: 'fas fa-check',
    unacknowledged: 'fas fa-rotate-left',
    silenced: 'fas fa-bell-slash',
    unsilenced: 'fas fa-bell',
    recovering: 'fas fa-arrow-trend-down',
    cleared_unack: 'fas fa-bell-slash',
    cleared_ack: 'fas fa-circle-check',
    no_data: 'fas fa-circle-question',
    evaluation_error: 'fas fa-triangle-exclamation',
    resolved: 'fas fa-circle-check'
};

function iconFor(action: AlertTransitionAction): string {
    return ICONS[action];
}
function labelFor(action: AlertTransitionAction): string {
    return LABELS[action];
}
function formatTs(ts: string): string {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString();
}
</script>

<style scoped>
.tt {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    position: relative;
}
.tt::before {
    content: '';
    position: absolute;
    left: calc(var(--space-4) - 1px);
    top: var(--space-2);
    bottom: var(--space-2);
    width: 2px;
    background: var(--color-border-medium);
}
.tt__item {
    display: flex;
    gap: var(--space-3);
    position: relative;
}
.tt__marker {
    width: var(--space-8);
    height: var(--space-8);
    flex-shrink: 0;
    border-radius: var(--radius-full);
    border: 2px solid var(--color-border-medium);
    background: var(--color-surface-0);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    z-index: 1;
}
.tt__marker--created,
.tt__marker--triggered {
    color: var(--color-danger-text);
    border-color: var(--color-danger);
}
.tt__marker--pending,
.tt__marker--acknowledged {
    color: var(--color-warning-text);
    border-color: var(--color-warning);
}
.tt__marker--recovering,
.tt__marker--cleared_ack,
.tt__marker--resolved {
    color: var(--color-success-text);
    border-color: var(--color-success);
}
.tt__marker--evaluation_error {
    color: var(--color-danger-text);
    border-color: var(--color-danger);
}
.tt__marker--no_data,
.tt__marker--cleared_unack,
.tt__marker--silenced,
.tt__marker--unsilenced {
    color: var(--color-text-tertiary);
}
.tt__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.tt__headline {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
}
.tt__action {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
}
.tt__actor {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.tt__time {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
</style>
