// Focus trap + body-scroll lock + restore-focus-on-close.
// Mirrors the pattern in components/modals/Modal.vue so custom-built
// dialogs (DetailOverlay, EnergySettingsModal, DashPanelScope, etc.)
// don't each roll their own a11y plumbing.
//
// Body-scroll lock is delegated to helpers/modalStack — same counter as
// Modal.vue, so nested Modal + custom-overlay combinations agree on the
// original overflow value to restore.
//
// Usage:
//   const panelRef = ref<HTMLElement | null>(null);
//   const visible = toRef(props, 'visible');
//   useFocusTrap(panelRef, visible, () => emit('close'));

import {nextTick, onBeforeUnmount, onMounted, type Ref, watch} from 'vue';
import {lockBodyScroll, unlockBodyScroll} from '@/helpers/modalStack';

const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
    panelRef: Ref<HTMLElement | null>,
    visible: Ref<boolean>,
    onEscape?: () => void
) {
    let previouslyFocused: HTMLElement | null = null;
    let locked = false;

    function getFocusable(): HTMLElement[] {
        const panel = panelRef.value;
        if (!panel) return [];
        return Array.from(
            panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        );
    }

    function handleKeydown(event: KeyboardEvent): void {
        // Bail if the host hid the panel without unmounting (e.g. <Transition>
        // leave) — Tab presses would otherwise force focus into a hidden node.
        if (!visible.value) return;
        if (event.key === 'Escape') {
            onEscape?.();
            return;
        }
        if (event.key !== 'Tab' || !panelRef.value) return;
        const focusable = getFocusable();
        if (focusable.length === 0) {
            event.preventDefault();
            panelRef.value.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !panelRef.value.contains(active)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
            return;
        }
        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }

    async function activate(): Promise<void> {
        previouslyFocused = document.activeElement as HTMLElement | null;
        lockBodyScroll();
        locked = true;
        await nextTick();
        // Parent may have flipped visible→false during the await — don't steal
        // focus into a panel that's already been torn down.
        if (!visible.value || !panelRef.value) return;
        const first = getFocusable()[0];
        if (first) {
            first.focus();
        } else {
            panelRef.value.focus();
        }
    }

    function deactivate(): void {
        if (locked) {
            unlockBodyScroll();
            locked = false;
        }
        if (
            previouslyFocused &&
            document.contains(previouslyFocused) &&
            typeof previouslyFocused.focus === 'function' &&
            previouslyFocused.matches(FOCUSABLE_SELECTOR)
        ) {
            previouslyFocused.focus();
        }
        previouslyFocused = null;
    }

    watch(visible, (isVisible) => {
        if (isVisible) {
            void activate();
        } else {
            deactivate();
        }
    });

    // v-if-mounted modals (no `:visible` prop, always-on while mounted)
    // pass a `ref(true)` — the watch never fires, so activate here.
    onMounted(() => {
        if (visible.value) void activate();
    });

    // Defensive teardown — if the host component unmounts while the
    // trap is active, restore body scroll + focus so the page isn't frozen.
    onBeforeUnmount(() => {
        deactivate();
    });

    return {handleKeydown};
}
