<template>
    <CardShell
        type="ui_widget"
        name="Clock"
        :size="size"
        :edit-mode="editMode"
        @delete="$emit('delete')"
        @resize="(s: any) => $emit('resize', s)"
        @move="(d: any) => $emit('move', d)"
        @configure="$emit('configure')"
        @drag-start="(e: DragEvent) => $emit('drag-start', e)"
        @drag-end="(e: DragEvent) => $emit('drag-end', e)"
        @drag-over="(e: DragEvent) => $emit('drag-over', e)"
        @drag-leave="(e: DragEvent) => $emit('drag-leave', e)"
        @drop="(e: DragEvent) => $emit('drop', e)"
    >
        <div class="clk" :class="[sizeClass, {'clk--no-flip': suppressFlip}]">
            <!-- Split-flap board. Wide/hero flip seconds every tick; 1x1 has
                 no room for the seconds pair so it shows HH:MM only. -->
            <div class="clk-board">
                <template v-for="cell in cells" :key="cell.k">
                    <span v-if="cell.sep" class="clk-colon">:</span>
                    <span
                        v-else
                        class="clk-card"
                        :class="{'clk-card--accent': cell.accent}"
                    >
                        <Transition name="flip">
                            <span :key="cell.v" class="clk-digit">{{
                                cell.v
                            }}</span>
                        </Transition>
                    </span>
                </template>
                <span v-if="meridiem" class="clk-ampm">{{ meridiem }}</span>
            </div>

            <!-- 2x2 only: the same time, said in words. -->
            <div v-if="size === '2x2'" class="clk-words">{{ wordTime }}</div>

            <div class="clk-date">{{ dateText }}</div>
            <div v-if="size !== '1x1'" class="clk-loc">{{ zoneLabel }}</div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, nextTick, onUnmounted, ref} from 'vue';
import CardShell from '@/components/cards/CardShell.vue';

export interface ClockWidgetConfig {
    id: 'clock_widget';
}

const props = withDefaults(
    defineProps<{
        config?: ClockWidgetConfig;
        size?: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {size: '1x1', editMode: false}
);

defineEmits<{
    delete: [];
    resize: [size: '1x1' | '2x1' | '2x2'];
    move: [direction: number];
    configure: [];
    'drag-start': [e: DragEvent];
    'drag-end': [e: DragEvent];
    'drag-over': [e: DragEvent];
    'drag-leave': [e: DragEvent];
    drop: [e: DragEvent];
}>();

const now = ref(new Date());
// Suppresses the flip animation for the catch-up render after a hidden tab.
const suppressFlip = ref(false);
let tickHandle: ReturnType<typeof setTimeout> | undefined;

// Self-rescheduling timeout aimed at the next second boundary, so flips land
// on the wall-clock tick instead of the arbitrary mount phase.
function scheduleTick() {
    tickHandle = setTimeout(() => {
        now.value = new Date();
        scheduleTick();
    }, 1000 - (Date.now() % 1000));
}

// Background tabs throttle timers, so the board can be minutes stale on
// return. Re-sync at once, but without animating a flip for the jump.
function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    if (tickHandle !== undefined) clearTimeout(tickHandle);
    suppressFlip.value = true;
    now.value = new Date();
    nextTick(() => {
        // One frame later than Vue's transition setup, so the catch-up
        // render resolves with zero duration before flips re-enable.
        requestAnimationFrame(() => {
            suppressFlip.value = false;
        });
    });
    scheduleTick();
}

scheduleTick();
document.addEventListener('visibilitychange', onVisibilityChange);
onUnmounted(() => {
    if (tickHandle !== undefined) clearTimeout(tickHandle);
    document.removeEventListener('visibilitychange', onVisibilityChange);
});

const pad = (n: number) => String(n).padStart(2, '0');

// Locale hour cycle is stable for the session; resolve it once. The bare
// constructor omits hour12, so an explicit hour option is required.
const uses12h =
    new Intl.DateTimeFormat(undefined, {hour: 'numeric'}).resolvedOptions()
        .hour12 === true;

const meridiem = computed(() => {
    if (!uses12h) return '';
    return now.value.getHours() < 12 ? 'AM' : 'PM';
});

// One flip card per digit; a colon between HH / MM / SS.
const cells = computed(() => {
    const rawHours = now.value.getHours();
    const h = pad(uses12h ? rawHours % 12 || 12 : rawHours);
    const m = pad(now.value.getMinutes());
    const list: {k: string; v?: string; sep?: boolean; accent?: boolean}[] = [
        {k: 'h0', v: h[0]},
        {k: 'h1', v: h[1]},
        {k: 'c1', sep: true},
        {k: 'm0', v: m[0]},
        {k: 'm1', v: m[1]}
    ];
    if (props.size !== '1x1') {
        const s = pad(now.value.getSeconds());
        list.push(
            {k: 'c2', sep: true},
            {k: 's0', v: s[0], accent: true},
            {k: 's1', v: s[1], accent: true}
        );
    }
    return list;
});

const dateText = computed(() =>
    now.value.toLocaleDateString(
        undefined,
        props.size === '1x1'
            ? {weekday: 'short', month: 'short', day: 'numeric'}
            : {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'}
    )
);

// The board fills the tile: compact on 1x1, big on the wider tiles.
const sizeClass = computed(() =>
    props.size === '1x1'
        ? 'clk--sm'
        : props.size === '2x1'
          ? 'clk--wide'
          : 'clk--lg'
);

const zoneLabel = computed(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone.split('/').pop()?.replace(/_/g, ' ') ?? zone;
});

// The time said in words, QLOCKTWO-style, to the nearest five minutes.
const HOUR_WORDS = [
    'twelve',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven'
];
const MIN_WORDS: Record<number, string> = {
    5: 'five past',
    10: 'ten past',
    15: 'quarter past',
    20: 'twenty past',
    25: 'twenty-five past',
    30: 'half past',
    35: 'twenty-five to',
    40: 'twenty to',
    45: 'quarter to',
    50: 'ten to',
    55: 'five to'
};
const wordTime = computed(() => {
    const h = now.value.getHours() % 12;
    let m = Math.round(now.value.getMinutes() / 5) * 5;
    let hr = h;
    if (m === 60) {
        m = 0;
        hr = (h + 1) % 12;
    }
    if (m === 0) return `It is ${HOUR_WORDS[hr]} o'clock`;
    const hourWord = HOUR_WORDS[m > 30 ? (hr + 1) % 12 : hr];
    return `It is ${MIN_WORDS[m]} ${hourWord}`;
});
</script>

<style scoped>
.clk {
    /* Flap-card geometry — component-specific px, sized per tile below so
       the board always fits the CardShell content box. */
    --clk-card-w: 24px;
    --clk-card-h: 42px;
    --clk-perspective: 200px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    height: 100%;
}
.clk--wide {
    --clk-card-w: 52px;
    --clk-card-h: 74px;
}
/* Hero scale: display-size digits; card width is capped so six cards, two
   colons and the AM/PM caption still fit the hero body in 12h locales. */
.clk--lg {
    --clk-card-w: 56px;
    --clk-card-h: 96px;
}

.clk-board {
    display: flex;
    align-items: center;
    gap: 2px;
}

/* One split-flap card. The fold line across the middle sells the mechanism. */
.clk-card {
    position: relative;
    width: var(--clk-card-w);
    height: var(--clk-card-h);
    border-radius: var(--radius-sm);
    background: linear-gradient(
        180deg,
        var(--color-surface-4),
        var(--color-surface-2)
    );
    box-shadow: inset 0 0 0 1px var(--color-border-subtle);
    overflow: hidden;
    font-variant-numeric: tabular-nums;
    perspective: var(--clk-perspective);
}
.clk-card::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: var(--color-surface-bg);
    z-index: 2;
}
.clk--wide .clk-card,
.clk--lg .clk-card {
    border-radius: var(--radius-md);
}

.clk-digit {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: var(--type-subheading);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    backface-visibility: hidden;
}
.clk--wide .clk-digit {
    font-size: var(--type-heading);
}
.clk--lg .clk-digit {
    font-size: var(--type-display);
}
.clk-card--accent .clk-digit {
    color: var(--color-primary);
}

/* The flap: old digit folds up and out, new digit drops in. */
.flip-enter-active,
.flip-leave-active {
    transition:
        transform var(--duration-normal) var(--ease-out-expo),
        opacity var(--duration-normal) var(--ease-out-expo);
    transform-origin: center top;
}
/* Catch-up render after a hidden tab: digits jump, no flap storm. */
.clk--no-flip .flip-enter-active,
.clk--no-flip .flip-leave-active {
    transition: none;
}
.flip-enter-from {
    transform: rotateX(-90deg);
    opacity: 0;
}
.flip-leave-to {
    transform: rotateX(90deg);
    opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
    .flip-enter-active,
    .flip-leave-active {
        transition: opacity var(--duration-normal);
    }
    .flip-enter-from,
    .flip-leave-to {
        transform: none;
    }
}

.clk-colon {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-tertiary);
    /* Pull the neighbouring cards in tight around the colon. */
    margin: 0 -1px;
}
.clk--wide .clk-colon,
.clk--lg .clk-colon {
    /* Subheading, not digit size: colons mark rhythm, they don't compete. */
    font-size: var(--type-subheading);
    margin: 0;
}

.clk-ampm {
    align-self: flex-end;
    padding-bottom: var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
}

.clk-words {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-primary);
    text-align: center;
}

.clk-date {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    text-align: center;
}
.clk--lg .clk-date {
    font-size: var(--type-body);
}
.clk-loc {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-align: center;
}
</style>
