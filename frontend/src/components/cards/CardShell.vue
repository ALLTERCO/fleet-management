<template>
    <div
        ref="cardEl"
        class="ec"
        :class="[sizeClass, stateClasses, extraClass]"
        :data-type="normalizedType"
        :style="cardStyle"
        :tabindex="0"
        @click="onCardClick"
        @keydown="onKeydown"
    >
        <!-- Edit overlay. Drag-to-move/reorder is disabled by product decision;
             items keep their add-order. Only size change, configure and delete
             remain. -->
        <template v-if="editMode">
            <div class="card-overlay">
                <!-- Control buttons (top-right) -->
                <div class="card-edit-controls">
                    <button class="card-ctrl" title="Change size" aria-label="Change size" @click.stop="toggleSizePicker">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
                            <rect x="1" y="1" width="14" height="14" rx="2" />
                            <path d="M8 1v14M1 8h14" opacity=".3" />
                        </svg>
                    </button>
                    <button v-if="configurable" class="card-ctrl" title="Configure" aria-label="Configure" @click.stop="$emit('configure')">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
                            <circle cx="8" cy="8" r="2.5" /><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1" />
                        </svg>
                    </button>
                    <button class="card-ctrl danger" title="Remove" aria-label="Remove" @click.stop="$emit('delete')">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
                            <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                    </button>
                </div>
                <!-- Size picker popover (teleported outside .ec to escape overflow:clip) -->
                <Teleport to="#card-popover-target">
                    <div
                        v-if="sizePickerOpen"
                        ref="sizePickerEl"
                        class="size-picker"
                        :style="sizePickerStyle"
                        @click.stop
                    >
                        <div
                            v-for="opt in sizeOptions"
                            :key="opt.value"
                            class="size-opt"
                            :class="{active: size === opt.value}"
                            @click.stop="pickSize(opt.value)"
                        >
                            <div class="size-opt-box" :style="{width: opt.boxW + 'px', height: opt.boxH + 'px'}" />
                            <span class="size-opt-label">{{ opt.label }}</span>
                        </div>
                    </div>
                </Teleport>
                <!-- Size badge (bottom-left) — clickable, opens the same picker
                     the top-right grid icon does. The icon was the only entry
                     point and was missed by users clicking the badge directly. -->
                <button
                    type="button"
                    class="card-size-badge"
                    :aria-label="`Change size, currently ${size}`"
                    :aria-pressed="sizePickerOpen"
                    @click.stop="toggleSizePicker"
                >{{ size }}</button>
                <!-- Resize grip (bottom-right) -->
                <div class="card-grip" @pointerdown.stop.prevent="startResize" @dragstart.stop.prevent />
            </div>
        </template>

        <!-- Icon badge -->
        <div class="ec-icon">
            <i v-if="icon?.startsWith('fa')" :class="icon" />
        </div>

        <!-- Status badges (battery, offline) -->
        <slot name="badges" />

        <!-- Value zone — type-specific content (hero cards skip ec-val wrapper) -->
        <div v-if="size !== '2x2'" class="ec-val" :class="[{'ec-val-center': size === '1x1'}, valClass]">
            <slot />
        </div>
        <slot v-else />

        <!-- Button zone (ON/OFF toggle) -->
        <div class="ec-btn-zone" v-if="$slots.toggle && !editMode">
            <slot name="toggle" />
        </div>

        <!-- Footer zone (hero stats etc.) -->
        <slot name="footer" />

        <!-- Card name -->
        <div class="ec-name">{{ name }}</div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {normalizeCardType} from '@/helpers/card-accents';
import {getObsLevel, trackInteraction} from '@/tools/observability';

const props = withDefaults(
    defineProps<{
        type: string;
        name: string;
        icon?: string;
        size?: '1x1' | '2x1' | '2x2';
        isOn?: boolean;
        isOffline?: boolean;
        isSleeping?: boolean;
        isLoading?: boolean;
        isWarning?: boolean;
        editMode?: boolean;
        selected?: boolean;
        configurable?: boolean;
        extraClass?: string | Record<string, boolean>;
        valClass?: string | Record<string, boolean>;
        cardStyle?: Record<string, string>;
    }>(),
    {
        size: '1x1',
        icon: '',
        isOn: false,
        isOffline: false,
        isSleeping: false,
        isLoading: false,
        isWarning: false,
        editMode: false,
        selected: false,
        configurable: false,
        extraClass: '',
        valClass: '',
        cardStyle: () => ({})
    }
);

const emit = defineEmits<{
    'open-detail': [];
    'cycle-size': [];
    resize: [size: '1x1' | '2x1' | '2x2'];
    delete: [];
    move: [direction: number];
    configure: [];
    'drag-start': [e: DragEvent];
    'drag-end': [e: DragEvent];
    'drag-over': [e: DragEvent];
    'drag-leave': [e: DragEvent];
    drop: [e: DragEvent];
    select: [e: MouseEvent];
}>();

/* ── Size picker popover ── */
const cardEl = ref<HTMLElement | null>(null);
const sizePickerOpen = ref(false);
const sizePickerEl = ref<HTMLElement | null>(null);

const sizePickerStyle = computed(() => {
    if (!cardEl.value || !sizePickerOpen.value) return {};
    const rect = cardEl.value.getBoundingClientRect();
    return {
        position: 'fixed' as const,
        top: `${rect.top + 36}px`,
        right: `${window.innerWidth - rect.right + 6}px`,
        zIndex: 300
    };
});

const sizeOptions: {
    value: '1x1' | '2x1' | '2x2';
    label: string;
    boxW: number;
    boxH: number;
}[] = [
    {value: '1x1', label: '1\u00d71', boxW: 16, boxH: 16},
    {value: '2x1', label: '2\u00d71', boxW: 28, boxH: 14},
    {value: '2x2', label: '2\u00d72', boxW: 28, boxH: 28}
];

function toggleSizePicker() {
    sizePickerOpen.value = !sizePickerOpen.value;
}

function pickSize(newSize: '1x1' | '2x1' | '2x2') {
    sizePickerOpen.value = false;
    if (newSize !== props.size) {
        emit('resize', newSize);
    }
}

function onClickOutside(e: MouseEvent) {
    if (
        sizePickerOpen.value &&
        sizePickerEl.value &&
        !sizePickerEl.value.contains(e.target as Node)
    ) {
        sizePickerOpen.value = false;
    }
}

// Close picker when leaving edit mode
watch(
    () => props.editMode,
    (val) => {
        if (!val) sizePickerOpen.value = false;
    }
);

let resizeCleanup: (() => void) | undefined;

onMounted(() => {
    document.addEventListener('click', onClickOutside, true);
});

onBeforeUnmount(() => {
    document.removeEventListener('click', onClickOutside, true);
    resizeCleanup?.();
});

function calcResizeTarget(
    dx: number,
    dy: number,
    current: string
): '1x1' | '2x1' | '2x2' {
    if (current === '1x1') {
        if (dx > 60 && dy > 60) return '2x2';
        if (dx > 60) return '2x1';
    } else if (current === '2x1') {
        if (dy > 60) return '2x2';
        if (dx < -60) return '1x1';
    } else if (current === '2x2') {
        if (dx < -60 && dy < -60) return '1x1';
        if (dx < -60 || dy < -60) return '2x1';
    }
    return current as '1x1' | '2x1' | '2x2';
}

function startResize(e: PointerEvent) {
    resizeCleanup?.();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const currentSize = props.size || '1x1';

    // Create ghost preview element
    const card = cardEl.value;
    const grid = card?.parentElement;
    let ghost: HTMLElement | null = null;
    if (card && grid) {
        ghost = document.createElement('div');
        ghost.className = 'resize-ghost';
        const rect = card.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        ghost.style.top = `${rect.top - gridRect.top}px`;
        ghost.style.left = `${rect.left - gridRect.left}px`;
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        grid.style.position = 'relative';
        grid.appendChild(ghost);
    }

    const cellSize = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(
            '--grid-cell'
        ) || '200', 10
    );
    const gapSize = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(
            '--card-grid-gap'
        ) || '14', 10
    );

    function sizeToPixels(sz: string): {w: number; h: number} {
        switch (sz) {
            case '2x1':
                return {w: cellSize * 2 + gapSize, h: cellSize};
            case '2x2':
                return {w: cellSize * 2 + gapSize, h: cellSize * 2 + gapSize};
            default:
                return {w: cellSize, h: cellSize};
        }
    }

    let lastPreview = currentSize;

    function onMove(ev: PointerEvent) {
        ev.preventDefault();
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const preview = calcResizeTarget(dx, dy, currentSize);
        if (ghost && preview !== lastPreview) {
            lastPreview = preview;
            const {w, h} = sizeToPixels(preview);
            ghost.style.width = `${w}px`;
            ghost.style.height = `${h}px`;
            ghost.dataset.size = preview;
        }
    }

    function cleanup() {
        ghost?.remove();
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        resizeCleanup = undefined;
    }

    function onUp(ev: PointerEvent) {
        el.releasePointerCapture(ev.pointerId);
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const newSize = calcResizeTarget(dx, dy, currentSize);
        cleanup();
        if (newSize !== currentSize) {
            emit('resize', newSize);
        }
    }

    document.addEventListener('pointermove', onMove, {passive: false});
    document.addEventListener('pointerup', onUp);
    resizeCleanup = cleanup;
}

function onKeydown(e: KeyboardEvent) {
    if (props.editMode) {
        // Reorder via arrow keys is disabled along with drag-to-move.
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            emit('delete');
        }
        return;
    }
    if (e.key === 'Enter') {
        if (getObsLevel() >= 2) trackInteraction('card', 'click', props.type);
        emit('open-detail');
    }
}

function onCardClick(e: MouseEvent) {
    if (props.editMode) {
        if (e.ctrlKey || e.metaKey || e.shiftKey) emit('select', e);
        return;
    }
    if (getObsLevel() >= 2) trackInteraction('card', 'click', props.type);
    emit('open-detail');
}

const normalizedType = computed(() => normalizeCardType(props.type));

const sizeClass = computed(() => ({
    'ec-wide': props.size === '2x1',
    'ec-hero': props.size === '2x2'
}));

const stateClasses = computed(() => ({
    'is-on': props.isOn,
    'is-offline': props.isOffline,
    'is-sleeping': props.isSleeping,
    'is-loading': props.isLoading,
    'is-warning': props.isWarning,
    'ec-selected': props.selected
}));
</script>

