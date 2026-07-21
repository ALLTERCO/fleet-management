<template>
    <Teleport to="body">
        <Transition name="modal">
            <div
                v-if="visible"
                class="modal-root"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="$slots.title ? titleId : undefined"
                :style="{'--modal-depth': stackDepth}"
                @keydown="handleKeydown"
            >
                <div class="modal-overlay modal-backdrop" @click="bgClicked" />

                <div
                    ref="panelRef"
                    tabindex="-1"
                    class="modal-panel"
                    :class="panelClass"
                >
                    <button
                        type="button"
                        aria-label="Close modal"
                        class="modal-close-btn"
                        data-track="modal_close"
                        @click="emit('close')"
                    >
                        <svg
                            class="h-3 w-3"
                            aria-hidden="true"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 14 14"
                        >
                            <path
                                stroke="currentColor"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
                            />
                        </svg>
                    </button>

                    <div
                        v-if="$slots.title"
                        :id="titleId"
                        class="modal-header shrink-0 pr-14"
                    >
                        <slot name="title" />
                    </div>

                    <div class="modal-body-shell flex-1 min-h-0">
                        <div
                            class="modal-body min-h-0"
                            :class="
                                compact ? 'overflow-visible' : 'overflow-y-auto'
                            "
                        >
                            <slot />
                        </div>
                    </div>

                    <div v-if="$slots.footer" class="modal-footer shrink-0">
                        <slot name="footer" />
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    useId,
    watch
} from 'vue';
import {
    lockBodyScroll,
    releaseModalDepth,
    reserveModalDepth,
    unlockBodyScroll
} from '@/helpers/modalStack';
import {getObsLevel, trackInteraction} from '@/tools/observability';

const props = defineProps<{
    visible: boolean;
    wide?: boolean;
    large?: boolean;
    huge?: boolean;
    compact?: boolean;
    /** Adds a comfortable min-height on top of the width variant. */
    tall?: boolean;
    /** Uses the entire viewport for long task flows on small screens. */
    fullScreenMobile?: boolean;
}>();

const emit = defineEmits<{
    close: [];
}>();

const panelRef = ref<HTMLElement | null>(null);
const titleId = `modal-title-${useId()}`;
const focusableSelector =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let previouslyFocused: HTMLElement | null = null;
let ownsBodyLock = false;

const sizeClass = computed(() => {
    if (props.compact) return 'modal-panel--compact';
    if (props.huge) return 'modal-panel--huge';
    if (props.large) return 'modal-panel--large';
    if (props.wide) return 'modal-panel--wide';
    return 'modal-panel--default';
});

const panelClass = computed(() => [
    sizeClass.value,
    props.tall && 'modal-panel--tall',
    props.fullScreenMobile && 'modal-panel--mobile-full'
]);

function getFocusableElements() {
    const candidates = Array.from(
        panelRef.value?.querySelectorAll<HTMLElement>(focusableSelector) ?? []
    );
    return candidates.filter(isFocusable);
}

function isElementVisible(element: HTMLElement): boolean {
    let current: HTMLElement | null = element;
    while (current && current !== panelRef.value) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') {
            return false;
        }
        current = current.parentElement;
    }
    return true;
}

function isDisabledByFieldset(element: HTMLElement): boolean {
    let current = element.parentElement;
    while (current && current !== panelRef.value) {
        if (current.tagName === 'FIELDSET' && current.hasAttribute('disabled')) {
            const firstLegend = Array.from(current.children).find(
                (child) => child.tagName === 'LEGEND'
            );
            if (!firstLegend?.contains(element)) return true;
        }
        current = current.parentElement;
    }
    return false;
}

function isFocusable(element: HTMLElement): boolean {
    return (
        !element.matches(':disabled') &&
        !isDisabledByFieldset(element) &&
        !element.closest('[inert]') &&
        isElementVisible(element)
    );
}

function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        emit('close');
        return;
    }

    if (event.key !== 'Tab' || !panelRef.value) {
        return;
    }

    const focusable = getFocusableElements();
    if (focusable.length === 0) {
        event.preventDefault();
        panelRef.value.focus();
        return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement as HTMLElement | null;

    if (!activeElement || !panelRef.value.contains(activeElement)) {
        event.preventDefault();
        const target = event.shiftKey ? last : first;
        if (typeof target.focus === 'function') target.focus();
        return;
    }

    if (event.shiftKey) {
        if (activeElement === first) {
            event.preventDefault();
            if (typeof last.focus === 'function') last.focus();
        }

        return;
    }

    if (activeElement === last) {
        event.preventDefault();
        if (typeof first.focus === 'function') first.focus();
    }
}

// Depth allocation + body scroll lock live in helpers/modalStack so nested
// modals each get a unique z-layer and the body-lock is single-source.
const stackDepth = ref(0);

function focusFirstInPanel() {
    const firstFocusable = getFocusableElements()[0];
    if (firstFocusable && typeof firstFocusable.focus === 'function') {
        firstFocusable.focus();
        return;
    }
    panelRef.value?.focus();
}

function restorePreviousFocus() {
    if (
        previouslyFocused &&
        document.contains(previouslyFocused) &&
        typeof previouslyFocused.focus === 'function' &&
        previouslyFocused.matches(focusableSelector)
    ) {
        previouslyFocused.focus();
    }
    previouslyFocused = null;
}

async function onOpened() {
    if (getObsLevel() >= 2) trackInteraction('modal', 'open', titleId);
    stackDepth.value = reserveModalDepth();
    lockBodyScroll();
    ownsBodyLock = true;
    previouslyFocused = document.activeElement as HTMLElement;
    await nextTick();
    focusFirstInPanel();
}

function onClosed() {
    if (stackDepth.value > 0) releaseModalDepth(stackDepth.value);
    stackDepth.value = 0;
    if (ownsBodyLock) unlockBodyScroll();
    ownsBodyLock = false;
    restorePreviousFocus();
}

watch(
    () => props.visible,
    (isVisible) => {
        if (isVisible) void onOpened();
        else onClosed();
    }
);

// Mounted-already-open case: parents that pass `:visible="true"` literally
// (or compute it true on first render) never trigger the watcher above.
onMounted(() => {
    if (props.visible) void onOpened();
});

onBeforeUnmount(onClosed);

function bgClicked() {
    emit('close');
}
</script>

<style scoped>
.modal-root {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-modal) + var(--modal-depth, 0) * 10);
}

.modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 0;
    background-color: var(--modal-overlay);
    /* Frosted backdrop — glass-3 modal tier. */
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
}

.modal-panel {
    position: fixed;
    left: 0;
    bottom: 0;
    z-index: 1;
    display: flex;
    width: 100%;
    /* Leave room for mobile bottom nav bar (4rem) + inset */
    max-height: calc(100vh - 4rem - var(--modal-mobile-inset));
    flex-direction: column;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    background-color: var(--glass-3-bg);
    box-shadow: var(--card-shadow-hover), inset 0 1px 0 var(--glass-highlight);
    outline: none;
}

.modal-panel--mobile-full {
    top: 0;
    bottom: 0;
    min-height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
}

/* Variant heights apply on desktop only. On mobile the panel is a
 * bottom-sheet using the baseline max-height (which accounts for the
 * mobile bottom bar). Variant overrides at this breakpoint would risk
 * overlapping the bar (huge ≈ 94vh > available viewport once the bar
 * is subtracted on smaller phones). */

.modal-close-btn {
    position: absolute;
    right: var(--modal-close-offset);
    top: var(--modal-close-offset);
    display: inline-flex;
    height: var(--touch-target-min);
    width: var(--touch-target-min);
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-lg);
    background-color: transparent;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}

.modal-close-btn:hover {
    background-color: var(--color-surface-4);
    color: var(--color-text-secondary);
}

.modal-header {
    padding:
        var(--modal-header-padding-top)
        var(--modal-header-padding-x)
        0;
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.modal-body-shell {
    display: flex;
    flex-direction: column;
    padding:
        var(--modal-body-shell-padding-top)
        var(--modal-body-shell-padding-x)
        var(--modal-body-shell-padding-bottom);
}

.modal-body {
    flex: 1;
    padding: var(--modal-body-padding);
}

.modal-footer {
    border-top: 1px solid var(--color-border-subtle);
    background-color: var(--modal-bg);
    padding:
        var(--modal-footer-padding-top)
        var(--modal-footer-padding-x)
        calc(
            var(--modal-footer-padding-bottom) +
                env(safe-area-inset-bottom, 0px)
        );
}

@media (min-width: 768px) {
    .modal-panel {
        left: 50%;
        bottom: 50%;
        max-width: 95%;
        transform: translate(-50%, 50%);
        border-radius: var(--radius-xl);
    }

    .modal-panel--mobile-full {
        top: auto;
        min-height: 0;
    }

    /* At lg+ (1024px) there is no mobile bottom bar — restore full height */
    @media (min-width: 1024px) {
        .modal-panel {
            max-height: calc(100vh - var(--modal-mobile-inset));
        }
    }

    .modal-panel--compact {
        width: var(--modal-width-compact);
        max-height: min(
            calc(100vh - var(--modal-mobile-inset)),
            var(--modal-max-height-compact)
        );
    }

    /* Additive to any width variant — gives short forms a comfortable floor. */
    .modal-panel--tall {
        min-height: min(
            calc(100vh - var(--modal-mobile-inset)),
            var(--modal-min-height-tall)
        );
    }

    /* Lift compact's 80vh cap so long forms grow instead of clipping. */
    .modal-panel--compact.modal-panel--tall {
        max-height: min(
            calc(100vh - var(--modal-mobile-inset)),
            var(--modal-max-height-tall)
        );
    }

    .modal-panel--default {
        width: var(--modal-width-default);
        max-height: min(
            calc(100vh - var(--modal-mobile-inset)),
            var(--modal-max-height-default)
        );
    }

    .modal-panel--large {
        width: min(94vw, var(--modal-width-default-lg));
        max-height: min(
            calc(100vh - var(--modal-mobile-inset)),
            var(--modal-max-height-default)
        );
    }

    .modal-panel--wide {
        width: min(var(--modal-width-wide-fluid), var(--modal-width-wide));
        max-height: min(
            calc(100vh - var(--modal-mobile-inset)),
            var(--modal-max-height-wide)
        );
    }

    .modal-panel--huge {
        width: min(var(--modal-width-xl-fluid), var(--modal-width-xl));
        max-height: min(
            calc(100vh - var(--modal-mobile-inset)),
            var(--modal-max-height-xl)
        );
    }

    .modal-header {
        padding:
            var(--modal-header-padding-top-md)
            var(--modal-header-padding-x-md)
            0;
    }

    .modal-body-shell {
        padding:
            var(--modal-body-shell-padding-top)
            var(--modal-body-shell-padding-x-md)
            var(--modal-body-shell-padding-bottom-md);
    }

    .modal-footer {
        padding:
            var(--modal-footer-padding-top-md)
            var(--modal-footer-padding-x-md)
            var(--modal-footer-padding-bottom-md);
    }
}

@media (min-width: 1024px) {
    .modal-panel--default {
        width: var(--modal-width-default-lg);
    }

    .modal-panel--wide {
        width: var(--modal-width-wide);
    }

    .modal-panel--huge {
        width: min(var(--modal-width-xl-fluid), var(--modal-width-xl));
    }
}

/* Premium entrance — fade the overlay, scale the panel.
   Mobile: panel is bottom-pinned (no transform), so it only fades —
   translate-based scale would slide it off-screen.
   Desktop: panel is centred with `translate(-50%, 50%)`, scale composes
   with the translate by repeating it in the enter/leave classes. */
.modal-enter-active,
.modal-leave-active {
    transition: opacity var(--duration-normal) var(--ease-out-expo);
}

.modal-enter-active .modal-panel,
.modal-leave-active .modal-panel {
    transition:
        transform var(--duration-normal) var(--ease-out-expo),
        opacity var(--duration-normal) var(--ease-out-expo);
}

.modal-enter-from,
.modal-leave-to {
    opacity: 0;
}

.modal-enter-from .modal-panel,
.modal-leave-to .modal-panel {
    opacity: 0;
}

/* Mobile: slide up from the bottom edge (bottom-sheet pattern). */
.modal-enter-from .modal-panel,
.modal-leave-to .modal-panel {
    transform: translateY(100%);
}

@media (min-width: 768px) {
    .modal-enter-from .modal-panel {
        transform: translate(-50%, 50%) scale(0.96);
    }

    .modal-leave-to .modal-panel {
        transform: translate(-50%, 50%) scale(0.98);
    }
}

@media (prefers-reduced-motion: reduce) {
    .modal-enter-active,
    .modal-leave-active,
    .modal-enter-active .modal-panel,
    .modal-leave-active .modal-panel {
        transition-duration: 0ms;
    }
}
</style>
