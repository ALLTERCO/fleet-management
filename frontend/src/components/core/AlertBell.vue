<template>
    <MenuPopover align="right" class="alert-bell" panel-class="ab-pop">
        <template #trigger="{toggle}">
            <button
                type="button"
                class="ab-btn"
                :aria-label="bellLabel"
                :title="bellLabel"
                @click="onToggle(toggle)"
            >
                <i class="fa-regular fa-bell" aria-hidden="true" />
                <span v-if="alertOpenCount > 0" class="ab-badge" aria-hidden="true">
                    {{ badgeText }}
                </span>
            </button>
        </template>

        <template #default="{close}">
            <div class="ab-head">
                <strong>Alerts</strong>
                <span v-if="alertOpenCount > 0">{{ alertOpenCount }} active</span>
            </div>
            <div v-if="loading && !recentAlerts.length" class="ab-empty">
                Loading…
            </div>
            <div v-else-if="!recentAlerts.length" class="ab-empty">
                <i class="fa-regular fa-bell-slash" aria-hidden="true" />
                No active alerts.
            </div>
            <div
                v-if="recentAlerts.length"
                class="ab-list"
                role="list"
                @keydown.down.prevent="moveFocus($event, 1)"
                @keydown.up.prevent="moveFocus($event, -1)"
            >
                <div
                    v-for="alert in recentAlerts"
                    :key="alert.id"
                    class="ab-item"
                    role="listitem"
                >
                    <button
                        type="button"
                        class="ab-item__open"
                        :data-severity="alert.severity"
                        @click="openInstance(alert.id, close)"
                    >
                        <span class="ab-item__dot" aria-hidden="true" />
                        <span class="ab-item__copy">
                            <strong>{{ alert.title }}</strong>
                            <span>{{ formatRelative(alert.lastTriggeredAt) }}</span>
                        </span>
                    </button>
                    <button
                        v-if="!alert.acknowledgedAt"
                        type="button"
                        class="ab-item__action"
                        :class="{'ab-item__action--busy': acknowledging === alert.id}"
                        :disabled="acknowledging === alert.id"
                        title="Acknowledge"
                        aria-label="Acknowledge"
                        @click.stop="acknowledge(alert.id)"
                    >
                        <i class="fa-solid fa-check" aria-hidden="true" />
                    </button>
                </div>
            </div>
            <div class="ab-foot">
                <span v-if="alertOpenCount > recentAlerts.length" class="ab-foot__more">
                    +{{ alertOpenCount - recentAlerts.length }} more
                </span>
                <Button type="blue" size="sm" @click="viewAll(close)">
                    View all alerts
                </Button>
            </div>
        </template>
    </MenuPopover>

    <AlertInstanceModal v-model="detailVisible" :instance-id="detailId" />
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {computed, ref} from 'vue';
import {useRouter} from 'vue-router';
import AlertInstanceModal from '@/components/modals/AlertInstanceModal.vue';
import {ALERTS_PATH} from '@/constants';
import {formatRelative} from '@/helpers/format';
import {useAlertsStore} from '@/stores/alerts';
import {useAuthStore} from '@/stores/auth';
import Button from './Button.vue';
import MenuPopover from './MenuPopover.vue';

const MAX_RECENT = 5;

const router = useRouter();
const authStore = useAuthStore();
const alertsStore = useAlertsStore();
const {alertOpenCount} = storeToRefs(authStore);

const loading = ref(false);
const acknowledging = ref<number | null>(null);
const detailVisible = ref(false);
const detailId = ref<number | null>(null);

const bellLabel = computed(() =>
    alertOpenCount.value > 0
        ? `Alerts — ${alertOpenCount.value} active`
        : 'Alerts'
);
const badgeText = computed(() =>
    alertOpenCount.value > 9 ? '9+' : String(alertOpenCount.value)
);

const recentAlerts = computed(() =>
    Object.values(alertsStore.instances)
        .filter((instance) => instance.state === 'active')
        .sort(
            (a, b) =>
                new Date(b.lastTriggeredAt).getTime() -
                new Date(a.lastTriggeredAt).getTime()
        )
        .slice(0, MAX_RECENT)
);

// Fresh list every time the popover opens — the store stays live over WS
// afterwards, so this is a cheap safety refresh, not polling.
function onToggle(toggle: () => void): void {
    toggle();
    loading.value = true;
    void alertsStore
        .fetchInstances({state: 'active'})
        .finally(() => {
            loading.value = false;
        });
}

function openInstance(id: number, close: () => void): void {
    close();
    detailId.value = id;
    detailVisible.value = true;
}

// Glance list: acknowledge in place, everything heavier lives in the detail.
async function acknowledge(id: number): Promise<void> {
    acknowledging.value = id;
    try {
        await alertsStore.ackInstance(id);
    } finally {
        acknowledging.value = null;
    }
}

// Arrow keys walk the rows; Enter on a row opens it (native button).
function moveFocus(event: KeyboardEvent, step: 1 | -1): void {
    const list = event.currentTarget as HTMLElement;
    const rows = [...list.querySelectorAll<HTMLElement>('.ab-item__open')];
    const index = rows.findIndex((row) => row.contains(document.activeElement));
    const next = rows[(index + step + rows.length) % rows.length];
    next?.focus();
}

function viewAll(close: () => void): void {
    close();
    if (router.currentRoute.value.path !== ALERTS_PATH) {
        void router.push(ALERTS_PATH);
    }
}
</script>

<style scoped>
.alert-bell {
    flex-shrink: 0;
}

/* Same footprint and ring language as the avatar next to it — a glass
   circle with only the ring visible, no solid fill. */
.ab-btn {
    position: relative;
    display: grid;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    place-items: center;
    border: 2px solid var(--glass-border);
    border-radius: var(--radius-full);
    background: var(--glass-1-bg);
    backdrop-filter: var(--glass-1-filter);
    box-shadow: var(--glass-shadow);
    color: var(--color-text-secondary);
    /* One step up — a 20px glyph reads smaller than the full-bleed avatar. */
    font-size: var(--icon-size-lg);
    cursor: pointer;
    transition:
        border-color var(--motion-hover),
        color var(--motion-hover),
        transform var(--motion-hover);
}

.ab-btn i {
    transform: translateY(var(--icon-optical-offset));
}

.ab-btn:hover {
    border-color: var(--color-primary);
    color: var(--color-text-primary);
    transform: translateY(var(--hover-lift));
}

.ab-btn:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.ab-btn:active {
    transform: scale(0.96);
}

.ab-btn:disabled {
    opacity: 0.5;
    cursor: default;
}

.ab-badge {
    position: absolute;
    top: calc(-1 * var(--space-1));
    right: calc(-1 * var(--space-1));
    display: grid;
    min-width: 1.15rem;
    height: 1.15rem;
    padding: 0 var(--space-1);
    place-items: center;
    border-radius: var(--radius-full);
    background: var(--color-alert-critical-border);
    /* Ring separates the badge from whatever it overlaps. */
    box-shadow: 0 0 0 var(--focus-ring-width) var(--color-surface-0);
    color: var(--color-text-on-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    line-height: 1;
}

.ab-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--divider-hairline);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}

.ab-head span {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.ab-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--gap-sm);
    padding: var(--space-6) var(--space-4);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

/* One row: a severity dot, the title, the age, and one quiet action. */
.ab-item {
    display: flex;
    align-items: stretch;
    min-width: 26rem;
    border-bottom: 1px solid var(--divider-hairline);
}

.ab-item__open {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: var(--touch-target-min);
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--space-2) var(--space-4);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--motion-hover);
}

.ab-item__open:hover {
    background: var(--state-hover-bg);
}

.ab-item__open:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: calc(-1 * var(--focus-ring-width));
}

.ab-item__open:active {
    background: var(--state-hover-bg-strong);
}

.ab-item__dot {
    flex: none;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-alert-info-border);
}

.ab-item__open[data-severity='critical'] .ab-item__dot {
    background: var(--color-alert-critical-border);
}

.ab-item__open[data-severity='warning'] .ab-item__dot {
    background: var(--color-alert-warning-border);
}

.ab-item__copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: var(--space-0-5);
}

.ab-item__copy strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.ab-item__copy span {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.ab-item__action {
    display: grid;
    flex: none;
    width: var(--touch-target-min);
    place-items: center;
    margin-right: var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: background-color var(--motion-hover), color var(--motion-hover);
}

.ab-item__action i {
    transform: translateY(var(--icon-optical-offset));
}

.ab-item__action:hover {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
}

.ab-item__action:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: calc(-1 * var(--focus-ring-width));
}

.ab-item__action:active {
    background: var(--state-hover-bg-strong);
}

.ab-item__action:disabled,
.ab-item__action--busy {
    opacity: 0.5;
    cursor: default;
}

.ab-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--space-3) var(--space-4);
}

.ab-foot__more {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
</style>

<style>
/* Teleported panel: base glass + corners come from FloatingPanel; the
   bell menu asks for room and grows out of the bell it came from. */
.floating-panel.ab-pop {
    min-width: 26rem;
    border-radius: var(--radius-xl);
    transform-origin: top right;
}

.floating-panel.ab-pop.floating-panel-fade-enter-active {
    transition: opacity var(--motion-state), transform var(--motion-morph);
}

.floating-panel.ab-pop.floating-panel-fade-enter-from {
    transform: scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
    .floating-panel.ab-pop.floating-panel-fade-enter-from {
        transform: none;
    }
}
</style>
