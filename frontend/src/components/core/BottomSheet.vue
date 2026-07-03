<template>
    <transition name="sheet">
        <div
            v-if="visible"
            class="sheet"
            :style="sheetStyle"
            role="dialog"
            :aria-label="ariaLabel"
        >
            <button
                type="button"
                class="sheet__grip"
                aria-label="Drag to resize"
                @pointerdown="onGripDown"
            >
                <span class="sheet__grip-line" aria-hidden="true" />
            </button>
            <div class="sheet__body">
                <slot />
            </div>
        </div>
    </transition>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';

export type SheetSnap = 'peek' | 'half' | 'full';

const SNAP_VH: Record<SheetSnap, number> = {
    peek: 14, // ~peek (≈100 px on a 720 viewport)
    half: 50,
    full: 88
};

const props = withDefaults(
    defineProps<{
        visible: boolean;
        snap: SheetSnap;
        ariaLabel?: string;
    }>(),
    {ariaLabel: 'Details panel'}
);
const emit = defineEmits<{'update:snap': [value: SheetSnap]}>();

const currentSnap = ref<SheetSnap>(props.snap);

watch(
    () => props.snap,
    (next) => {
        currentSnap.value = next;
    }
);

const sheetStyle = computed(() => ({
    height: `${SNAP_VH[currentSnap.value]}vh`
}));

let dragStartY = 0;
let dragStartVh = 0;
let dragActive = false;

function onGripDown(event: PointerEvent): void {
    dragActive = true;
    dragStartY = event.clientY;
    dragStartVh = SNAP_VH[currentSnap.value];
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', onGripMove);
    window.addEventListener('pointerup', onGripUp);
}

function onGripMove(event: PointerEvent): void {
    if (!dragActive) return;
    const deltaVh = ((dragStartY - event.clientY) / window.innerHeight) * 100;
    const desiredVh = dragStartVh + deltaVh;
    currentSnap.value = snapTo(desiredVh);
}

function onGripUp(): void {
    detachDragListeners();
    if (currentSnap.value !== props.snap) emit('update:snap', currentSnap.value);
}

function detachDragListeners(): void {
    dragActive = false;
    window.removeEventListener('pointermove', onGripMove);
    window.removeEventListener('pointerup', onGripUp);
}

// Unmount-mid-drag leaks the global listeners; clean up unconditionally.
onBeforeUnmount(detachDragListeners);

function snapTo(vh: number): SheetSnap {
    const peek = SNAP_VH.peek;
    const half = SNAP_VH.half;
    const full = SNAP_VH.full;
    const peekToHalf = (peek + half) / 2;
    const halfToFull = (half + full) / 2;
    if (vh < peekToHalf) return 'peek';
    if (vh < halfToFull) return 'half';
    return 'full';
}
</script>

<style scoped>
.sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
    border-top: 1px solid var(--color-border-medium);
    box-shadow: var(--glass-shadow);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 8;
    transition: height var(--duration-moderate) var(--ease-out-expo);
}
.sheet__grip {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 28px;
    background: transparent;
    border: 0;
    cursor: grab;
    touch-action: none;
    flex-shrink: 0;
}
.sheet__grip:active {
    cursor: grabbing;
}
.sheet__grip-line {
    width: 48px;
    height: 5px;
    border-radius: 999px;
    background: rgba(var(--color-frost-rgb), 0.35);
}
.sheet__body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-2) var(--space-4) var(--space-4);
}
.sheet-enter-active,
.sheet-leave-active {
    transition:
        transform var(--duration-moderate) var(--ease-out-expo),
        opacity var(--duration-normal) var(--ease-out-expo);
}
.sheet-enter-from,
.sheet-leave-to {
    transform: translateY(100%);
    opacity: 0;
}
</style>
