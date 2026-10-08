<template>
    <p v-if="failed" class="tt-empty">Could not load history.</p>
    <p v-else-if="transitions.length === 0" class="tt-empty">
        No transitions yet.
    </p>
    <ol v-else class="tt">
        <li
            v-for="(t, idx) in transitions"
            :key="`${t.at}-${idx}`"
            class="tt__item"
        >
            <span class="tt__marker" :class="`tt__marker--${t.action}`">
                <i :class="iconFor(t.action)" />
            </span>
            <p class="tt__line">
                <span class="tt__action">{{ headlineFor(t) }}</span>
                <span class="tt__meta">{{ metaFor(t) }}</span>
            </p>
        </li>
    </ol>
</template>

<script setup lang="ts">
import type {AlertTransition, AlertTransitionAction} from '@api/alert';

// `failed` is the "the fetch itself broke" case — kept distinct from an
// empty `transitions` array so the reader never mistakes a load failure for
// a genuinely quiet history.
defineProps<{transitions: AlertTransition[]; failed?: boolean}>();

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
function formatTs(ts: string): string {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString();
}

// A silence transition carries when it ends in `data.until` — worth naming
// in the sentence, since that is the fact an operator actually needs.
function silencedUntilText(t: AlertTransition): string | null {
    const until = t.data?.until;
    return t.action === 'silenced' && typeof until === 'string'
        ? formatTs(until)
        : null;
}

// Deleting a rule closes every alert it owned at once. Say so, or a whole
// batch reads as having cleared on its own within the same second.
const RESOLVE_REASONS: Record<string, string> = {
    rule_deleted: 'rule deleted'
};

function resolveReason(t: AlertTransition): string | null {
    const mode = t.data?.mode;
    return typeof mode === 'string' ? (RESOLVE_REASONS[mode] ?? null) : null;
}

function headlineFor(t: AlertTransition): string {
    const until = silencedUntilText(t);
    if (until) return `${LABELS[t.action]} until ${until}`;
    const reason = resolveReason(t);
    return reason ? `${LABELS[t.action]}, ${reason}` : LABELS[t.action];
}

// Never a blank actor: no actor on the row means nobody clicked. A row that
// already names its reason does not repeat "automatically" after it.
function metaFor(t: AlertTransition): string {
    const name = t.actor?.displayName || t.actor?.userId;
    if (name) return `by ${name}, ${formatTs(t.at)}`;
    if (resolveReason(t)) return formatTs(t.at);
    return `automatically, ${formatTs(t.at)}`;
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
.tt__line {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--type-body);
    line-height: 1.4;
}
.tt__action {
    font-weight: 600;
    color: var(--color-text-primary);
}
.tt__meta {
    color: var(--color-text-tertiary);
}
.tt-empty {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
</style>
