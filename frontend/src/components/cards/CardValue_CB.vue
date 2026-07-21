<template>
    <!-- ═══ 1×1: status (hero) + L values + toggle ═══ -->
    <CardShell
        v-if="size === '1x1'"
        type="cb"
        :name="entity.name"
        icon="fas fa-bolt-slash"
        size="1x1"
        :is-on="isOn"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="brk-info brk-info--1">
                <div class="brk-lock" :class="{ locked: isLocked }">
                    <i :class="isLocked ? 'fas fa-lock' : 'fas fa-lock-open'" />
                </div>
                <div class="brk-state" :class="[stateTone, stateWord.length > 8 && 'brk-state--long']">{{ stateWord }}</div>
                <div v-if="subLabel" class="brk-cause" :class="subToneClass">{{ subLabel }}</div>
                <div class="brk-ls">
                    <div v-for="p in phases" :key="p.label" class="brk-l">
                        <span class="brk-l-l">{{ p.label }}</span>
                        <span class="brk-l-v" :class="'v--' + p.state">{{ p.v }}<small>V</small></span>
                    </div>
                </div>
                <div class="brk-tgl">
                    <CardToggle :is-on="isOn" :disabled="!canToggle" @toggle="toggle" />
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ 2×1: info block + full-height SVG on the right ═══ -->
    <CardShell
        v-else-if="size === '2x1'"
        type="cb"
        :name="entity.name"
        icon="fas fa-bolt-slash"
        size="2x1"
        :is-on="isOn"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="brk-2x1">
                <div class="brk-lock" :class="{ locked: isLocked }">
                    <i :class="isLocked ? 'fas fa-lock' : 'fas fa-lock-open'" />
                </div>
                <div class="brk-svg-2x1" :class="{ 'brk-svg-2x1--single': phases.length === 1 }">
                    <div class="brk-glyph" aria-hidden="true">
                        <BreakerGlyph :on="isOn" :tripped="isTripped" :poles="phases.length" rail />
                    </div>
                </div>
                <div class="brk-info">
                    <div class="brk-state" :class="[stateTone, stateWord.length > 8 && 'brk-state--long']">{{ stateWord }}</div>
                    <div v-if="subLabel" class="brk-cause" :class="subToneClass">{{ subLabel }}</div>
                    <div class="brk-ls">
                        <div v-for="p in phases" :key="p.label" class="brk-l">
                            <span class="brk-l-l">{{ p.label }}</span>
                            <span class="brk-l-v" :class="'v--' + p.state">{{ p.v }}<small>V</small></span>
                        </div>
                    </div>
                    <div class="brk-tgl">
                        <CardToggle :is-on="isOn" :disabled="!canToggle" @toggle="toggle" />
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ 2×2: SVG left, info block right, stats footer below ═══ -->
    <CardShell
        v-else
        type="cb"
        :name="entity.name"
        icon="fas fa-bolt-slash"
        size="2x2"
        :is-on="isOn"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="brk-2x2">
                <!-- Lock in the card's top-left corner, like the 2×1. -->
                <div class="brk-lock brk-lock--corner2x2" :class="{ locked: isLocked }">
                    <i :class="isLocked ? 'fas fa-lock' : 'fas fa-lock-open'" />
                </div>
                <div class="brk-svg" :class="{ 'brk-svg--single': phases.length === 1 }">
                    <div class="brk-glyph" aria-hidden="true">
                        <BreakerGlyph :on="isOn" :tripped="isTripped" :poles="phases.length" rail />
                    </div>
                </div>
                <div class="brk-info">
                    <div class="brk-state brk-state--xl" :class="[stateTone, stateWord.length > 8 && 'brk-state--long']">{{ stateWord }}</div>
                    <div v-if="subLabel" class="brk-cause" :class="subToneClass">{{ subLabel }}</div>
                    <div class="brk-ls" :class="{ 'brk-ls--single': phases.length === 1 }">
                        <div v-for="p in phases" :key="p.label" class="brk-l">
                            <span class="brk-l-l">{{ p.label }}</span>
                            <span class="brk-l-v" :class="'v--' + p.state">{{ p.v }}<small>V</small></span>
                        </div>
                    </div>
                    <div class="brk-tgl">
                        <CardToggle :is-on="isOn" :disabled="!canToggle" @toggle="toggle" />
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #footer>
            <div class="ec-hero-info ec-hero-info--values">
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ tempDisplay }}</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v">{{ cyclesDisplay }}</div>
                </div>
                <div class="ec-hero-stat">
                    <div class="ec-hero-stat-v" :class="isLocked && 'brk-fault'">{{ lockShort }}</div>
                </div>
            </div>
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import BreakerGlyph from '@/components/cards/BreakerGlyph.vue';
import CardToggle from '@/components/cards/CardToggle.vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {formatVoltage} from '@/helpers/powerMetrics';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import type {entity_t} from '@/types';
import CardBadges from './CardBadges.vue';
import CardShell from './CardShell.vue';

const props = withDefaults(
    defineProps<{
        entity: entity_t;
        size: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {editMode: false}
);

defineEmits<{
    'open-detail': [];
    delete: [];
    'cycle-size': [];
}>();

const deviceStore = useDevicesStore();
const authStore = useAuthStore();
const rpc = useCardRpc();

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);

const status = computed(
    () =>
        deviceStore.statusOf(
            props.entity.source,
            `cb:${props.entity.properties.id}`
        ) ?? null
);

const isOn = computed(() => !!status.value?.output);
// `safety` (device flag) is the safety LOCK. When locked the breaker cannot be
// operated remotely, so the button is disabled. Locking is NOT a trip.
const isLocked = computed(() => !!status.value?.safety);
const canToggle = computed(
    () => canExecute.value && !isOffline.value && !isLocked.value
);

// The Pro CB measures voltage only (no current), so the only trips it can
// report are the voltage ones, via `source`. A short-circuit / overcurrent
// trip is indistinguishable from a manual off — we never guess it. Locking is
// a separate state and is never shown as a trip.
const VOLTAGE_TRIP_SOURCES = new Set(['overvoltage', 'undervoltage']);
const isTripped = computed(
    () =>
        !isOn.value &&
        VOLTAGE_TRIP_SOURCES.has(String(status.value?.source ?? ''))
);

const stateWord = computed(() => {
    if (isTripped.value) return 'Tripped';
    if (isOn.value) return 'On';
    // An off with source "local" is the case the device can't classify — make
    // that ambiguity the headline itself, in the device's own honest wording.
    if (!isLocked.value && String(status.value?.source ?? '') === 'local')
        return 'Tripped or manually off';
    return 'Off';
});
const stateTone = computed(() =>
    isTripped.value ? 'is-fault' : isOn.value ? 'is-on' : 'is-off'
);
// Cause from `source` — this firmware reports the voltage trip there.
const tripCause = computed(() => {
    const src = String(status.value?.source ?? '');
    if (src === 'overvoltage') return 'Overvoltage';
    if (src === 'undervoltage') return 'Undervoltage';
    return 'Protection';
});
// Sub-label under the status: trip cause when tripped, "Locked" when the safety
// lock is on, otherwise the device's honest wording for a local off it can't
// classify (manual flip vs breaker trip look identical without current sensing).
const subLabel = computed(() => {
    if (isTripped.value) return tripCause.value;
    if (isLocked.value) return 'Locked';
    return '';
});
// A real voltage trip (limits we set) is the loud red state; the lock pulses
// amber; the ambiguous local off stays quiet.
const subToneClass = computed(() => {
    if (isTripped.value) return 'brk-cause--trip';
    if (isLocked.value) return 'brk-cause--lock';
    return 'brk-cause--muted';
});

// The breaker's own protection thresholds, surfaced onto the entity by the
// backend composer. Used to flag each pole voltage against its trip limits.
const limits = computed(() => {
    const p = props.entity.properties as {
        undervoltageLimit?: number;
        voltageLimit?: number;
        voltageThr?: number;
    };
    return {
        under: p.undervoltageLimit,
        over: p.voltageLimit,
        thr: p.voltageThr ?? 5
    };
});
function voltageState(raw: number | undefined): 'ok' | 'near' | 'bad' {
    const {under, over, thr} = limits.value;
    if (raw == null || under == null || over == null) return 'ok';
    if (raw >= over || raw <= under) return 'bad';
    if (raw >= over - thr || raw <= under + thr) return 'near';
    return 'ok';
}

// Pole count comes from the backend entity (fixed from the full device); the
// card never derives structure from streaming live status.
const poleCount = computed(
    () => (props.entity.properties as {poles?: number}).poles ?? 1
);
// One entry per pole (L1..Ln); voltage fills in from live status as each
// voltmeter reports.
const phases = computed(() => {
    const st = device.value?.status ?? {};
    return Array.from({length: poleCount.value}, (_, i) => {
        const raw = (st[`voltmeter:${i}`] as {voltage?: number})?.voltage;
        return {
            label: `L${i + 1}`,
            v: formatVoltage(raw).value,
            state: voltageState(raw)
        };
    });
});
const tempDisplay = computed(() => {
    const t = status.value?.temperature?.tC;
    return typeof t === 'number' ? `${t.toFixed(1)}°C` : '—';
});
const cyclesDisplay = computed(() => {
    const c = status.value?.total_cycles;
    return typeof c === 'number' ? `${c} cyc` : '—';
});
const lockShort = computed(() => (isLocked.value ? 'Locked' : 'OK'));

function toggle() {
    if (!canToggle.value) return;
    rpc.invokeAction(props.entity.id, 'setOutput', {on: !isOn.value});
}
</script>

<style scoped>
/* Shared info block: status (hero) → L values → toggle */
.brk-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: var(--space-2);
    min-width: 0;
}
.brk-info--1 {
    position: relative;
    width: 100%;
    height: 100%;
}
/* The toggle (.ec-switch) is width:100% capped at 180px — it needs a full-width
   flex parent to resolve against, or it collapses. This mirrors .ec-btn-zone. */
.brk-tgl {
    display: flex;
    justify-content: center;
    width: 100%;
}
.brk-info--1 .brk-tgl {
    margin-top: var(--space-2);
}

/* Status is the hero — clearly larger than the L values. */
.brk-state {
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    line-height: 1.05;
}
.brk-state--xl {
    font-size: var(--type-heading);
    font-weight: var(--font-bold);
}
/* Long headline (the ambiguous "Tripped or manually off") — shrink to fit and
   wrap cleanly instead of blowing up the layout. */
.brk-state--long {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    line-height: 1.15;
    text-wrap: balance;
}
.brk-state--xl.brk-state--long {
    font-size: var(--type-subheading);
}
.brk-state.is-on {
    color: var(--color-status-on, var(--color-success-text));
}
.brk-state.is-off {
    color: var(--color-text-secondary);
}
.brk-state.is-fault {
    color: var(--color-status-off, var(--color-danger-text));
}
/* Trip cause — sits just under the status, only while latched off. */
.brk-cause {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-status-off, var(--color-danger-text));
    margin-top: calc(-1 * var(--space-1));
}
/* Voltage trip (limits we set) — loud red, glowing pulse. */
.brk-cause--trip {
    color: var(--color-status-off, var(--color-danger-text));
    text-shadow: 0 0 8px
        color-mix(in srgb, var(--color-status-off, #c0293d) 65%, transparent);
    animation: brk-pulse 1.3s ease-in-out infinite;
}
/* Safety lock on — amber, gentler pulse. */
.brk-cause--lock {
    color: var(--color-warning-text);
    animation: brk-pulse 1.9s ease-in-out infinite;
}
/* Ambiguous local-off (manual or trip) — neutral, no pulse. */
.brk-cause--muted {
    color: var(--color-text-tertiary);
    font-weight: var(--font-medium);
}
@keyframes brk-pulse {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0.4;
    }
}
@media (prefers-reduced-motion: reduce) {
    .brk-cause--trip,
    .brk-cause--lock {
        animation: none;
    }
}

/* L values — secondary, small; the three poles sit in one horizontal row. */
.brk-ls {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-start;
    gap: var(--space-3);
}
.brk-l {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
}
.brk-l-l {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    letter-spacing: 0.04em;
}
.brk-l-v {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    line-height: 1;
}
.brk-l-v small {
    color: var(--color-text-tertiary);
    font-weight: 400;
    margin-left: 1px;
}
/* Pole voltage against the breaker's own trip limits: amber near, red beyond. */
.brk-l-v.v--near,
.brk-l-v.v--near small {
    color: var(--color-warning-text);
}
.brk-l-v.v--bad,
.brk-l-v.v--bad small {
    color: var(--color-status-off, var(--color-danger-text));
}
/* 2×2 has the room — stack the poles vertically and size them up a touch. */
.brk-2x2 .brk-ls {
    flex-direction: column;
    gap: var(--space-2);
}
.brk-2x2 .brk-l-v {
    font-size: var(--type-body);
}
/* A single pole has the room to breathe — size it up (still under the status). */
.brk-2x2 .brk-ls--single .brk-l-l {
    font-size: var(--type-body);
}
.brk-2x2 .brk-ls--single .brk-l-v {
    font-size: var(--type-subheading);
}

/* 2×1 — info left, SVG fills the right */
.brk-2x1 {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    height: 100%;
    padding: 0 var(--space-3);
}
.brk-2x1 .brk-info {
    flex: 1;
}
.brk-svg-2x1 {
    flex: 0 0 auto;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
}
.brk-svg-2x1 .brk-glyph {
    height: 138px;
}
/* A single-pole module is narrow — let its column grow to a full half so the
   glyph centers between the lock and the switch instead of hugging the edge. */
.brk-svg-2x1--single {
    flex: 1;
}

/* 2×2 — big SVG left, info right. The module and the info column share one
   fixed height, both centered, with the status pinned to the top and the switch
   to the bottom — so module-top lines up with the status and module-bottom with
   the switch, without stretching to fill the whole card. */
.brk-2x2 {
    --brk-module-h: 240px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    width: 100%;
    height: 100%;
    padding: 0 var(--space-4);
}
.brk-svg {
    flex: 0 0 auto;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Nudge the module off the left edge toward the info block. */
    margin-left: var(--space-4);
}
.brk-svg .brk-glyph {
    height: var(--brk-module-h);
}
/* A single-pole module is narrow — the 2×2 has room, so push it further right. */
.brk-svg--single {
    margin-left: var(--space-8);
}
.brk-glyph {
    display: flex;
    min-height: 0;
}
/* Physical safety lock, pinned to the module's top-left corner. Green open,
   red closed. */
.brk-lock {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 2;
    font-size: var(--type-body);
    line-height: 1;
    color: var(--color-status-on, #22c08e);
}
.brk-lock.locked {
    color: var(--color-status-off, #c0293d);
}
/* Every size + pole count pins the lock to the exact same spot: 10px from the
   card's top-left corner. The 1×1/2×1 value zone (.ec-val) is padded, so we
   subtract that padding; the 2×2 hero body has none. calc keeps it exact at
   any root font size. */
.brk-info--1 > .brk-lock,
.brk-2x1 > .brk-lock {
    top: calc(10px - var(--space-3));
    left: calc(10px - var(--space-4));
}
.brk-lock--corner2x2 {
    top: 10px;
    left: 10px;
}
.brk-2x2 .brk-info {
    flex: 1;
    justify-content: space-between;
    gap: var(--space-3);
    align-self: center;
    height: var(--brk-module-h);
}

.brk-fault {
    -webkit-text-fill-color: var(--color-status-off, #c0293d);
    color: var(--color-status-off, #c0293d);
}
</style>
