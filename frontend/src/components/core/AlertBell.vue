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
            <button
                v-for="alert in recentAlerts"
                :key="alert.id"
                type="button"
                class="ab-item"
                :data-severity="alert.severity"
                @click="openInstance(alert.id, close)"
            >
                <AlertSeverityBadge :severity="alert.severity" />
                <span class="ab-item__copy">
                    <strong>{{ alert.title }}</strong>
                    <span>{{ formatRelative(alert.lastTriggeredAt) }}</span>
                </span>
                <span class="ab-item__actions">
                    <Button
                        type="blue-hollow"
                        size="xs"
                        title="Open alert"
                        aria-label="Open alert"
                        @click.stop="openInstance(alert.id, close)"
                    >
                        <i class="fas fa-arrow-up-right-from-square" aria-hidden="true" />
                    </Button>
                    <Button
                        type="green"
                        size="xs"
                        :loading="resolving === alert.id"
                        @click.stop="resolveAlert(alert.id)"
                    >
                        Resolve
                    </Button>
                </span>
            </button>
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
import AlertSeverityBadge from './AlertSeverityBadge.vue';
import Button from './Button.vue';
import MenuPopover from './MenuPopover.vue';

const MAX_RECENT = 5;

const router = useRouter();
const authStore = useAuthStore();
const alertsStore = useAlertsStore();
const {alertOpenCount} = storeToRefs(authStore);

const loading = ref(false);
const resolving = ref<number | null>(null);
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

async function resolveAlert(id: number): Promise<void> {
    resolving.value = id;
    try {
        await alertsStore.resolveInstance(id);
    } finally {
        resolving.value = null;
    }
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
    width: var(--space-10);
    height: var(--space-10);
    place-items: center;
    border: 2px solid var(--glass-border);
    border-radius: var(--radius-full);
    background: var(--glass-1-bg);
    backdrop-filter: var(--glass-1-filter);
    -webkit-backdrop-filter: var(--glass-1-filter);
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

.ab-btn:hover {
    border-color: var(--color-primary);
    color: var(--color-text-primary);
    transform: translateY(var(--hover-lift));
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
    background: var(--color-status-off);
    /* Ring separates the badge from whatever it overlaps. */
    box-shadow: 0 0 0 2px var(--color-surface-0);
    color: var(--color-text-on-primary);
    font-size: 0.7rem;
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

/* Severity stripe on the left edge keeps the row scannable at a glance. */
.ab-item {
    position: relative;
    display: flex;
    width: 100%;
    min-width: 26rem;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--divider-hairline);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--motion-hover);
}

.ab-item::before {
    content: '';
    position: absolute;
    left: 0;
    top: var(--space-2);
    bottom: var(--space-2);
    width: 3px;
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
    background: var(--color-border-medium);
}

.ab-item[data-severity='critical']::before {
    background: var(--color-status-off);
}

.ab-item[data-severity='warning']::before {
    background: var(--color-status-warn);
}

.ab-item:hover {
    background: var(--state-hover-bg);
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

.ab-item__actions {
    display: flex;
    flex: none;
    gap: var(--space-2);
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
   bell menu only asks for room. */
.floating-panel.ab-pop {
    min-width: 26rem;
    border-radius: var(--radius-xl);
}
</style>
