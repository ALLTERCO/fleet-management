<template>
    <!-- One European DIN MCB (Schneider Acti9 / Legrand DX³ anatomy), drawn tall
         like the real part: screw-terminal cages top + bottom, a toggle housing
         with a long-throw orange handle, an indicator window under it. The box
         wraps the body exactly (no internal padding) so it can be positioned
         precisely. A multi-pole is one wider body with a terminal set per pole
         under a single ganged handle — never separate modules. -->
    <svg
        class="brk"
        :class="stateClass"
        :viewBox="`0 0 ${vbW} 108`"
        role="img"
        :aria-label="label"
        preserveAspectRatio="xMidYMid meet"
    >
        <rect v-if="rail" class="brk-rail" x="0" y="48" :width="vbW" height="13" rx="2" />

        <!-- one continuous casing, filling the full box height -->
        <rect class="brk-body" x="4" y="0" :width="bodyW" height="108" rx="4" />

        <!-- terminal cages: one screw set per pole, top + bottom -->
        <g v-for="(tx, i) in poleCenters" :key="i">
            <rect class="brk-cage" :x="tx - 6.5" y="3" width="13" height="12" rx="1.5" />
            <circle class="brk-screw" :cx="tx" cy="9" r="2.6" />
            <line class="brk-slot" :x1="tx - 1.6" y1="9" :x2="tx + 1.6" y2="9" />
            <rect class="brk-cage" :x="tx - 6.5" y="93" width="13" height="12" rx="1.5" />
            <circle class="brk-screw" :cx="tx" cy="99" r="2.6" />
            <line class="brk-slot" :x1="tx - 1.6" y1="99" :x2="tx + 1.6" y2="99" />
        </g>

        <!-- pole divisions on a ganged breaker -->
        <line
            v-for="(dx, i) in dividers"
            :key="`d${i}`"
            class="brk-divider"
            :x1="dx"
            y1="20"
            :x2="dx"
            y2="88"
        />

        <!-- raised toggle housing + long-throw handle -->
        <rect class="brk-housing" :x="pad + 0.5" y="24" :width="bodyW - 1" height="42" rx="3" />
        <rect class="brk-slot-well" :x="pad + 4" y="26" :width="bodyW - 8" height="38" rx="2" />
        <g class="brk-lever">
            <rect class="brk-paddle" :x="pad + 3" y="28" :width="bodyW - 6" height="14" rx="2.5" />
            <rect class="brk-gloss" :x="pad + 3" y="28" :width="bodyW - 6" height="4.5" rx="2.5" />
            <line class="brk-grip" :x1="cx - 5" y1="33" :x2="cx + 5" y2="33" />
            <line class="brk-grip" :x1="cx - 5" y1="36" :x2="cx + 5" y2="36" />
            <line class="brk-grip" :x1="cx - 5" y1="39" :x2="cx + 5" y2="39" />
        </g>

        <!-- indicator window: red = live, green = off -->
        <rect class="brk-led" :x="cx - 8" y="72" width="16" height="9" rx="3" />
    </svg>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(
    defineProps<{
        on: boolean;
        tripped?: boolean;
        poles?: number;
        rail?: boolean;
    }>(),
    {tripped: false, poles: 1, rail: false}
);

const pad = 4;
const poleCount = computed(() =>
    Math.min(3, Math.max(1, Math.round(props.poles)))
);
// One body: a base width plus a slice per extra pole. Never separate modules.
const bodyW = computed(() => 32 + (poleCount.value - 1) * 20);
const vbW = computed(() => bodyW.value + pad * 2);
const cx = computed(() => pad + bodyW.value / 2);
const segW = computed(() => bodyW.value / poleCount.value);
const poleCenters = computed(() =>
    Array.from({length: poleCount.value}, (_, i) => pad + (i + 0.5) * segW.value)
);
const dividers = computed(() =>
    Array.from(
        {length: poleCount.value - 1},
        (_, i) => pad + (i + 1) * segW.value
    )
);

const stateClass = computed(() =>
    props.tripped ? 'is-tripped' : props.on ? 'is-on' : 'is-off'
);
const label = computed(() =>
    props.tripped ? 'Breaker tripped' : props.on ? 'Breaker on' : 'Breaker off'
);
</script>

<style scoped>
.brk {
    height: 100%;
    width: auto;
    /* Aspect is fixed by the viewBox — never let a flex parent scale it. */
    flex-shrink: 0;
    display: block;
    overflow: visible;
}
.brk-body {
    fill: var(--color-surface-2);
    stroke: var(--color-border-medium);
    stroke-width: 1;
}
.brk-cage {
    fill: var(--color-surface-0);
    stroke: var(--color-border-default);
    stroke-width: 0.75;
}
.brk-screw {
    fill: var(--color-surface-4);
    stroke: var(--color-border-medium);
    stroke-width: 0.6;
}
.brk-slot {
    stroke: var(--color-surface-0);
    stroke-width: 1;
    stroke-linecap: round;
}
.brk-divider {
    stroke: var(--color-border-medium);
    stroke-width: 0.8;
    opacity: 0.6;
}
.brk-housing {
    fill: var(--color-surface-3);
    stroke: var(--color-border-medium);
    stroke-width: 0.75;
}
.brk-slot-well {
    fill: var(--color-surface-0);
}
.brk-rail {
    fill: var(--color-surface-4);
    opacity: 0.5;
}

/* Indicator window: red when live (on), green when off. */
.brk-led {
    fill: var(--color-text-tertiary);
    transition: fill var(--duration-normal, 200ms) ease;
}
.is-on .brk-led {
    fill: var(--color-status-off, #c0293d);
}
.is-off .brk-led {
    fill: var(--color-status-on, #22c08e);
}
/* Trip is a fault that needs a manual reset — amber, not the safe-off green,
   per IEC 60073 / dashboard convention (red=live, green=safe, amber=attention). */
.is-tripped .brk-led {
    fill: var(--color-warning-text, #fbbf24);
}

/* Orange toggle — big, with a long vertical throw. Turns red on a trip so the
   middle-position lever reads as a fault at a glance. */
.brk-paddle {
    fill: #ee8127;
    filter: drop-shadow(0 1.5px 2px rgba(0, 0, 0, 0.45));
    transition: fill var(--duration-normal, 200ms) ease;
}
.is-tripped .brk-paddle {
    fill: var(--color-status-off, #c0293d);
}
.brk-gloss {
    fill: #fff;
    opacity: 0.22;
}
.brk-grip {
    stroke: rgba(0, 0, 0, 0.28);
    stroke-width: 1;
    stroke-linecap: round;
}
/* Just slide the lever — plain smooth move, no springy overshoot. */
.brk-lever {
    transition: transform var(--duration-normal, 200ms) ease-out;
}
.is-on .brk-lever {
    transform: translateY(0);
}
.is-tripped .brk-lever {
    transform: translateY(11px);
}
.is-off .brk-lever {
    transform: translateY(22px);
}

@media (prefers-reduced-motion: reduce) {
    .brk-lever {
        transition: none;
    }
}
</style>
