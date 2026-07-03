<template>
    <div ref="gridRef" :class="['bento-grid', 'grid', { editing: editing }]" @keydown="handleGridKeydown" @focusin="handleCardFocus">
        <slot />
        <div ref="sentinel" class="bento-sentinel" v-if="hasMore" />
    </div>
    <div id="card-popover-target" />
</template>

<script setup lang="ts">
import {onMounted, onUnmounted, ref, watch} from 'vue';

const props = defineProps<{
    hasMore: boolean;
    editing?: boolean;
}>();

const emit = defineEmits<{
    'load-more': [];
    'card-activate': [index: number];
}>();

const gridRef = ref<HTMLElement | null>(null);

// Expose the grid element so the parent can attach useSortable / observers.
defineExpose({gridEl: gridRef});
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

// ── Keyboard navigation ──
const focusedIndex = ref(-1);

function getCards(): HTMLElement[] {
    if (!gridRef.value) return [];
    return Array.from(
        gridRef.value.querySelectorAll<HTMLElement>(
            ':scope > [tabindex], :scope > .ec, :scope > .dc, :scope > .gc, :scope > .ac, :scope > .wc'
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

onMounted(() => {
    setupObserver();
});

// Re-attach observer when sentinel reappears (hasMore toggled back to true)
watch(sentinel, (el) => {
    if (el) setupObserver();
});

onUnmounted(() => {
    observer?.disconnect();
});
</script>

<style scoped>
.bento-sentinel {
    height: 1px;
    grid-column: 1 / -1;
}

/* Content-visibility optimization for off-screen cards */
.bento-grid > :deep(*:not(.bento-sentinel)) {
    content-visibility: auto;
    contain-intrinsic-size: auto var(--grid-cell);
}

/* Hero cards (2×2) need correct intrinsic size hint — 2 rows + gap */
.bento-grid > :deep(.ec-hero) {
    contain-intrinsic-size: auto calc(var(--grid-cell) * 2 + var(--card-grid-gap));
}

/* Wide cards (2×1) — same height as 1×1 but double width */
.bento-grid > :deep(.ec-wide) {
    contain-intrinsic-size: auto var(--grid-cell);
}

/* ── Card grid — fluid cells with 4 breakpoints (4pt rhythm) ── */
.bento-grid {
    --cell: clamp(160px, 18vw, 220px);
    --gap: clamp(8px, 1.5vw, 16px);
    padding: var(--space-2);
}

/* Phones (≤480px): 2 compact columns */
@media (max-width: 480px) {
    .bento-grid { --cell: 152px; --gap: var(--space-2); }
}

/* Small tablets (481–768px) */
@media (min-width: 481px) and (max-width: 768px) {
    .bento-grid { --cell: 172px; --gap: var(--space-3); }
}

/* Tablets / small desktops (769–1200px) */
@media (min-width: 769px) and (max-width: 1200px) {
    .bento-grid { --cell: var(--bento-cell); --gap: var(--bento-gap); }
}

/* Wide desktops (1201px+) */
@media (min-width: 1201px) {
    .bento-grid { --cell: 210px; --gap: var(--space-4); }
}
</style>
