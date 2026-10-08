<template>
    <div
        class="aic"
        :class="{'aic--selectable': selectable, 'aic--selected': selected, 'aic--unseen': showTimerPill}"
        role="button"
        tabindex="0"
        :aria-pressed="selectable ? selected : undefined"
        @click="onCardClick"
        @keydown.enter="onCardClick"
        @keydown.space.prevent="onCardClick"
    >
        <label
            v-if="selectable"
            class="aic-select"
            @click.stop
        >
            <input
                type="checkbox"
                class="aic-select__box"
                :checked="selected"
                :aria-label="`Select ${instance.title}`"
                @change="toggleSelect"
            />
        </label>

        <span class="aic-icon" :class="`aic-icon--${severityVariant}`" aria-hidden="true">
            <i :class="kindIcon" />
        </span>

        <span class="aic-body">
            <span class="aic-name" :title="instance.title">{{ instance.title }}</span>
            <span class="aic-meta">
                <span class="aic-kind">{{ kindLabel }}</span>
                <span class="aic-meta__sep" aria-hidden="true">·</span>
                <span>{{ ageLabel }}</span>
            </span>
        </span>

        <span class="aic-state">
            <span
                v-if="showTimerPill"
                class="aic-state--active"
                :class="`aic-state--${timerLevel}`"
                :title="`Active for ${timerLabel}, no acknowledgement`"
            >
                <span class="aic-pulse" />
                {{ timerLabel }}
            </span>
            <span v-else-if="isSilenced" class="aic-state--muted">
                <i class="fas fa-bell-slash" aria-hidden="true" />
                Silenced
            </span>
            <span v-else-if="isAcknowledged" class="aic-state--ack">
                <i class="fas fa-circle-check" aria-hidden="true" />
                Acknowledged
            </span>
            <span v-else-if="instance.state === 'resolved'" class="aic-state--resolved">
                <i class="fas fa-circle-check" aria-hidden="true" />
                Resolved
            </span>
        </span>

        <span v-if="!selectable" class="aic-actions">
            <button
                v-if="showTimerPill"
                type="button"
                class="aic-action"
                title="Acknowledge"
                aria-label="Acknowledge"
                @click.stop="emit('acknowledge')"
            >
                <i class="fa-solid fa-check" aria-hidden="true" />
            </button>
            <button
                type="button"
                class="aic-action"
                title="Open"
                aria-label="Open"
                @click.stop="emit('open')"
            >
                <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
            </button>
        </span>
    </div>
</template>

<script setup lang="ts">
import type {AlertInstance, AlertSeverity} from '@api/alert';
import {computed, onBeforeUnmount} from 'vue';
import {useNowTicker} from '@/composables/useNowTicker';
import {UI_CONFIG} from '@/config/ui';
import {formatRelative} from '@/helpers/format';
import {describeRuleKind} from '@/helpers/ruleKinds';

// One inbox row: severity, what, when, state, and the two quick actions.
// Keeps the props and emits of the old tile so the page needs no change.
const props = withDefaults(
    defineProps<{
        instance: AlertInstance;
        selectable?: boolean;
        selected?: boolean;
    }>(),
    {selectable: false, selected: false}
);

const emit = defineEmits<{open: []; 'toggle-select': []; acknowledge: []}>();

const {now, release} = useNowTicker();
onBeforeUnmount(release);

function onCardClick() {
    if (props.selectable) {
        emit('toggle-select');
        return;
    }
    emit('open');
}

function toggleSelect() {
    emit('toggle-select');
}

const kindMeta = computed(() => describeRuleKind(props.instance.ruleKind));
const kindIcon = computed(() => kindMeta.value.icon);
const kindLabel = computed(() => kindMeta.value.label);

const SEVERITY_VARIANT: Record<AlertSeverity, 'danger' | 'warning' | 'info'> = {
    info: 'info',
    warning: 'warning',
    critical: 'danger'
};
const severityVariant = computed(() => SEVERITY_VARIANT[props.instance.severity]);

function minutesBetween(iso: string, ref: number): number {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, Math.round((ref - t) / 60_000));
}

const ageLabel = computed(() => {
    const t = new Date(props.instance.lastTriggeredAt).getTime();
    return Number.isFinite(t) ? formatRelative(t, now.value) : '';
});

const isSilenced = computed(() => {
    const until = props.instance.silencedUntil;
    if (!until) return false;
    const t = new Date(until).getTime();
    return Number.isFinite(t) && t > now.value;
});

const isAcknowledged = computed(
    () =>
        !!props.instance.acknowledgedAt ||
        props.instance.state === 'acknowledged'
);

const showTimerPill = computed(
    () =>
        props.instance.state === 'active' &&
        !props.instance.acknowledgedAt &&
        !props.instance.silencedUntil
);

const activeForMins = computed(() =>
    minutesBetween(props.instance.activeSince, now.value)
);

const timerLabel = computed(() => {
    const mins = activeForMins.value;
    if (mins < 1) return 'new';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    if (hours < 24) return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
});

const timerLevel = computed(() => {
    const mins = activeForMins.value;
    const {amberMins, dangerMins} =
        UI_CONFIG.alertTimer[props.instance.severity];
    if (mins >= dangerMins) return 'danger';
    if (mins >= amberMins) return 'warn';
    return 'ok';
});
</script>

<style scoped>
/* A row, not a tile: more alerts on one screen, reads like a list. */
.aic {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--alert-row-min-height);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    cursor: pointer;
    transition:
        border-color var(--motion-hover),
        background-color var(--motion-hover);
}
.aic:hover {
    border-color: var(--color-primary);
    background: var(--state-hover-bg);
}
.aic:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.aic:active {
    background: var(--state-hover-bg-strong);
}
.aic--selected {
    border-color: var(--color-primary);
    box-shadow: inset 0 0 0 1px var(--color-primary);
}

/* The checkbox gets a full 44px hit area. */
.aic-select {
    display: grid;
    flex: none;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    place-items: center;
    margin: calc(-1 * var(--space-2)) 0;
    cursor: pointer;
}
.aic-select__box {
    width: var(--space-4);
    height: var(--space-4);
    accent-color: var(--color-primary);
    cursor: pointer;
}

/* Kind icon, tinted by severity. */
.aic-icon {
    display: flex;
    flex: none;
    width: var(--space-8);
    height: var(--space-8);
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    font-size: var(--type-body);
}
.aic-icon i {
    transform: translateY(var(--icon-optical-offset));
}
.aic-icon--danger {
    color: rgb(var(--color-danger-rgb));
    background: rgba(var(--color-danger-rgb), 0.12);
}
.aic-icon--warning {
    color: rgb(var(--color-warning-rgb));
    background: rgba(var(--color-warning-rgb), 0.12);
}
.aic-icon--info {
    color: rgb(var(--color-info-rgb));
    background: rgba(var(--color-info-rgb), 0.12);
}

.aic-body {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-0-5);
}
.aic-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.aic--unseen .aic-name {
    font-weight: var(--font-bold);
}
.aic-meta {
    display: flex;
    gap: var(--space-1-5);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.aic-kind {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* State, right of the text. */
.aic-state {
    flex: none;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}
.aic-state > span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
}
.aic-state--ok {
    color: var(--color-text-secondary);
}
.aic-state--warn {
    --pulse-rgb: var(--color-warning-rgb);
    color: var(--color-warning-text);
}
.aic-state--danger {
    --pulse-rgb: var(--color-danger-rgb);
    color: var(--color-danger-text);
}
.aic-state--muted,
.aic-state--ack,
.aic-state--resolved {
    color: var(--color-text-tertiary);
}
.aic-pulse {
    width: var(--alert-pulse-size);
    height: var(--alert-pulse-size);
    border-radius: var(--radius-full);
    background: var(--color-text-tertiary);
}
.aic-state--warn .aic-pulse,
.aic-state--danger .aic-pulse {
    background: rgb(var(--pulse-rgb));
    box-shadow: 0 0 0 0 rgba(var(--pulse-rgb), 0.55);
    animation: aic-pulse 1.6s ease-out infinite;
}
@keyframes aic-pulse {
    0% {
        box-shadow: 0 0 0 0 rgba(var(--pulse-rgb), 0.55);
    }
    70% {
        box-shadow: 0 0 0 var(--space-1-5) rgba(var(--pulse-rgb), 0);
    }
    100% {
        box-shadow: 0 0 0 0 rgba(var(--pulse-rgb), 0);
    }
}

/* Quick actions show on hover or keyboard focus, so the row stays quiet. */
.aic-actions {
    display: flex;
    flex: none;
    gap: var(--space-1);
    margin: calc(-1 * var(--space-2)) 0;
    opacity: 0;
    transition: opacity var(--motion-hover);
}
.aic:hover .aic-actions,
.aic:focus-within .aic-actions {
    opacity: 1;
}
.aic-action {
    display: grid;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    place-items: center;
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: background-color var(--motion-hover), color var(--motion-hover);
}
.aic-action i {
    transform: translateY(var(--icon-optical-offset));
}
.aic-action:hover {
    background: var(--state-hover-bg-strong);
    color: var(--color-text-primary);
}
.aic-action:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: calc(-1 * var(--focus-ring-width));
}
.aic-action:active {
    background: var(--state-active-bg);
}
.aic-action:disabled {
    opacity: 0.5;
    cursor: default;
}

/* Touch: no hover, so the actions stay visible. */
@media (hover: none) {
    .aic-actions {
        opacity: 1;
    }
}
</style>
