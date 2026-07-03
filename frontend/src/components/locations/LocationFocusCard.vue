<template>
    <article
        ref="cardEl"
        class="lfc"
        :class="{'lfc--visible': visible}"
        :style="{left: `${position.left}px`, top: `${position.top}px`}"
        role="dialog"
        :aria-label="`Site details for ${site.name}`"
        :aria-modal="visible"
        @keydown="onKeydown"
    >
        <header class="lfc__hero">
            <div class="lfc__hero-row">
                <span
                    class="lfc__pip"
                    :class="`lfc__pip--${site.status}`"
                    aria-hidden="true"
                />
                <span class="sr-only">{{ statusSrText }}</span>
                <span class="lfc__site-name">{{ site.name }}</span>
                <button
                    ref="closeBtn"
                    type="button"
                    class="lfc__icon-btn"
                    data-testid="fc-close"
                    aria-label="Close site card"
                    @click="emit('close')"
                >
                    <CloseIcon />
                </button>
            </div>
            <p class="lfc__subtitle">
                {{ site.city }} · {{ site.lat }}°, {{ site.lng }}°
                <span
                    v-if="showFallbackBadge"
                    class="lfc__live-badge"
                    :class="`lfc__live-badge--${effectiveFallback}`"
                    :title="liveFallbackTitle"
                >
                    {{ liveFallbackLabel }}
                </span>
            </p>
        </header>

        <div
            class="lfc__kpis"
            aria-live="polite"
            aria-atomic="true"
        >
            <LocationFocusCardKpiTile
                label="Devices"
                :value="kpis.total"
                tone="neutral"
            />
            <LocationFocusCardKpiTile
                label="Load"
                :value="kpis.powerKW"
                suffix="kW"
                :decimals="1"
                tone="neutral"
            />
            <LocationFocusCardKpiTile
                label="Today"
                :value="kpis.todayKWh ?? '—'"
                :suffix="kpis.todayKWh != null ? 'kWh' : undefined"
                :decimals="1"
                tone="neutral"
            />
            <LocationFocusCardKpiTile
                label="Alerts"
                :value="kpis.alerts ?? '—'"
                :tone="alertsTone"
            />
            <LocationFocusCardKpiTile
                label="Last seen"
                :value="lastSeenLabel"
                :tone="lastSeenTone"
            />
            <LocationFocusCardKpiTile
                label="Savings"
                :value="kpis.savingsPotentialPct"
                suffix="%"
                :tone="kpis.savingsPotentialPct > 0 ? 'on' : 'neutral'"
            />
            <LocationFocusCardKpiTile
                label="Firmware"
                :value="kpis.firmwareHealthPct"
                suffix="%"
                :tone="kpis.firmwareHealthPct < 80 ? 'alert' : 'on'"
            />
            <LocationFocusCardKpiTile
                label="Signal"
                :value="kpis.signalHealthPct"
                suffix="%"
                :tone="kpis.signalHealthPct < 80 ? 'alert' : 'on'"
            />
        </div>

        <LocationFocusCardStatusBar
            :total="kpis.total"
            :on="kpis.on"
            :warn="kpis.warn"
            :off="kpis.off"
        />

        <footer class="lfc__actions">
            <button
                type="button"
                class="lfc__btn lfc__btn--primary"
                data-testid="fc-open-site"
                @click="emit('openSite')"
            >
                Open site
            </button>
            <button
                type="button"
                class="lfc__btn"
                data-testid="fc-floor-plan"
                @click="emit('openFloorPlan')"
            >
                Floor plan
            </button>
            <button
                v-if="snoozeAvailable"
                type="button"
                class="lfc__btn"
                data-testid="fc-snooze"
                :disabled="snoozePending"
                @click="emit('snooze')"
            >
                Snooze alerts
            </button>
        </footer>
    </article>
</template>

<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue';
import type {KpiTone} from '@/components/locations/LocationFocusCardKpiTile.vue';
import {useStaleness} from '@/composables/useStaleness';
import {formatRelativeTime} from '@/helpers/relativeTime';
import type {
    FocusCardPosition,
    LiveFallback,
    LocationKpiSnapshot
} from '@/types/focusCard';
import CloseIcon from './icons/CloseIcon.vue';
import LocationFocusCardKpiTile from './LocationFocusCardKpiTile.vue';
import LocationFocusCardStatusBar from './LocationFocusCardStatusBar.vue';

type SiteStatus = 'on' | 'warn' | 'off';

const props = defineProps<{
    visible: boolean;
    site: {
        id: number;
        name: string;
        city: string;
        lat: number;
        lng: number;
        status: SiteStatus;
    };
    kpis: LocationKpiSnapshot;
    position: FocusCardPosition;
    snoozePending?: boolean;
    /** True when the host has wired a real snooze RPC. When false the
     *  Snooze button is omitted entirely — better than rendering a button
     *  that always fails or always lies. */
    snoozeAvailable?: boolean;
    liveFallback?: LiveFallback;
}>();

const emit = defineEmits<{
    openSite: [];
    openFloorPlan: [];
    snooze: [];
    close: [];
}>();

const cardEl = ref<HTMLElement | null>(null);
const closeBtn = ref<HTMLButtonElement | null>(null);

const UNAVAILABLE = '—';

const STATUS_LABELS: Record<SiteStatus, string> = {
    on: 'Online',
    warn: 'Warning',
    off: 'Offline'
};

const FALLBACK_LABELS: Record<LiveFallback, string> = {
    live: '',
    snapshot: 'Live updates unavailable',
    forbidden: 'No access',
    unwired: 'Live stream not configured'
};

const FALLBACK_TITLES: Record<LiveFallback, string> = {
    live: '',
    snapshot:
        'Real-time updates are not available right now. KPIs reflect the latest snapshot.',
    forbidden:
        'You do not have permission to receive live updates for this location.',
    unwired:
        'The backend live-KPI topic is not yet wired in this environment. KPIs reflect the latest snapshot.'
};

const statusSrText = computed(() => STATUS_LABELS[props.site.status]);
const lastSeenLabel = computed(() => formatRelativeTime(props.kpis.lastSeenTs));

// 30s = typical KPI refresh cadence → warn at 60s, stale at 2.5min.
const LAST_SEEN_EXPECTED_MS = 30_000;
const TONE_BY_LEVEL: Record<'fresh' | 'warn' | 'stale', KpiTone> = {
    fresh: 'neutral',
    warn: 'warn',
    stale: 'critical'
};
const lastSeenStamp = computed(() => props.kpis.lastSeenTs);
const lastSeenStaleness = useStaleness(lastSeenStamp, {
    expectedIntervalMs: LAST_SEEN_EXPECTED_MS
});
const lastSeenTone = computed<KpiTone>(
    () => TONE_BY_LEVEL[lastSeenStaleness.value?.level ?? 'fresh']
);

const effectiveFallback = computed<LiveFallback>(
    () => props.liveFallback ?? 'snapshot'
);
// 'unwired' = backend topic not deployed yet (env config, not user-actionable).
// Hide the badge for that state; surface only states the user can act on.
const showFallbackBadge = computed(
    () =>
        effectiveFallback.value !== 'live' &&
        effectiveFallback.value !== 'unwired'
);
const liveFallbackLabel = computed(
    () => FALLBACK_LABELS[effectiveFallback.value]
);
const liveFallbackTitle = computed(
    () => FALLBACK_TITLES[effectiveFallback.value]
);

const todayKWhLabel = computed(() =>
    props.kpis.todayKWh == null ? UNAVAILABLE : `${props.kpis.todayKWh} kWh`
);
const alertsLabel = computed<string | number>(() =>
    props.kpis.alerts == null ? UNAVAILABLE : props.kpis.alerts
);
const alertsTone = computed<'alert' | 'on' | 'neutral'>(() => {
    if (props.kpis.alerts == null) return 'neutral';
    return props.kpis.alerts > 0 ? 'alert' : 'on';
});

// Move focus into the card on open; restore previous focus on close.
// On mount, push focus into the card so keyboard users land here.
// Outgoing focus restoration is owned by useLocationFocusCard.closeFocusCard,
// because the host renders this component with v-if and unmounts it on close.
watch(
    () => props.visible,
    async (nowVisible) => {
        if (!nowVisible) return;
        await nextTick();
        closeBtn.value?.focus();
    },
    {immediate: true}
);

function focusableElements(): HTMLElement[] {
    if (!cardEl.value) return [];
    return Array.from(
        cardEl.value.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
    );
}

function wrapTabFocus(event: KeyboardEvent, els: HTMLElement[]): void {
    const first = els[0];
    const last = els[els.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'Tab') return;
    const els = focusableElements();
    if (els.length === 0) return;
    wrapTabFocus(ev, els);
}
</script>

<style scoped>
.lfc {
    position: absolute;
    z-index: 200;
    width: 460px;
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-xl);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    box-shadow: var(--shadow-xl);
    opacity: 0;
    pointer-events: none;
    transform: translateY(4px) scale(0.98);
    transition:
        opacity 0.18s ease,
        transform 0.18s ease;
}

.lfc--visible {
    opacity: 1;
    pointer-events: auto;
    transform: none;
}

/* ---- Hero ---- */
.lfc__hero-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.lfc__pip {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    animation: lfc-pip-breathe 2.4s ease-in-out infinite;
}

.lfc__pip--on {
    background: var(--color-status-on);
    box-shadow: 0 0 0 0 rgba(var(--color-status-on-rgb), 0.6);
}

.lfc__pip--warn {
    background: var(--color-status-warn);
    box-shadow: 0 0 0 0 rgba(var(--color-status-warn-rgb), 0.6);
}

.lfc__pip--off {
    background: var(--color-status-off);
    box-shadow: 0 0 0 0 rgba(var(--color-status-off-rgb), 0.6);
}

@keyframes lfc-pip-breathe {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 currentColor; }
    50% { transform: scale(1.15); box-shadow: 0 0 0 5px transparent; }
}
@media (prefers-reduced-motion: reduce) {
    .lfc__pip { animation: none; }
}

.lfc__site-name {
    flex: 1;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.lfc__icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    border: none;
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease;
    position: relative;
}

.lfc__icon-btn::after {
    content: "";
    position: absolute;
    inset: -8px;
}

.lfc__icon-btn:hover {
    background: var(--state-hover-bg-strong);
    color: var(--color-text-primary);
}

.lfc__icon-btn:focus-visible {
    outline: 2px solid var(--color-border-focus);
    outline-offset: 2px;
}

.lfc__subtitle {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

/* ---- KPI grid ---- */
.lfc__kpis {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-2);
}

/* ---- Actions footer ---- */
.lfc__actions {
    display: flex;
    gap: var(--space-2);
}

.lfc__btn {
    flex: 1;
    height: var(--btn-h-md);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-medium);
    background: var(--state-hover-bg);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    white-space: nowrap;
    padding: 0 var(--space-2);
}

.lfc__btn:hover {
    background: var(--state-hover-bg-strong);
    color: var(--color-text-primary);
}

.lfc__btn:focus-visible {
    outline: 2px solid var(--color-border-focus);
    outline-offset: 2px;
}

.lfc__btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.lfc__btn--primary {
    background: var(--color-primary);
    border-color: transparent;
    color: var(--color-text-primary);
}

.lfc__btn--primary:hover {
    background: var(--color-primary-hover);
    color: var(--color-text-primary);
}

/* Screen-reader-only utility */
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

/* ---- Liveness badge ---- */
.lfc__live-badge {
    display: inline-block;
    margin-left: var(--space-2);
    padding: var(--space-1) var(--space-2);
    font-size: var(--type-caption);
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-medium);
    background: var(--state-hover-bg);
    vertical-align: middle;
    white-space: nowrap;
}

.lfc__live-badge--snapshot,
.lfc__live-badge--unwired {
    color: var(--color-text-tertiary);
}

.lfc__live-badge--forbidden {
    color: var(--color-status-off);
    border-color: rgba(var(--color-status-off-rgb), 0.35);
    background: rgba(var(--color-status-off-rgb), 0.08);
}
</style>
