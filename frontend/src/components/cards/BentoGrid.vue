<template>
    <div ref="gridRef" :class="['bento-grid', 'grid-stack', { editing: editing }]" @keydown="handleGridKeydown" @focusin="handleCardFocus">
        <slot />
    </div>
    <div ref="sentinel" class="bento-sentinel" v-if="hasMore" />
    <div id="card-popover-target" />
</template>

<script setup lang="ts">
import {nextTick, onMounted, onUnmounted, ref, watch} from 'vue';
import {
    createDashboardGrid,
    type DashboardGridHandle,
    type GridMove
} from '@/composables/useDashboardGrid';

const props = defineProps<{
    hasMore: boolean;
    editing?: boolean;
}>();

const emit = defineEmits<{
    'load-more': [];
    'card-activate': [index: number];
    'layout-change': [moves: GridMove[]];
}>();

const gridRef = ref<HTMLElement | null>(null);

// Expose the grid element so the parent can attach observers.
defineExpose({gridEl: gridRef});

// ── GridStack ──
let grid: DashboardGridHandle | null = null;

function startGrid() {
    if (grid || !gridRef.value) return;
    grid = createDashboardGrid({
        container: gridRef.value,
        movable: Boolean(props.editing),
        onMoved: (moves) => emit('layout-change', moves)
    });
}

// Dragging is offered only in edit mode, so a stray drag cannot silently
// rearrange a dashboard someone is only reading.
watch(
    () => props.editing,
    (editing) => grid?.setMovable(Boolean(editing))
);

function handleWindowResize() {
    grid?.refresh();
}
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

// ── Keyboard navigation ──
const focusedIndex = ref(-1);

// Cards now sit one level deeper, inside the GridStack item wrapper.
function getCards(): HTMLElement[] {
    if (!gridRef.value) return [];
    return Array.from(
        gridRef.value.querySelectorAll<HTMLElement>(
            '.grid-stack-item-content > [tabindex], .grid-stack-item-content > .ec, .grid-stack-item-content > .dc, .grid-stack-item-content > .gc, .grid-stack-item-content > .ac, .grid-stack-item-content > .wc'
        )
    );
}

function getColumnsCount(): number {
    if (!gridRef.value) return 1;
    const style = getComputedStyle(gridRef.value);
    const cols = style.gridTemplateColumns.split(' ').length;
    return Math.max(1, cols);
}

function focusCard(idx: number) {
    const cards = getCards();
    if (idx < 0 || idx >= cards.length) return;
    focusedIndex.value = idx;
    cards[idx].focus({preventScroll: false});
    cards[idx].scrollIntoView({block: 'nearest', behavior: 'smooth'});
}

function handleGridKeydown(e: KeyboardEvent) {
    const cards = getCards();
    if (!cards.length) return;

    const current = focusedIndex.value >= 0 ? focusedIndex.value : 0;
    const cols = getColumnsCount();

    switch (e.key) {
        case 'ArrowRight': {
            e.preventDefault();
            focusCard(Math.min(current + 1, cards.length - 1));
            break;
        }
        case 'ArrowLeft': {
            e.preventDefault();
            focusCard(Math.max(current - 1, 0));
            break;
        }
        case 'ArrowDown': {
            e.preventDefault();
            focusCard(Math.min(current + cols, cards.length - 1));
            break;
        }
        case 'ArrowUp': {
            e.preventDefault();
            focusCard(Math.max(current - cols, 0));
            break;
        }
        case 'Home': {
            e.preventDefault();
            focusCard(0);
            break;
        }
        case 'End': {
            e.preventDefault();
            focusCard(cards.length - 1);
            break;
        }
    }
}

function handleCardFocus(e: FocusEvent) {
    const cards = getCards();
    const idx = cards.indexOf(e.target as HTMLElement);
    if (idx >= 0) focusedIndex.value = idx;
}

function resolveScrollOwner() {
    return (
        gridRef.value?.closest<HTMLElement>('[data-scroll-owner="page"]') ??
        null
    );
}

function setupObserver() {
    if (!sentinel.value) return;

    observer?.disconnect();
    observer = new IntersectionObserver(
        (entries) => {
            if (entries[0]?.isIntersecting && props.hasMore) {
                emit('load-more');
            }
        },
        {
            root: resolveScrollOwner(),
            rootMargin: '0px 0px 400px 0px'
        }
    );
    observer.observe(sentinel.value);
}

onMounted(async () => {
    setupObserver();
    // Items are rendered by Vue first; GridStack only adopts what is there.
    await nextTick();
    startGrid();
    window.addEventListener('resize', handleWindowResize);
});

// Re-attach observer when sentinel reappears (hasMore toggled back to true)
watch(sentinel, (el) => {
    if (el) setupObserver();
});

onUnmounted(() => {
    observer?.disconnect();
    window.removeEventListener('resize', handleWindowResize);
    grid?.destroy();
    grid = null;
});
</script>

<style scoped>
.bento-sentinel {
    height: 1px;
}

/* Content-visibility is dropped with the CSS grid: GridStack positions items
   absolutely and needs their real height to place neighbours, so skipping
   off-screen layout would collapse the grid. */

/* Cell/gap sizing lives in styles/cards/card-base.css (responsive
   --grid-cell / --card-grid-gap overrides) — a global home so the bare
   .bento-grid loading skeleton adapts too, which scoped styles cannot reach.
   The grid engine reads the same two properties at runtime. */
.bento-grid {
    padding: var(--space-2);
}
</style>
