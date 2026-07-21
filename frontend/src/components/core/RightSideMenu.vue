<template>
    <Transition :name="smaller ? 'inspector-slide' : 'inspector-fade'">
        <aside
            v-if="shouldRender"
            ref="asideRef"
            v-bind="$attrs"
            class="right-side-menu"
            :class="asideClass"
            role="dialog"
            aria-label="Inspector"
            aria-modal="true"
            tabindex="-1"
            @keydown.esc="rightSideStore.clearInspector()"
        >
            <div class="right-side-menu__surface">
                <div class="right-side-menu__body">
                    <component
                        :is="rightSideStore.inspectorComponent"
                        v-bind="rightSideStore.inspectorProps"
                        class="h-full min-h-0"
                    />
                </div>
            </div>
        </aside>
    </Transition>
</template>

<script setup lang="ts">
import {breakpointsTailwind, onClickOutside, useBreakpoints} from '@vueuse/core';
import {computed, nextTick, onBeforeUnmount, ref, watch} from 'vue';
import {useRightSideMenuStore} from '@/stores/right-side';

defineOptions({inheritAttrs: false});

const rightSideStore = useRightSideMenuStore();
const breakpoints = useBreakpoints(breakpointsTailwind);
const smaller = breakpoints.smaller('lg');
const asideRef = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

// Auto-close inspector drawer when screen shrinks below lg breakpoint
watch(smaller, (isMobile) => {
    if (isMobile && rightSideStore.isInspectorDrawerOpen) {
        rightSideStore.closeInspectorDrawer();
    }
});

const shouldRender = computed(() => {
    if (!rightSideStore.hasSelection) return false;
    return smaller.value ? rightSideStore.isInspectorDrawerOpen : true;
});

// No close button: Escape or a click anywhere outside dismisses. A click
// on another device card still lands there and just switches the content.
// Overlays owned by the drawer's content teleport to body — clicks inside
// them are NOT outside, or the drawer would close under its own modals.
onClickOutside(
    asideRef,
    () => {
        if (shouldRender.value) rightSideStore.clearInspector();
    },
    {ignore: ['.modal-root', '.floating-panel']}
);

const asideClass = computed(() => {
    if (smaller.value) {
        return rightSideStore.isInspectorDrawerOpen
            ? 'right-side-menu--mobile-open'
            : 'right-side-menu--mobile-closed';
    }

    return 'right-side-menu--desktop';
});

function restorePreviousFocus() {
    if (
        previouslyFocused?.isConnected &&
        !previouslyFocused.matches(':disabled') &&
        !previouslyFocused.closest('[inert]')
    ) {
        previouslyFocused.focus();
    }
    previouslyFocused = null;
}

watch(
    shouldRender,
    async (isRendered, wasRendered) => {
        if (isRendered && !wasRendered) {
            previouslyFocused = document.activeElement as HTMLElement | null;
            await nextTick();
            asideRef.value?.focus();
            return;
        }

        if (!isRendered && wasRendered) {
            await nextTick();
            restorePreviousFocus();
        }
    },
    {immediate: true}
);

onBeforeUnmount(restorePreviousFocus);
</script>

<style scoped>
.right-side-menu {
    min-height: 0;
}
.right-side-menu__surface {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-xl) 0 0 var(--radius-xl);
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
    box-shadow: var(--shadow-lg), inset 0 1px 0 var(--glass-highlight);
}
.right-side-menu__body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
}

@media (max-width: 1023px) {
    .right-side-menu {
        position: fixed;
        right: var(--inspector-mobile-inset);
        top: var(--inspector-mobile-inset);
        bottom: var(--inspector-mobile-inset);
        z-index: calc(var(--z-overlay) + 1);
        width: min(
            var(--inspector-mobile-max-width),
            calc(100vw - (var(--inspector-mobile-inset) * 2))
        );
        max-width: calc(100vw - (var(--inspector-mobile-inset) * 2));
    }
    .right-side-menu__surface {
        border-radius: var(--radius-xl);
    }
    .right-side-menu--mobile-open {
        transform: translateX(0);
    }
    .right-side-menu--mobile-closed {
        opacity: 0;
        pointer-events: none;
        transform: translateX(1rem);
    }
}

@media (min-width: 1024px) {
    .right-side-menu {
        height: auto;
        margin-top: 0;
    }
    .right-side-menu--desktop {
        position: fixed;
        top: var(--inspector-desktop-top-offset);
        right: var(--space-2);
        bottom: var(--space-2);
        z-index: calc(var(--z-dropdown) + 1);
        width: var(--inspector-desktop-width);
        min-width: var(--inspector-desktop-min-width);
        max-width: var(--inspector-desktop-max-width);
    }
    .right-side-menu__surface {
        border-radius: var(--radius-xl);
    }
}

.inspector-slide-enter-active,
.inspector-slide-leave-active,
.inspector-fade-enter-active,
.inspector-fade-leave-active {
    transition:
        opacity var(--duration-fast) var(--ease-out),
        transform var(--duration-fast) var(--ease-out);
}

.inspector-slide-enter-from,
.inspector-slide-leave-to,
.inspector-fade-enter-from,
.inspector-fade-leave-to {
    opacity: 0;
}

.inspector-slide-enter-from,
.inspector-slide-leave-to {
    transform: translateX(1rem);
}
</style>
