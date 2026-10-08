<template>
    <div class="system-banners" aria-live="polite" role="status">
        <div
            v-for="(banner, index) in banners"
            :key="banner.id"
            :ref="(el) => bindElement(banner.id, el)"
            class="system-banner"
            :class="{'system-banner--front': index === 0, 'system-banner--dragging': drag?.id === banner.id}"
            :style="{'--banner-depth': index}"
            :aria-hidden="index > 0"
            :role="index === 0 ? 'button' : undefined"
            :tabindex="index === 0 ? 0 : -1"
            :aria-label="index === 0 ? `${banner.title}. Open` : undefined"
            @pointerdown="onPointerDown($event, banner.id)"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
            @click="onOpen(banner)"
            @keydown.enter.prevent="onOpen(banner)"
            @keydown.space.prevent="onOpen(banner)"
            @keydown.escape.prevent="dismiss(banner.id)"
        >
            <span class="system-banner__icon" :class="`system-banner__icon--${banner.severity}`" aria-hidden="true">
                <i :class="iconFor(banner.severity)" />
            </span>
            <span class="system-banner__title">{{ banner.title }}</span>
            <span class="system-banner__when">{{ ageOf(banner) }}</span>
            <button
                type="button"
                class="system-banner__close"
                :aria-label="`Dismiss: ${banner.title}`"
                :title="`Dismiss: ${banner.title}`"
                @click.stop="dismiss(banner.id)"
            >
                <i class="fa-solid fa-xmark" aria-hidden="true" />
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {type ComponentPublicInstance, onBeforeUnmount, ref, watch} from 'vue';
import {useNowTicker} from '@/composables/useNowTicker';
import {formatRelative} from '@/helpers/format';
import {type BannerSeverity, type SystemBanner, useBannerStore} from '@/stores/banner';

const bannerStore = useBannerStore();
const {banners} = storeToRefs(bannerStore);

const ICONS: Record<BannerSeverity, string> = {
    info: 'fa-solid fa-circle-info',
    warning: 'fa-solid fa-triangle-exclamation',
    critical: 'fa-solid fa-circle-exclamation'
};

function iconFor(severity: BannerSeverity): string {
    return ICONS[severity];
}

// "now" for the first minute, then a live age.
const {now, release: releaseTicker} = useNowTicker();
function ageOf(banner: SystemBanner): string {
    if (!banner.since) return 'now';
    const seconds = Math.max(0, (now.value - banner.since) / 1000);
    return seconds < 60 ? 'now' : formatRelative(banner.since, now.value);
}

// --- Motion: one critically damped spring per banner ---------------------
// A spring has no fixed duration and starts from wherever the banner is, so
// a drag can grab it mid-flight and a release carries the finger's speed.
// Apple's "move" values: damping 1.0, response 0.4 s. Reduced motion
// crossfades instead of moving.

interface SpringState {
    y: number;
    velocity: number;
    target: number;
    opacity: number;
    frame: number | null;
    onSettle?: () => void;
}

const RESPONSE_S = 0.4;
const DAMPING_RATIO = 1;
const STIFFNESS = (2 * Math.PI) / RESPONSE_S;
const SETTLE_PX = 0.5;

// Off-screen rest position comes from the --banner-hidden-offset token.
function hiddenOffset(): number {
    if (typeof window === 'undefined') return 96;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--banner-hidden-offset');
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 96;
}
const HIDDEN_Y = -hiddenOffset();
const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const elements = new Map<string, HTMLElement>();
const springs = new Map<string, SpringState>();

function bindElement(id: string, el: Element | ComponentPublicInstance | null): void {
    if (el instanceof HTMLElement) elements.set(id, el);
    else elements.delete(id);
}

function paint(id: string): void {
    const el = elements.get(id);
    const spring = springs.get(id);
    if (!el || !spring) return;
    el.style.transform = reduceMotion ? '' : `translateY(${spring.y}px)`;
    el.style.opacity = String(spring.opacity);
}

function step(id: string, now: number, last: number): void {
    const spring = springs.get(id);
    if (!spring) return;
    const dt = Math.min(0.064, (now - last) / 1000);
    const displacement = spring.y - spring.target;
    const acceleration =
        -STIFFNESS * STIFFNESS * displacement -
        2 * DAMPING_RATIO * STIFFNESS * spring.velocity;
    spring.velocity += acceleration * dt;
    spring.y += spring.velocity * dt;
    spring.opacity = Math.max(0, Math.min(1, 1 - Math.abs(spring.y) / hiddenOffset()));
    paint(id);
    const settled =
        Math.abs(displacement) < SETTLE_PX && Math.abs(spring.velocity) < SETTLE_PX * 10;
    if (settled) {
        spring.y = spring.target;
        spring.velocity = 0;
        spring.opacity = spring.target === HIDDEN_Y ? 0 : 1;
        spring.frame = null;
        paint(id);
        spring.onSettle?.();
        return;
    }
    spring.frame = requestAnimationFrame((next) => step(id, next, now));
}

function animateTo(id: string, target: number, velocity = 0, onSettle?: () => void): void {
    const spring = springs.get(id);
    if (!spring) return;
    spring.target = target;
    spring.velocity = velocity;
    spring.onSettle = onSettle;
    if (reduceMotion) {
        crossfade(id, target === HIDDEN_Y ? 0 : 1, onSettle);
        return;
    }
    if (spring.frame === null) {
        const started = performance.now();
        spring.frame = requestAnimationFrame((now) => step(id, now, started));
    }
}

// Reduced motion: no travel, the banner fades in place over one state change.
const CROSSFADE_MS = 200;

function crossfade(id: string, to: number, onSettle?: () => void): void {
    const spring = springs.get(id);
    if (!spring) return;
    const from = spring.opacity;
    const started = performance.now();
    spring.y = 0;
    const tick = (now: number) => {
        const t = Math.min(1, (now - started) / CROSSFADE_MS);
        spring.opacity = from + (to - from) * t;
        paint(id);
        if (t < 1) {
            spring.frame = requestAnimationFrame(tick);
            return;
        }
        spring.frame = null;
        onSettle?.();
    };
    if (spring.frame !== null) cancelAnimationFrame(spring.frame);
    spring.frame = requestAnimationFrame(tick);
}

function enter(id: string): void {
    springs.set(id, {y: HIDDEN_Y, velocity: 0, target: 0, opacity: 0, frame: null});
    requestAnimationFrame(() => {
        paint(id);
        animateTo(id, 0);
    });
}

function leave(id: string, velocity: number, done: () => void): void {
    const spring = springs.get(id);
    if (!spring) return done();
    animateTo(id, HIDDEN_Y, velocity, () => {
        const frame = springs.get(id)?.frame;
        if (frame !== null && frame !== undefined) cancelAnimationFrame(frame);
        springs.delete(id);
        done();
    });
}

// Banners leave through the spring, then the store forgets them.
const leaving = new Set<string>();

function dismiss(id: string, velocity = 0): void {
    if (leaving.has(id)) return;
    leaving.add(id);
    leave(id, velocity, () => {
        leaving.delete(id);
        bannerStore.dismiss(id);
    });
}

watch(
    () => banners.value.map((b) => b.id),
    (ids, previous) => {
        for (const id of ids) if (!springs.has(id)) enter(id);
        for (const id of previous ?? []) {
            if (!ids.includes(id)) {
                const frame = springs.get(id)?.frame;
                if (frame !== null && frame !== undefined) cancelAnimationFrame(frame);
                springs.delete(id);
            }
        }
    },
    {immediate: true}
);

onBeforeUnmount(() => {
    releaseTicker();
    for (const spring of springs.values()) {
        if (spring.frame !== null) cancelAnimationFrame(spring.frame);
    }
});

// --- Gesture: swipe up to dismiss ----------------------------------------
// The banner follows the pointer 1:1 from where it was grabbed, resists a
// pull downward, and on release either leaves at the finger's speed or
// springs back. A tap opens; a drag past the hysteresis never counts as one.

interface DragState {
    id: string;
    pointerId: number;
    startY: number;
    grabY: number;
    lastY: number;
    lastT: number;
    velocity: number;
    active: boolean;
}

const HYSTERESIS_PX = 8;
const DISMISS_DISTANCE_PX = 40;
const DISMISS_VELOCITY_PX_S = -500;
const DECELERATION = 0.998;

const drag = ref<DragState | null>(null);
let suppressClick = false;

function rubberband(overshoot: number): number {
    const dimension = 48;
    const constant = 0.55;
    return (overshoot * dimension * constant) / (dimension + constant * overshoot);
}

function project(velocityPxPerSecond: number): number {
    return ((velocityPxPerSecond / 1000) * DECELERATION) / (1 - DECELERATION);
}

function onPointerDown(event: PointerEvent, id: string): void {
    if (event.button !== 0 || leaving.has(id)) return;
    const spring = springs.get(id);
    if (!spring) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    // Grab the banner where it is, even mid-flight.
    if (spring.frame !== null) cancelAnimationFrame(spring.frame);
    spring.frame = null;
    drag.value = {
        id,
        pointerId: event.pointerId,
        startY: event.clientY,
        grabY: spring.y,
        lastY: event.clientY,
        lastT: event.timeStamp,
        velocity: 0,
        active: false
    };
}

function onPointerMove(event: PointerEvent): void {
    const state = drag.value;
    if (!state || event.pointerId !== state.pointerId) return;
    const delta = event.clientY - state.startY;
    if (!state.active && Math.abs(delta) < HYSTERESIS_PX) return;
    state.active = true;
    const spring = springs.get(state.id);
    if (!spring) return;
    const y = state.grabY + delta;
    spring.y = y < 0 ? y : rubberband(y);
    spring.opacity = 1;
    const dt = Math.max(1, event.timeStamp - state.lastT);
    state.velocity = ((event.clientY - state.lastY) / dt) * 1000;
    state.lastY = event.clientY;
    state.lastT = event.timeStamp;
    paint(state.id);
}

function onPointerUp(event: PointerEvent): void {
    const state = drag.value;
    if (!state || event.pointerId !== state.pointerId) return;
    drag.value = null;
    if (!state.active) return;
    suppressClick = true;
    setTimeout(() => {
        suppressClick = false;
    }, 0);
    const spring = springs.get(state.id);
    if (!spring) return;
    const projected = spring.y + project(state.velocity);
    const leaves =
        projected < -DISMISS_DISTANCE_PX || state.velocity < DISMISS_VELOCITY_PX_S;
    if (leaves) dismiss(state.id, state.velocity);
    else animateTo(state.id, 0, state.velocity);
}

function onOpen(banner: SystemBanner): void {
    if (suppressClick || leaving.has(banner.id)) return;
    banner.onAction?.();
    dismiss(banner.id);
}
</script>

<style scoped>
/* One stack, newest in front; older banners tuck behind, smaller and dimmer,
   the way a phone stacks its notifications. */
.system-banners {
    position: fixed;
    top: max(var(--space-3), env(safe-area-inset-top, 0px));
    left: 50%;
    z-index: var(--z-toast);
    display: grid;
    width: min(100% - 2 * var(--space-4), var(--banner-width));
    transform: translateX(-50%);
    pointer-events: none;
}

.system-banner {
    --banner-depth: 0;
    grid-area: 1 / 1;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-target-min);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    border: 1px solid var(--banner-border);
    border-radius: var(--banner-radius);
    background: var(--banner-bg);
    backdrop-filter: var(--banner-filter);
    box-shadow: var(--banner-shadow);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    cursor: pointer;
    pointer-events: auto;
    touch-action: pan-x;
    user-select: none;
    will-change: transform, opacity;
    /* Starts off screen; the spring paints the real position inline. */
    opacity: 0;
    transform: translateY(calc(-1 * var(--banner-hidden-offset)));
    /* Depth is a layout transform on an axis the spring does not own. */
    scale: calc(1 - var(--banner-depth) * var(--banner-depth-scale));
    translate: 0 calc(var(--banner-depth) * -1 * var(--banner-depth-offset));
    filter: brightness(calc(1 - var(--banner-depth) * var(--banner-depth-dim)));
    z-index: calc(10 - var(--banner-depth));
    transition: scale var(--motion-morph), translate var(--motion-morph), filter var(--motion-state);
}

.system-banner:not(.system-banner--front) {
    pointer-events: none;
}

.system-banner--dragging {
    cursor: grabbing;
}

.system-banner__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--banner-icon-size);
    height: var(--banner-icon-size);
    border-radius: var(--radius-md);
    background: var(--banner-icon-bg);
}

.system-banner__icon i {
    transform: translateY(var(--icon-optical-offset));
}

.system-banner__icon--info {
    color: var(--color-info-text);
}
.system-banner__icon--warning {
    color: var(--color-warning-text);
}
.system-banner__icon--critical {
    color: var(--color-danger-text);
}

.system-banner__title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: var(--font-semibold);
    letter-spacing: 0.01em;
}

.system-banner__when {
    flex-shrink: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}

.system-banner__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    cursor: pointer;
    transition: background var(--motion-hover), color var(--motion-hover), transform var(--motion-press);
}

.system-banner__close:hover {
    background: rgba(var(--color-surface-2-rgb), 0.9);
    color: var(--color-text-primary);
}

.system-banner--front:focus-visible,
.system-banner__close:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.system-banner__close:active {
    transform: scale(0.94);
}

.system-banner__close:disabled {
    opacity: 0.5;
    cursor: default;
}

@media (prefers-reduced-transparency: reduce) {
    .system-banner {
        background: var(--color-surface-2);
        backdrop-filter: none;
    }
}

@media (prefers-contrast: more) {
    .system-banner {
        background: var(--color-surface-2);
        border-color: var(--color-border-strong);
    }
}
</style>
