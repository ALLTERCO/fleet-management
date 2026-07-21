<template>
    <div
        class="aic"
        :class="{'aic--selectable': selectable, 'aic--selected': selected}"
        role="button"
        tabindex="0"
        @click="onCardClick"
        @keydown.enter="onCardClick"
    >
        <div class="aic-top">
            <span
                v-if="selectable"
                class="aic-select"
                @click.stop="toggleSelect"
                @keydown.enter.stop="toggleSelect"
                @keydown.space.stop="toggleSelect"
            >
                <input
                    type="checkbox"
                    class="aic-select__box"
                    :checked="selected"
                    :aria-label="`Select ${instance.title}`"
                    @change="toggleSelect"
                    @click.stop
                />
            </span>
            <AlertSeverityBadge :severity="instance.severity" />
        </div>

        <div class="aic-icon" :class="`aic-icon--${severityVariant}`">
            <i :class="kindIcon" aria-hidden="true" />
        </div>

        <div class="aic-name-wrap">
            <h3 class="aic-name" :title="instance.title">{{ instance.title }}</h3>
        </div>

        <div class="aic-foot">
            <span
                v-if="showTimerPill"
                class="aic-foot--active"
                :class="`aic-foot--${timerLevel}`"
                :title="`Active for ${timerLabel}, no acknowledgement`"
            >
                <span class="aic-pulse" />
                Active {{ timerLabel }}
            </span>
            <span v-else-if="isSilenced" class="aic-foot--muted">
                <i class="fas fa-bell-slash" aria-hidden="true" />
                Silenced
            </span>
            <span v-else-if="isAcknowledged" class="aic-foot--ack">
                <i class="fas fa-circle-check" aria-hidden="true" />
                Acknowledged
            </span>
            <span v-else-if="instance.state === 'resolved'" class="aic-foot--resolved">
                <i class="fas fa-circle-check" aria-hidden="true" />
                Resolved
            </span>
            <span v-else class="aic-foot--age">
                <i class="fas fa-clock" aria-hidden="true" />
                {{ ageLabel }}
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {AlertInstance, AlertSeverity} from '@api/alert';
import {computed, onBeforeUnmount} from 'vue';
import AlertSeverityBadge from '@/components/core/AlertSeverityBadge.vue';
import {useNowTicker} from '@/composables/useNowTicker';
import {UI_CONFIG} from '@/config/ui';
import {formatRelative} from '@/helpers/format';
import {describeRuleKind} from '@/helpers/ruleKinds';

const props = withDefaults(
    defineProps<{
        instance: AlertInstance;
        selectable?: boolean;
        selected?: boolean;
    }>(),
    {selectable: false, selected: false}
);

const emit = defineEmits<{open: []; 'toggle-select': []}>();

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

// Same kind catalog as the rule card — icon per alert kind, tinted by severity.
const kindIcon = computed(() => describeRuleKind(props.instance.ruleKind).icon);

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
    return Number.isFinite(t) ? formatRelative(t, now.value) : '—';
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
/* Vertical tile — mirrors AlertRuleCard (.arc) so active alerts and their
   rules read as the same family. */
.aic {
    display: flex;
    flex-direction: column;
    width: var(--grid-cell, 200px);
    height: 234px;
    padding: var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    cursor: pointer;
    overflow: hidden;
    transition:
        border-color var(--duration-fast),
        box-shadow var(--duration-fast),
        transform var(--duration-fast);
}
.aic:hover {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-brand-ring);
    transform: translateY(var(--hover-lift));
}
.aic:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.aic--selected {
    border-color: var(--color-primary);
    box-shadow: inset 0 0 0 1px var(--color-primary);
}

/* Top row — severity (left) and state (right), like the rule card's badge + toggle. */
.aic-top {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    flex: none;
    flex-wrap: wrap;
}
.aic-state {
    margin-left: auto;
}
.aic-select {
    display: inline-flex;
    align-items: center;
    flex: none;
}
.aic-select__box {
    width: 16px;
    height: 16px;
    accent-color: var(--color-primary);
    cursor: pointer;
}

/* Pinned kind icon — never moves; tinted by severity. */
.aic-icon {
    flex: none;
    align-self: center;
    margin-top: var(--space-4);
    width: var(--icon-size-2xl);
    height: var(--icon-size-2xl);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-lg);
    font-size: var(--icon-size-xl);
}
.aic-icon--danger {
    color: rgb(var(--color-danger-rgb));
    background: rgba(var(--color-danger-rgb), 0.12);
    box-shadow:
        0 0 0 1px rgba(var(--color-danger-rgb), 0.22),
        0 0 22px rgba(var(--color-danger-rgb), 0.14);
}
.aic-icon--warning {
    color: rgb(var(--color-warning-rgb));
    background: rgba(var(--color-warning-rgb), 0.12);
    box-shadow:
        0 0 0 1px rgba(var(--color-warning-rgb), 0.22),
        0 0 22px rgba(var(--color-warning-rgb), 0.14);
}
.aic-icon--info {
    color: rgb(var(--color-info-rgb));
    background: rgba(var(--color-info-rgb), 0.12);
    box-shadow:
        0 0 0 1px rgba(var(--color-info-rgb), 0.22),
        0 0 22px rgba(var(--color-info-rgb), 0.14);
}

/* Title + source — centered in the gap between icon and footer. */
.aic-name-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-1);
}
.aic-name {
    margin: 0;
    font-size: var(--type-body);
    font-weight: 700;
    line-height: 1.32;
    text-align: center;
    color: var(--color-text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

/* Footer — live status, pinned to the bottom. */
.aic-foot {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border-default);
    font-size: var(--type-caption);
    font-weight: 600;
}
.aic-foot span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
}
.aic-foot--age {
    color: var(--color-text-tertiary);
}
.aic-foot--active {
    font-weight: 700;
}
.aic-foot--ok {
    color: var(--color-text-secondary);
}
.aic-foot--warn {
    --pulse-rgb: var(--color-warning-rgb);
    color: var(--color-warning-text);
}
.aic-foot--danger {
    --pulse-rgb: var(--color-danger-rgb);
    color: var(--color-danger-text);
}
.aic-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-text-tertiary);
}
.aic-foot--warn .aic-pulse,
.aic-foot--danger .aic-pulse {
    background: rgb(var(--pulse-rgb));
    box-shadow: 0 0 0 0 rgba(var(--pulse-rgb), 0.55);
    animation: aic-pulse 1.6s ease-out infinite;
}
@keyframes aic-pulse {
    0% {
        box-shadow: 0 0 0 0 rgba(var(--pulse-rgb), 0.55);
    }
    70% {
        box-shadow: 0 0 0 6px rgba(var(--pulse-rgb), 0);
    }
    100% {
        box-shadow: 0 0 0 0 rgba(var(--pulse-rgb), 0);
    }
}
</style>
