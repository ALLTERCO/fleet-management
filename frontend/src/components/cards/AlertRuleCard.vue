<template>
    <div
        class="arc"
        :class="{'arc--disabled': !rule.enabled}"
        role="button"
        tabindex="0"
        @click="$emit('open')"
        @keydown.enter="$emit('open')"
    >
        <div class="arc-top">
            <AlertSeverityBadge :severity="rule.severity" />
            <span
                class="arc-toggle-wrap"
                @click.stop
                @keydown.enter.stop
                @keydown.space.stop
            >
                <Switch
                    :model-value="rule.enabled"
                    :label="rule.enabled ? 'Enabled — turn off' : 'Disabled — turn on'"
                    @update:model-value="$emit('toggle')"
                />
            </span>
        </div>

        <div class="arc-icon" :class="`arc-icon--${severityVariant}`">
            <i :class="kindIcon" :title="kindLabel" aria-hidden="true" />
        </div>

        <div class="arc-name-wrap">
            <h3 class="arc-name" :title="rule.name">{{ rule.name }}</h3>
        </div>

        <div class="arc-foot">
            <span v-if="!rule.enabled" class="arc-foot--off">
                <i class="fas fa-circle-pause" aria-hidden="true" />
                Off — won't fire
            </span>
            <span v-else-if="firingCount > 0" class="arc-foot--firing">
                <span class="arc-pulse" />
                {{ firingCount }} firing now
            </span>
            <span v-else class="arc-foot--quiet">
                <i class="fas fa-circle-check" aria-hidden="true" />
                Quiet
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {AlertRule, AlertSeverity} from '@api/alert';
import {computed} from 'vue';
import AlertSeverityBadge from '@/components/core/AlertSeverityBadge.vue';
import Switch from '@/components/core/Switch.vue';
import {describeRuleKind} from '@/helpers/ruleKinds';

const props = withDefaults(
    defineProps<{
        rule: AlertRule;
        kindLabel?: string;
        /** Active alert instances firing for this rule right now. */
        firingCount?: number;
    }>(),
    {firingCount: 0}
);

defineEmits<{open: []; toggle: []}>();

// The kind catalog is the single source of truth for each rule's icon.
const kindIcon = computed(() => describeRuleKind(props.rule.kind).icon);

// The icon is tinted by severity to match the badge — danger / warning / info.
const SEVERITY_VARIANT: Record<AlertSeverity, 'danger' | 'warning' | 'info'> = {
    info: 'info',
    warning: 'warning',
    critical: 'danger'
};
const severityVariant = computed(() => SEVERITY_VARIANT[props.rule.severity]);
</script>

<style scoped>
.arc {
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
.arc:hover {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-brand-ring);
    transform: translateY(var(--hover-lift));
}
.arc:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.arc--disabled {
    opacity: 0.55;
}

/* Top row — severity badge (left) and on/off toggle (right). */
.arc-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
}

/* Wrapper stops the toggle click from opening the card. */
.arc-toggle-wrap {
    display: inline-flex;
    flex: none;
}

/* Pinned kind icon — never moves; tinted by severity. */
.arc-icon {
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
.arc-icon--danger {
    color: rgb(var(--color-danger-rgb));
    background: rgba(var(--color-danger-rgb), 0.12);
    box-shadow:
        0 0 0 1px rgba(var(--color-danger-rgb), 0.22),
        0 0 22px rgba(var(--color-danger-rgb), 0.14);
}
.arc-icon--warning {
    color: rgb(var(--color-warning-rgb));
    background: rgba(var(--color-warning-rgb), 0.12);
    box-shadow:
        0 0 0 1px rgba(var(--color-warning-rgb), 0.22),
        0 0 22px rgba(var(--color-warning-rgb), 0.14);
}
.arc-icon--info {
    color: rgb(var(--color-info-rgb));
    background: rgba(var(--color-info-rgb), 0.12);
    box-shadow:
        0 0 0 1px rgba(var(--color-info-rgb), 0.22),
        0 0 22px rgba(var(--color-info-rgb), 0.14);
}

/* Name — centered in the gap between the icon and the footer. */
.arc-name-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-1);
}
.arc-name {
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
.arc-foot {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border-default);
    font-size: var(--type-caption);
    font-weight: 600;
}
.arc-foot span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
}
.arc-foot--firing {
    color: var(--color-danger-text);
    font-weight: 700;
}
.arc-foot--quiet {
    color: var(--color-text-tertiary);
}
.arc-foot--off {
    color: var(--color-text-disabled);
}
.arc-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgb(var(--color-danger-rgb));
    box-shadow: 0 0 0 0 rgba(var(--color-danger-rgb), 0.55);
    animation: arc-pulse 1.6s ease-out infinite;
}
@keyframes arc-pulse {
    0% {
        box-shadow: 0 0 0 0 rgba(var(--color-danger-rgb), 0.55);
    }
    70% {
        box-shadow: 0 0 0 6px rgba(var(--color-danger-rgb), 0);
    }
    100% {
        box-shadow: 0 0 0 0 rgba(var(--color-danger-rgb), 0);
    }
}
</style>
