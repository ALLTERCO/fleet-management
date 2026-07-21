<template>
    <Teleport to="body">
        <Transition name="floating-panel-fade">
            <div
                v-if="open"
                ref="panelRef"
                class="floating-panel"
                :class="panelClass"
                :style="panelStyle"
                @click.stop
            >
                <slot />
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
import {nextTick, onBeforeUnmount, ref, watch} from 'vue';

type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

const props = withDefaults(
    defineProps<{
        open: boolean;
        anchor: HTMLElement | null;
        placement?: Placement;
        offset?: number;
        matchWidth?: boolean;
        minWidth?: number;
        maxWidth?: number;
        clampPadding?: number;
        closeOnOutside?: boolean;
        closeOnEscape?: boolean;
        panelClass?: string;
    }>(),
    {
        placement: 'bottom-start',
        offset: 8,
        matchWidth: false,
        minWidth: undefined,
        maxWidth: undefined,
        clampPadding: 8,
        closeOnOutside: true,
        closeOnEscape: true,
        panelClass: ''
    }
);

const emit = defineEmits<{
    close: [];
}>();

const panelRef = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({
    visibility: 'hidden'
});

let frameId = 0;
let listenersAttached = false;

function clamp(value: number, bounds: {min: number; max: number}) {
    return Math.min(Math.max(value, bounds.min), bounds.max);
}

function schedulePositionUpdate() {
    if (!props.open) {
        return;
    }

    if (frameId) {
        cancelAnimationFrame(frameId);
    }

    frameId = requestAnimationFrame(() => {
        frameId = 0;
        updatePosition();
    });
}

function updatePosition() {
    if (!props.open || !props.anchor || !panelRef.value) {
        return;
    }

    if (!document.body.contains(props.anchor)) {
        panelStyle.value = {visibility: 'hidden'};
        emit('close');
        return;
    }

    const anchorRect = props.anchor.getBoundingClientRect();
    const panelRect = panelRef.value.getBoundingClientRect();
    const padding = props.clampPadding;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const desiredWidth = props.matchWidth
        ? anchorRect.width
        : Math.max(panelRect.width, props.minWidth ?? 0);
    const maxAllowedWidth = Math.min(
        props.maxWidth ?? viewportWidth - padding * 2,
        viewportWidth - padding * 2
    );
    const width = Math.min(desiredWidth, maxAllowedWidth);

    const prefersTop = props.placement.startsWith('top');
    const alignsEnd = props.placement.endsWith('end');
    const availableAbove = anchorRect.top - padding;
    const availableBelow = viewportHeight - anchorRect.bottom - padding;
    const shouldOpenAbove = prefersTop
        ? availableAbove >= panelRect.height || availableAbove >= availableBelow
        : panelRect.height > availableBelow && availableAbove > availableBelow;

    let left = alignsEnd ? anchorRect.right - width : anchorRect.left;
    left = clamp(left, {
        min: padding,
        max: Math.max(padding, viewportWidth - width - padding)
    });

    let top = shouldOpenAbove
        ? anchorRect.top - panelRect.height - props.offset
        : anchorRect.bottom + props.offset;
    top = clamp(top, {
        min: padding,
        max: Math.max(padding, viewportHeight - panelRect.height - padding)
    });

    panelStyle.value = {
        left: `${left}px`,
        top: `${top}px`,
        minWidth: props.matchWidth
            ? `${width}px`
            : props.minWidth
              ? `${props.minWidth}px`
              : '',
        width: props.matchWidth ? `${width}px` : '',
        maxWidth: `${maxAllowedWidth}px`,
        visibility: 'visible'
    };
}

function closeOnOutsidePointer(event: PointerEvent) {
    if (!props.open || !props.closeOnOutside) {
        return;
    }

    const target = event.target as Node | null;
    if (!target) {
        return;
    }

    if (panelRef.value?.contains(target) || props.anchor?.contains(target)) {
        return;
    }

    emit('close');
}

function closeOnEscapeKey(event: KeyboardEvent) {
    if (props.open && props.closeOnEscape && event.key === 'Escape') {
        emit('close');
    }
}

function attachListeners() {
    if (listenersAttached) {
        return;
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscapeKey);
    window.addEventListener('resize', schedulePositionUpdate);
    window.addEventListener('scroll', schedulePositionUpdate, true);
    listenersAttached = true;
}

function detachListeners() {
    if (!listenersAttached) {
        return;
    }

    document.removeEventListener('pointerdown', closeOnOutsidePointer);
    document.removeEventListener('keydown', closeOnEscapeKey);
    window.removeEventListener('resize', schedulePositionUpdate);
    window.removeEventListener('scroll', schedulePositionUpdate, true);
    listenersAttached = false;
}

watch(
    () => props.open,
    async (isOpen) => {
        if (isOpen) {
            panelStyle.value = {visibility: 'hidden'};
            attachListeners();
            await nextTick();
            updatePosition();
            return;
        }

        detachListeners();
        panelStyle.value = {visibility: 'hidden'};
    }
);

watch(
    () => props.anchor,
    () => {
        if (props.open) {
            schedulePositionUpdate();
        }
    }
);

onBeforeUnmount(() => {
    if (frameId) {
        cancelAnimationFrame(frameId);
    }
    detachListeners();
});

defineExpose({
    updatePosition
});
</script>

<style scoped>
.floating-panel {
    position: fixed;
    z-index: var(--z-tooltip);
    pointer-events: auto;
}

/* Glass tier-3 — SSOT via --glass-3-*. Drop shadow stays so the panel
   reads as floating; inset highlight adds the rim light. */
.floating-panel--glass {
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
    border: 1px solid var(--glass-border);
    /* Menus were designed on radius-lg (Dropdown, GroupWidget pass the
       same via utility); the base owns it so no consumer needs to. */
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-highlight);
}

.floating-panel-fade-enter-active,
.floating-panel-fade-leave-active {
    transition: opacity var(--duration-fast) var(--ease-out);
}

.floating-panel-fade-enter-from,
.floating-panel-fade-leave-to {
    opacity: 0;
}
</style>
