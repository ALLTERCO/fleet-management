<template>
    <!-- Mobile bottom bar — overlay class when hidden + edge touched. -->
    <div v-if="smaller && (sidebarMode !== 'hidden' || edgeHover)"
        class="sidemenu-mobile fixed bottom-0 left-1/2 w-11/12 z-[var(--z-raised)] -translate-x-1/2 flex flex-row border rounded-t-xl backdrop-blur-sm"
        :class="{ 'sidemenu-overlay': sidebarMode === 'hidden' }"
    >
        <div class="sidemenu-mobile__scroll">
            <button v-for="item in mobileMenuItems" :key="item.link ?? item.name"
                type="button"
                :aria-label="item.name"
                class="sidemenu-mobile__item"
                :class="{ 'nav-active': item.link && isActive(item.link) }"
                :data-track="`nav_${(item.name ?? '').toLowerCase()}`"
                @click="item.link && linkClicked(item.link)"
            >
                <span class="sidemenu-mobile__icon">
                    <img v-if="item.iconUrl" :src="item.iconUrl" :alt="item.name" />
                    <ShellyDeviceGlyph v-else-if="item.icon === 'glyph:shelly-device'" />
                    <i v-else-if="item.icon" :class="item.icon" />
                    <span
                        v-if="item.link?.startsWith('/operations') && activeOperationsCount > 0"
                        class="nav-ops-dot"
                    />
                </span>
                <span class="sidemenu-mobile__label">{{ item.name }}</span>
            </button>
        </div>
    </div>

    <!-- Bottom edge trigger zone (mobile, hidden mode only) -->
    <div v-if="smaller && sidebarMode === 'hidden' && !edgeHover"
        class="sidemenu-edge-bottom"
        @touchstart.passive="edgeHover = true"
    />

    <!-- Backdrop to dismiss mobile overlay -->
    <div v-if="smaller && sidebarMode === 'hidden' && edgeHover"
        class="sidemenu-backdrop"
        @click="edgeHover = false"
    />

    <!-- Desktop left-edge trigger — reveal the hidden sidebar on hover. -->
    <div
        v-if="!smaller && sidebarMode === 'hidden' && !peek"
        class="sidemenu-edge-left"
        @mouseenter="peek = true"
    />

    <!-- Desktop sidebar: collapsed (icons only), hidden, or peeking on hover -->
    <aside v-if="!smaller && (sidebarMode !== 'hidden' || peek)"
        class="nav-sidebar nav-sidebar--collapsed"
        :class="{
            'nav-sidebar--glass': sidebarGlass,
            'nav-sidebar--overlay': peek && sidebarMode === 'hidden'
        }"
        @mouseleave="peek = false"
    >
        <nav class="nav-links">
            <template v-for="entry in menuItems" :key="entry.name ?? entry.type">
                <!-- Nav item -->
                <div
                    v-if="entry.type === 'item'"
                    role="button"
                    tabindex="0"
                    :aria-label="entry.name"
                    :title="!sidebarExpanded ? entry.name : undefined"
                    class="nav-item"
                    :class="{ active: entry.link && isActive(entry.link) }"
                    :data-track="`nav_${(entry.name ?? '').toLowerCase()}`"
                    @click="entry.link && linkClicked(entry.link)"
                    @keydown.enter="entry.link && linkClicked(entry.link)"
                    @keydown.space.prevent="entry.link && linkClicked(entry.link)"
                >
                    <span class="nav-icon">
                        <img v-if="entry.iconUrl" :src="entry.iconUrl" class="nav-icon-img" :alt="entry.name" />
                        <ShellyDeviceGlyph v-else-if="entry.icon === 'glyph:shelly-device'" />
                        <i v-else-if="entry.icon" :class="entry.icon" />
                        <span
                            v-if="badgeFor(entry.link) > 0"
                            class="nav-badge"
                            :aria-label="`${badgeFor(entry.link)} unread`"
                        >{{ badgeDisplay(badgeFor(entry.link)) }}</span>
                        <span
                            v-if="entry.link?.startsWith('/operations') && activeOperationsCount > 0"
                            class="nav-ops-dot"
                        />
                    </span>
                    <span class="nav-label">{{ entry.name }}</span>
                </div>

                <!-- Group gap — proximity-based separation -->
                <div v-else-if="entry.type === 'gap'" class="nav-gap" />

                <!-- Spacer (pushes remaining items to bottom) -->
                <div v-else-if="entry.type === 'spacer'" class="nav-spacer" />
            </template>
        </nav>
    </aside>
</template>

<script setup lang="ts">
import {breakpointsTailwind, useBreakpoints} from '@vueuse/core';
import {storeToRefs} from 'pinia';
import {computed, ref} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import ShellyDeviceGlyph from '@/components/core/ShellyDeviceGlyph.vue';
import {ALERTS_PATH, DEVICES_PATH} from '@/constants';
import {sectionForPath} from '@/helpers/sections';
import {useSidebarState} from '@/helpers/ui';
import {useAuthStore} from '@/stores/auth';
import {useBackgroundOpsStore} from '@/stores/backgroundOps';
import {useGeneralStore} from '@/stores/general';
import {useJobsStore} from '@/stores/jobs';
import {useNavStore} from '@/stores/nav';
import {getObsLevel, trackInteraction} from '@/tools/observability';

const authStore = useAuthStore();
const bgOpsStore = useBackgroundOpsStore();
const generalStore = useGeneralStore();
const jobsStore = useJobsStore();
const {sidebarGlass} = storeToRefs(generalStore);

const activeOperationsCount = computed(
    () => bgOpsStore.activeJobCount + jobsStore.activeJobCount
);

// Nav badges: alerts carries the open-alert count — the alerts list is the
// single inbox; the Devices item carries the waiting room pending count since
// Waiting Room moved under it as a tab.
const {waitingRoomCount, alertOpenCount} = storeToRefs(authStore);

function badgeFor(link: string | undefined): number {
    if (link === ALERTS_PATH) return alertOpenCount.value;
    if (link === DEVICES_PATH) return waitingRoomCount.value;
    return 0;
}

function badgeDisplay(count: number): string {
    return count > 999 ? '999+' : String(count);
}

const {sidebarExpanded, sidebarMode, toggleSidebar} = useSidebarState();

// Two-state sidebar — collapsed/icons-only is the only visible mode.
const isExpanded = computed(() => false);

function _cycleMode() {
    sidebarMode.value =
        sidebarMode.value === 'hidden' ? 'collapsed' : 'hidden';
}

const modeTitle = computed(() =>
    sidebarMode.value === 'hidden' ? 'Show sidebar' : 'Hide sidebar'
);

const breakpoints = useBreakpoints(breakpointsTailwind);
const smaller = breakpoints.smaller('lg');

const edgeHover = ref(false);
// Desktop: while hidden, hovering the left edge peeks the sidebar back in.
const peek = ref(false);

const router = useRouter();
const route = useRoute();

function linkClicked(link: string) {
    edgeHover.value = false;

    if (getObsLevel() >= 2) trackInteraction('nav', 'click', link);

    if (link.startsWith('http://') || link.startsWith('https://')) {
        window.open(link, '_blank');
        return;
    }

    router.push(link);
}

const navStore = useNavStore();
const {menuItems, mobileMenuItems} = storeToRefs(navStore);

// Cached for isActive — recomputes only when menuItems changes.
const allLinks = computed(() =>
    menuItems.value.filter((e) => e.link).map((e) => e.link!)
);

function isActive(link: string) {
    if (!link.startsWith('/')) return false;
    if (link === '/') return route.path === '/';
    // Highlight on a direct match, or when the route belongs to this item's
    // section via a different top-level path (e.g. Waiting Room under Devices).
    const isMatch =
        route.path === link ||
        route.path.startsWith(`${link}/`) ||
        sectionForPath(route.path)?.link === link;
    if (!isMatch) return false;
    return !allLinks.value.some(
        (other) =>
            other !== link &&
            other.startsWith(`${link}/`) &&
            (route.path === other || route.path.startsWith(`${other}/`))
    );
}
</script>

<style>
/* ═══════════════════════════════════════════════
   Mobile bottom bar
   ═══════════════════════════════════════════════ */
/* Mobile bar dimensions — single source for sizing / scroll affordance. */
.sidemenu-mobile {
    --mobile-item-min-w: 64px;
    --mobile-icon-img-size: 24px;
    --mobile-scroll-fade-w: 24px;
    --mobile-bar-h: 4rem;

    background-color: color-mix(in srgb, var(--color-surface-0) 50%, transparent);
    border-color: var(--color-border-strong);
    /* iOS gesture bar / Android nav bar — bar grows downward over the system UI. */
    min-height: var(--mobile-bar-h);
    padding-bottom: env(safe-area-inset-bottom, 0px);
}
@media (min-width: 768px) {
    .sidemenu-mobile {
        --mobile-bar-h: 5rem;
    }
}

.sidemenu-mobile__scroll {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    scrollbar-width: none;
    /* Right-edge fade hints "more items, scroll →". */
    -webkit-mask-image: linear-gradient(
        to right,
        black 0,
        black calc(100% - var(--mobile-scroll-fade-w)),
        transparent 100%
    );
    mask-image: linear-gradient(
        to right,
        black 0,
        black calc(100% - var(--mobile-scroll-fade-w)),
        transparent 100%
    );
}
.sidemenu-mobile__scroll::-webkit-scrollbar {
    display: none;
}

.sidemenu-mobile__item {
    flex: 0 0 auto;
    min-width: var(--mobile-item-min-w);
    padding: 0 var(--space-3);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.sidemenu-mobile__icon {
    font-size: var(--type-subheading);
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
}
.sidemenu-mobile__icon img {
    width: var(--mobile-icon-img-size);
    height: var(--mobile-icon-img-size);
    object-fit: contain;
}
.sidemenu-mobile__label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    line-height: 1;
}

.nav-active {
    color: var(--color-primary-text);
}
.sidemenu-mobile__item.nav-active .sidemenu-mobile__label {
    color: var(--color-primary-text);
}

.sidemenu-overlay {
    z-index: var(--z-sticky);
    box-shadow: 0 -4px 24px color-mix(in srgb, black 30%, transparent);
}

.sidemenu-edge-bottom {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    /* Reach above the iOS gesture bar so the touch zone is reliably tappable. */
    height: calc(1rem + env(safe-area-inset-bottom, 0px));
    z-index: var(--z-sticky);
}

.sidemenu-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-sticky) - 1);
}

/* ═══════════════════════════════════════════════
   Desktop: full-height fixed sidebar
   Default solid; .nav-sidebar--glass opts into glass-2 per spec Ref N
   (user preference — adds permanent backdrop-filter compositing layer).
   ═══════════════════════════════════════════════ */
.nav-sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: var(--z-sticky);
    background: var(--color-surface-0);
    border-right: 1px solid var(--color-border-default);
    display: flex;
    flex-direction: column;
    padding: var(--space-4) 0;
    transition: width var(--duration-normal) ease;
    overflow: hidden;
}
.nav-sidebar--glass {
    background: var(--glass-2-bg);
    backdrop-filter: var(--glass-2-filter);
    -webkit-backdrop-filter: var(--glass-2-filter);
    box-shadow: inset 0 1px 0 var(--glass-highlight);
}
.nav-sidebar--expanded { width: var(--sidebar-w); }
.nav-sidebar--collapsed { width: var(--sidebar-w-sm); }
.nav-sidebar--overlay {
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.25);
}
/* Thin left-edge zone that reveals the hidden sidebar on hover (desktop). */
.sidemenu-edge-left {
    position: fixed;
    top: 0;
    left: 0;
    width: var(--space-2);
    height: 100vh;
    z-index: var(--z-sticky);
}

/* Scrim behind auto-expanded sidebar */
.nav-scrim {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-sticky) - 1);
    background: var(--color-overlay-light);
    -webkit-backdrop-filter: blur(var(--scrim-blur));
    backdrop-filter: blur(var(--scrim-blur));
}
.scrim-enter-active,
.scrim-leave-active {
    transition: opacity var(--duration-normal) ease;
}
.scrim-enter-from,
.scrim-leave-to {
    opacity: 0;
}

/* ── Section toggles (sidebar) ── */
/* ── Collapse toggle button ── */
.nav-collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: var(--space-2) 0;
    border: none;
    background: none;
    color: var(--color-text-disabled);
    opacity: .5;
    cursor: pointer;
    transition: background var(--duration-fast), opacity var(--duration-fast);
}
.nav-collapse-btn:hover {
    background: var(--state-hover-bg);
    opacity: .8;
}
.nav-mode-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-disabled);
}

/* ── Group gap — proximity-based separation between nav groups ── */
.nav-sidebar .nav-gap {
    height: var(--space-5);
}

/* ── Spacer — pushes system items to bottom ── */
.nav-sidebar .nav-spacer {
    flex: 1;
    border-top: 1px solid var(--color-border-subtle);
    margin: var(--space-3) var(--space-5) 0;
}

/* ── Nav links ── */
.nav-links {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    flex: 1;
    padding: var(--space-2) 0;
    overflow-y: auto;
    overflow-x: hidden;
}

/* ── Nav item ── */
.nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    position: relative;
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-tertiary);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    border: none;
    background: none;
    width: 100%;
    text-align: left;
    transition:
        background var(--duration-fast),
        color var(--duration-fast);
}
.nav-item:hover {
    background: var(--state-hover-bg);
    box-shadow: none;
    color: var(--color-text-primary);
}
/* Active state: primary tint pill + 3px left accent + bolder weight. */
.nav-item.active {
    background: rgba(var(--color-primary-rgb), 0.1);
    color: var(--color-primary);
    font-weight: var(--font-semibold);
}
.nav-item.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: var(--space-1);
    bottom: var(--space-1);
    width: 3px;
    background: var(--color-primary);
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
}
.nav-item.active svg,
.nav-item.active .nav-icon {
    color: var(--color-primary);
    opacity: 0.95;
}
.nav-item:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: -2px;
}
/* Collapsed: center items */
.nav-sidebar--collapsed .nav-item {
    padding: var(--space-2) 0;
    justify-content: center;
    gap: 0;
}

/* ── Icon ── */
.nav-item svg,
.nav-item .nav-icon {
    width: var(--space-6);
    height: var(--space-6);
    flex-shrink: 0;
    opacity: .55;
    color: var(--color-text-tertiary);
    transition: opacity var(--duration-fast), color var(--duration-fast);
}
.nav-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--type-subheading);
    position: relative;
}
/* Custom glyph: em-sized like FA siblings, +15% optical compensation —
   outline drawings read lighter than FA's filled glyphs at equal box size. */
.nav-item .nav-icon svg {
    width: 1.15em;
    height: 1.15em;
    /* The wrapper already applies the nav dimming; don't double it. */
    opacity: 1;
}
.nav-badge {
    position: absolute;
    top: calc(-1 * var(--space-1-5));
    right: calc(-1 * var(--space-3));
    min-width: 18px;
    height: 18px;
    padding: 0 var(--space-1);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-on-danger);
    background: var(--color-danger);
    border-radius: var(--radius-full);
    line-height: 1;
}
.nav-ops-dot {
    position: absolute;
    top: var(--space-0-5);
    right: var(--space-0-5);
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-status-on);
    animation: ops-pulse var(--duration-slow) var(--ease-default) infinite;
}
@keyframes ops-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.55; transform: scale(0.8); }
}
.nav-item:hover svg,
.nav-item:hover .nav-icon { opacity: .85; color: var(--color-text-primary); }
.nav-item.active svg,
.nav-item.active .nav-icon { opacity: 1; color: var(--color-primary); }
.nav-sidebar--collapsed .nav-icon {
    width: var(--space-8);
    height: var(--space-8);
    font-size: var(--type-subheading);
}
.nav-icon-img {
    width: 18px;
    height: 18px;
    object-fit: contain;
}
.nav-sidebar--collapsed .nav-icon-img {
    width: 22px;
    height: 22px;
}

/* ── Label ── */
.nav-label {
    font-size: var(--type-body);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: opacity var(--duration-fast);
}
.nav-sidebar--collapsed .nav-label {
    width: 0;
    opacity: 0;
    pointer-events: none;
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
    .nav-sidebar,
    .nav-item,
    .nav-label {
        transition-duration: 0ms;
    }
}
</style>
