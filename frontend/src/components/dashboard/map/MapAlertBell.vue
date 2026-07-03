<template>
    <div ref="hostRef" class="alert-bell-host">
        <button
            type="button"
            class="alert-bell"
            :class="[`alert-bell--${tone}`, {'alert-bell--open': open}]"
            :aria-pressed="open"
            :title="title"
            @click="toggle"
        >
            <i class="fas fa-bell" aria-hidden="true" />
            <span v-if="count > 0" class="alert-bell__badge">
                <span v-if="count > 99">99+</span>
                <TweenNumber v-else :value="count" />
            </span>
        </button>
        <transition name="alert-rail">
            <section
                v-if="open"
                class="alert-rail"
                role="dialog"
                aria-label="Live alerts"
            >
                <header class="alert-rail__head">
                    <div class="alert-rail__title">
                        <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                        Live alerts
                        <span class="alert-rail__count">{{ count }}</span>
                    </div>
                    <span class="alert-rail__live">
                        <span class="alert-rail__live-dot" aria-hidden="true" />
                        LIVE
                    </span>
                </header>
                <ul class="alert-rail__list" role="list">
                    <li
                        v-for="alert in alerts"
                        :key="alert.id"
                        class="alert-item"
                        :class="`alert-item--${alert.severity}`"
                        @click="emitSelect(alert)"
                    >
                        <span class="alert-item__icon" aria-hidden="true">
                            <i :class="['fas', severityIcon(alert.severity)]" />
                        </span>
                        <div class="alert-item__body">
                            <div class="alert-item__title">{{ alert.title }}</div>
                            <div v-if="alert.message" class="alert-item__where">
                                {{ alert.message }}
                            </div>
                            <div class="alert-item__time">
                                {{ formatTime(alert.activeSince) }}
                            </div>
                            <div
                                v-if="alert.source.subjectType === 'device'"
                                class="alert-item__device"
                            >
                                <span class="alert-item__device-thumb" aria-hidden="true">
                                    <i class="fas fa-microchip" />
                                </span>
                                <span class="alert-item__device-id">
                                    {{ alert.source.subjectId }}
                                </span>
                            </div>
                            <div class="alert-item__actions">
                                <button
                                    v-if="!isAcknowledged(alert)"
                                    type="button"
                                    class="alert-item__action alert-item__action--primary"
                                    :disabled="ackPending === alert.id"
                                    @click.stop="emitAcknowledge(alert)"
                                >
                                    <i class="fas fa-check" aria-hidden="true" />
                                    {{ ackPending === alert.id ? 'Marking…' : 'Mark complete' }}
                                </button>
                                <span
                                    v-else
                                    class="alert-item__ack-chip"
                                    aria-label="Already acknowledged"
                                >
                                    <i class="fas fa-check" aria-hidden="true" />
                                    Acknowledged
                                </span>
                            </div>
                        </div>
                    </li>
                    <li v-if="alerts.length === 0" class="alert-rail__empty">
                        No live alerts.
                    </li>
                </ul>
            </section>
        </transition>
    </div>
</template>

<script setup lang="ts">
import type {AlertInstance, AlertSeverity} from '@api/alert';
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import TweenNumber from '@/components/core/TweenNumber.vue';

const props = defineProps<{
    alerts: AlertInstance[];
    severity: AlertSeverity | null;
    open: boolean;
    /** Id currently waiting for an ack RPC to land. */
    ackPending?: number | null;
}>();
const emit = defineEmits<{
    'update:open': [open: boolean];
    select: [alert: AlertInstance];
    acknowledge: [alert: AlertInstance];
}>();

function emitAcknowledge(alert: AlertInstance): void {
    emit('acknowledge', alert);
}

function isAcknowledged(alert: AlertInstance): boolean {
    return alert.state === 'acknowledged' || alert.state === 'cleared_ack';
}

const count = computed(() => props.alerts.length);
const tone = computed<'crit' | 'warn' | 'info' | 'clean'>(() => {
    if (props.severity === 'critical') return 'crit';
    if (props.severity === 'warning') return 'warn';
    if (props.severity === 'info') return 'info';
    return 'clean';
});
const title = computed(() =>
    count.value === 0
        ? 'No live alerts'
        : `${count.value} live alert${count.value === 1 ? '' : 's'}`
);

function toggle(): void {
    emit('update:open', !props.open);
}

function emitSelect(alert: AlertInstance): void {
    emit('select', alert);
}

// Close when the user clicks anywhere outside the bell or its panel.
// Listener is only mounted while open so a closed bell carries no cost.
const hostRef = ref<HTMLElement | null>(null);

function onDocumentPointerDown(event: PointerEvent): void {
    const host = hostRef.value;
    if (!host) return;
    if (event.target instanceof Node && host.contains(event.target)) return;
    emit('update:open', false);
}

watch(
    () => props.open,
    (nowOpen) => {
        if (nowOpen) {
            document.addEventListener('pointerdown', onDocumentPointerDown);
        } else {
            document.removeEventListener('pointerdown', onDocumentPointerDown);
        }
    }
);

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocumentPointerDown);
});

function severityIcon(severity: AlertSeverity): string {
    if (severity === 'critical') return 'fa-triangle-exclamation';
    if (severity === 'warning') return 'fa-circle-exclamation';
    return 'fa-circle-info';
}

function formatTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const elapsed = Date.now() - date.getTime();
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleString([], {month: 'short', day: 'numeric'});
}
</script>

<style scoped>
.alert-bell-host {
    position: relative;
    display: inline-block;
}
.alert-bell {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--glass-2-bg);
    backdrop-filter: blur(24px) saturate(1.2);
    -webkit-backdrop-filter: blur(24px) saturate(1.2);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.22s var(--ease-out-expo);
}
.alert-bell:hover {
    transform: scale(1.04);
    color: var(--color-text-primary);
}
.alert-bell--warn {
    color: var(--color-status-warn);
    border-color: rgba(var(--color-status-warn-rgb), 0.6);
}
.alert-bell--crit {
    color: var(--color-status-off);
    border-color: rgba(var(--color-status-off-rgb), 0.7);
}
.alert-bell--crit::before,
.alert-bell--warn::before {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    border: 2px solid currentColor;
    opacity: 0;
    animation: alert-bell-ring 1.8s ease-out infinite;
    pointer-events: none;
}
@keyframes alert-bell-ring {
    0% { transform: scale(0.9); opacity: 0.7; }
    100% { transform: scale(1.55); opacity: 0; }
}
.alert-bell--open {
    background: rgba(var(--color-primary-rgb), 0.16);
    color: var(--color-primary);
    border-color: rgba(var(--color-primary-rgb), 0.4);
}
.alert-bell--open::before { animation: none; opacity: 0; }
.alert-bell__badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--color-status-off);
    color: var(--color-text-on-danger);
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    display: flex;
    align-items: center;
    justify-content: center;
    font-variant-numeric: tabular-nums;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    border: 1.5px solid rgba(var(--color-surface-bg-rgb), 0.85);
}
.alert-bell--warn .alert-bell__badge {
    background: var(--color-status-warn);
    color: var(--color-text-inverse);
}
@media (prefers-reduced-motion: reduce) {
    .alert-bell--crit::before,
    .alert-bell--warn::before { animation: none; }
}

.alert-rail {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 0;
    width: 360px;
    max-height: calc(100vh - 250px);
    border-radius: var(--radius-xl);
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
    border: 1px solid var(--color-border-medium);
    box-shadow: var(--shadow-xl);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 5;
}
.alert-rail__head {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-default);
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.alert-rail__title {
    flex: 1;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.alert-rail__count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-full);
    background: rgba(var(--color-status-off-rgb), 0.18);
    color: var(--color-status-off);
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
}
.alert-rail__live {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    letter-spacing: 0.06em;
}
.alert-rail__live-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-status-on);
    animation: blink-err 1.5s infinite;
}
.alert-rail__list {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    overflow-y: auto;
    flex: 1;
}
.alert-item {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    cursor: pointer;
    border-left: 3px solid transparent;
    transition: all var(--duration-normal) var(--ease-out-expo);
}
.alert-item:hover { background: rgba(var(--color-frost-rgb), 0.06); }
.alert-item--critical { border-left-color: var(--color-status-off); }
.alert-item--warning { border-left-color: var(--color-status-warn); }
.alert-item--info { border-left-color: var(--color-primary); }
.alert-item__icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: var(--type-caption);
}
.alert-item--critical .alert-item__icon {
    background: rgba(var(--color-status-off-rgb), 0.18);
    color: var(--color-status-off);
}
.alert-item--warning .alert-item__icon {
    background: rgba(var(--color-status-warn-rgb), 0.18);
    color: var(--color-status-warn);
}
.alert-item--info .alert-item__icon {
    background: rgba(var(--color-primary-rgb), 0.18);
    color: var(--color-primary);
}
.alert-item__body { flex: 1; min-width: 0; }
.alert-item__title {
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    margin-bottom: 2px;
}
.alert-item__where {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    margin-bottom: var(--space-1);
}
.alert-item__time {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    font-variant-numeric: tabular-nums;
}
.alert-rail__empty {
    padding: var(--space-4);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.alert-item__device {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--state-hover-bg);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    max-width: 100%;
}

.alert-item__device-thumb {
    width: 18px;
    height: 18px;
    border-radius: var(--radius-sm);
    background: rgba(var(--color-primary-rgb), 0.16);
    color: var(--color-primary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: var(--type-caption);
}

.alert-item__device-id {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}

.alert-item__actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
}

.alert-item__action {
    appearance: none;
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    padding: var(--space-1) var(--space-2-5);
    border-radius: var(--radius-md);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    transition:
        background var(--duration-fast),
        color var(--duration-fast),
        border-color var(--duration-fast);
}

.alert-item__action:hover:not(:disabled) {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
}

.alert-item__action:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.alert-item__action--primary {
    background: rgba(var(--color-status-on-rgb), 0.16);
    border-color: rgba(var(--color-status-on-rgb), 0.45);
    color: var(--color-status-on);
}

.alert-item__action--primary:hover:not(:disabled) {
    background: rgba(var(--color-status-on-rgb), 0.24);
    color: var(--color-status-on);
    border-color: rgba(var(--color-status-on-rgb), 0.7);
}

.alert-item__ack-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    background: rgba(var(--color-status-on-rgb), 0.12);
    color: var(--color-status-on);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}

.alert-rail-enter-active,
.alert-rail-leave-active {
    transition:
        transform var(--duration-moderate) var(--ease-out-expo),
        opacity var(--duration-normal) var(--ease-out-expo);
    transform-origin: top left;
}
.alert-rail-enter-from,
.alert-rail-leave-to {
    opacity: 0;
    transform: translateY(-8px) scale(0.96);
}
</style>
