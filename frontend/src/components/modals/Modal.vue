<template>
    <Transition name="modal">
    <div v-if="visible" role="dialog" aria-modal="true" @keydown="handleKeydown">
        <div
            class="modal-overlay fixed top-0 left-0 w-screen h-screen z-40 modal-backdrop"
            @click="bgClicked"
        />

        <div
            ref="panelRef"
            class="modal-panel fixed sm:left-1/2 sm:-translate-x-1/2 sm:translate-y-1/2 sm:bottom-1/2 sm:max-w-[95%] sm:rounded-lg bottom-0 left-0 w-full rounded-t-sm border-2 z-50 modal-content"
            :class="[
                compact
                    ? 'sm:w-[420px] overflow-visible'
                    : wide
                      ? 'sm:w-[90vw] lg:w-[1400px] max-h-[85vh] lg:max-h-[95vh] overflow-hidden'
                      : 'sm:w-[720px] lg:w-[960px] max-h-[85vh] lg:max-h-[95vh] overflow-hidden'
            ]"
        >
            <BasicBlock padding="none">
                <!-- X button -->
                <button
                    type="button"
                    aria-label="Close modal"
                    class="modal-close-btn bg-transparent rounded-lg text-sm w-11 h-11 ml-auto inline-flex justify-center items-center absolute top-2 right-2"
                    data-track="modal_close"
                    @click="emit('close')"
                >
                    <svg
                        class="w-3 h-3"
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
                <div class="flex flex-col p-3 md:p-5 gap-3">
                    <div v-if="$slots.title" class="h-18 w-full font-bold text-lg">
                        <slot name="title" />
                    </div>
                    <div
                        class="modal-body flex-grow p-4 rounded-lg"
                        :class="compact ? 'overflow-visible' : 'max-h-[75vh] lg:max-h-[85vh] overflow-y-auto z-40'"
                    >
                        <slot></slot>
                    </div>
                    <div v-if="$slots.footer" class="w-full md:rounded-b">
                        <slot name="footer" />
                    </div>
                </div>
            </BasicBlock>
        </div>
    </div>
    </Transition>
</template>

<script setup lang="ts">
import {nextTick, ref, toRef, watch} from 'vue';
import BasicBlock from '../core/BasicBlock.vue';

const props = defineProps<{
    visible: boolean;
    wide?: boolean;
    compact?: boolean;
}>();

const emit = defineEmits<{
    close: [];
}>();

const visible = toRef(props, 'visible');
const panelRef = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

// Focus trap: cycle Tab within modal
function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close');
        return;
    }
    if (e.key !== 'Tab' || !panelRef.value) return;

    const focusable = panelRef.value.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
        if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
        }
    } else {
        if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
}

// Save/restore focus on open/close
watch(visible, async (isVisible) => {
    if (isVisible) {
        previouslyFocused = document.activeElement as HTMLElement;
        await nextTick();
        // Focus the close button or first focusable inside the panel
        const firstFocusable = panelRef.value?.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        firstFocusable?.focus();
    } else {
        previouslyFocused?.focus();
        previouslyFocused = null;
    }
});

function bgClicked() {
    emit('close');
}
</script>

<style scoped>
.modal-overlay {
    background-color: var(--color-overlay-heavy);
}
.modal-panel {
    border-color: var(--color-border-default);
}
.modal-close-btn {
    color: var(--color-text-secondary);
}
.modal-close-btn:hover {
    background-color: var(--color-surface-4);
    color: var(--color-text-secondary);
}
.modal-body {
    background-color: var(--color-surface-1);
}
.modal-enter-active,
.modal-leave-active {
    transition: opacity var(--duration-fast) var(--ease-out);
}
.modal-enter-from,
.modal-leave-to {
    opacity: 0;
}
</style>
