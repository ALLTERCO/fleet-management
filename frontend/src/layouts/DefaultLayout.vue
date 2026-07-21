<template>
    <BasicLayout>
        <div
            :inert="isInspectorOpen"
            :aria-hidden="isInspectorOpen ? 'true' : undefined"
        >
            <a href="#main-content" class="skip-to-content">Skip to content</a>
            <OfflineBanner />
        </div>
        <div class="layout-shell">
            <div
                class="layout-navigation"
                :inert="isInspectorOpen"
                :aria-hidden="isInspectorOpen ? 'true' : undefined"
            >
                <SideMenu />
            </div>
            <div class="layout-frame">
                <main
                    id="main-content"
                    class="layout-main"
                    :style="!smaller ? { marginLeft: `${sidebarWidth}px` } : undefined"
                    :inert="isInspectorOpen"
                    :aria-hidden="isInspectorOpen ? 'true' : undefined"
                    data-scroll-owner="page"
                    tabindex="-1"
                >
                    <slot />
                </main>
                <RightSideMenu class="layout-inspector" />
            </div>
        </div>
        <!-- Mobile overlay -->
        <div
            v-if="showMobileInspectorOverlay"
            class="layout-overlay fixed top-0 left-0 z-[var(--z-overlay)] h-screen w-screen lg:hidden"
            @click="bgClicked"
        />
        <!-- Desktop dimming overlay (click outside to close inspector) -->
        <div
            v-if="rightSideStore.hasSelection && !smaller"
            class="layout-dim"
            :style="{ left: `${sidebarWidth}px` }"
            @click="rightSideStore.clearInspector()"
        />
        <!-- Shared host for teleported dropdowns, popovers, and future inspector overlays. -->
        <div id="fleet-floating-root" class="floating-ui-root" />
        <!-- Keyboard shortcuts help overlay -->
        <KeyboardShortcutsModal :visible="shortcutsVisible" @close="shortcutsVisible = false" />
    </BasicLayout>
</template>

<script setup lang="ts">
import {breakpointsTailwind, useBreakpoints} from '@vueuse/core';
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import KeyboardShortcutsModal from '@/components/core/KeyboardShortcutsModal.vue';
import OfflineBanner from '@/components/core/OfflineBanner.vue';
import RightSideMenu from '@/components/core/RightSideMenu.vue';
import SideMenu from '@/components/core/SideMenu.vue';
import {dispatchShortcut, registerShortcut} from '@/config/shortcuts';
import {useSidebarState} from '@/helpers/ui';
import BasicLayout from '@/layouts/BasicLayout.vue';
import {useRightSideMenuStore} from '@/stores/right-side';

const breakpoints = useBreakpoints(breakpointsTailwind);
const smaller = breakpoints.smaller('lg');
const {sidebarWidth} = useSidebarState();

const rightSideStore = useRightSideMenuStore();
const shortcutsVisible = ref(false);
const isInspectorOpen = computed(
    () =>
        rightSideStore.hasSelection &&
        (!smaller.value || rightSideStore.isInspectorDrawerOpen)
);

// An open inspector renders .layout-dim as a full-bleed overlay with
// pointer-events: auto. Leaving the inspector mounted after route
// navigation (the store doesn't auto-clear) shadows the new page's
// scroll viewport and blocks every wheel/click. Clearing on path
// change keeps the dim un-rendered (its v-if guard goes false).
const route = useRoute();
// Watch the path, not fullPath: a query-only change (e.g. the devices search
// syncing ?search=, or a search hit opening the inspector then clearing the
// query) stays on the same page and must not wipe the inspector.
watch(
    () => route.path,
    () => rightSideStore.clearInspector()
);

const showMobileInspectorOverlay = computed(() => {
    return rightSideStore.isInspectorDrawerOpen;
});

const unregisterFns: Array<() => void> = [];

onMounted(() => {
    document.addEventListener('keydown', dispatchShortcut);
    unregisterFns.push(
        registerShortcut({
            id: 'shortcuts.help',
            description: 'Show keyboard shortcuts',
            section: 'Global',
            handler: (e) => {
                e.preventDefault();
                shortcutsVisible.value = !shortcutsVisible.value;
            }
        }),
        registerShortcut({
            id: 'inspector.close',
            description: 'Close inspector',
            section: 'Global',
            allowInInput: true,
            when: () => rightSideStore.hasSelection,
            handler: () => rightSideStore.clearInspector()
        })
    );
});

onUnmounted(() => {
    document.removeEventListener('keydown', dispatchShortcut);
    for (const u of unregisterFns) u();
});

function bgClicked() {
    if (!showMobileInspectorOverlay.value) return;
    rightSideStore.clearInspector();
}
</script>

<!-- <style>
* {
    outline: 1px solid purple;
}
</style> -->

<style scoped>
.skip-to-content {
    position: absolute;
    left: -9999px;
    top: 0;
    z-index: var(--z-tooltip);
    padding: var(--space-2) var(--space-4);
    background-color: var(--color-primary);
    color: var(--color-text-primary);
    border-radius: 0 0 var(--radius-md) 0;
    font-weight: var(--font-semibold);
}
.skip-to-content:focus {
    left: 0;
}
.layout-shell {
    display: flex;
    min-height: 100vh;
    max-height: 100vh;
    overflow: hidden;
}
.layout-navigation {
    display: contents;
}
.layout-frame {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
}
.layout-main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-2) var(--space-3) 5.5rem;
}
/* Short screens (Wall Display, phone landscape): reduce padding, hide scrollbar */
@media (max-height: 799px) {
    .layout-main {
        padding-bottom: var(--space-2);
        scrollbar-width: none;
    }
    .layout-main::-webkit-scrollbar {
        display: none;
    }
}
.layout-inspector {
    flex-shrink: 0;
}
.layout-overlay {
    background-color: var(--color-overlay);
}
.layout-dim {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    /* left is set dynamically via :style to respect sidebar width */
    z-index: var(--z-dropdown);
    background-color: var(--color-overlay-heavy);
    backdrop-filter: blur(var(--scrim-blur));
    -webkit-backdrop-filter: blur(var(--scrim-blur));
    pointer-events: auto;
    transition: left var(--duration-normal) ease;
}
.floating-ui-root {
    position: fixed;
    inset: 0;
    z-index: var(--z-tooltip);
    pointer-events: none;
    isolation: isolate;
}
@media (min-width: 1024px) {
    .layout-main {
        padding-bottom: var(--space-2);
        transition: margin-left var(--duration-normal) ease;
    }
}
@media (prefers-reduced-motion: reduce) {
    .layout-main,
    .layout-dim {
        transition-duration: 0ms;
    }
}
</style>
