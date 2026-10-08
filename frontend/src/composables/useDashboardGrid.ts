// GridStack ownership for the control dashboard.
//
// Split of responsibility, deliberate: GridStack moves cards, the existing card
// control resizes them. Two systems driving the same gesture is what made drag
// unusable before (see commit 67fe2eaa3, native HTML5 drag fighting SortableJS),
// so resize is left off here rather than wired twice.

import {GridStack, type GridStackNode} from 'gridstack';
// Positioning styles ship with the library; imported here beside the only code
// that creates a grid so the dependency stays in one place.
import 'gridstack/dist/gridstack.min.css';
import type {CardSize} from '@/helpers/widgetCatalog';

/** Where a card sits and how much room it takes. */
export interface GridPlacement {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** One card's footprint, keyed so a move can be matched back to the model. */
export interface GridMove extends GridPlacement {
    id: string;
}

// A CardSize string IS its footprint ('2x1' = two wide, one tall), so parse it
// rather than keep a lookup table that could drift from the vocabulary in
// widgetCatalog or from the CASE in migration 20021.
export function footprintFor(size: CardSize | undefined): {
    w: number;
    h: number;
} {
    const [w, h] = String(size ?? '1x1').split('x').map(Number);
    return {
        w: Number.isFinite(w) && w > 0 ? w : 1,
        h: Number.isFinite(h) && h > 0 ? h : 1
    };
}

/** Read a numeric CSS custom property, falling back when it is absent. */
function readPx(el: HTMLElement, prop: string, fallback: number): number {
    const parsed = Number.parseFloat(
        getComputedStyle(el).getPropertyValue(prop)
    );
    return Number.isFinite(parsed) ? parsed : fallback;
}

/** Columns that fit the container at the current cell size. At least one. */
export function columnsFor(containerWidth: number, cell: number, gap: number) {
    if (containerWidth <= 0 || cell <= 0) return 1;
    return Math.max(1, Math.floor((containerWidth + gap) / (cell + gap)));
}

export interface DashboardGridHandle {
    /** Re-measure and re-lay-out; call on container resize. */
    refresh(): void;
    /** Dragging is only offered while the dashboard is in edit mode. */
    setMovable(movable: boolean): void;
    destroy(): void;
}

export interface DashboardGridOptions {
    container: HTMLElement;
    movable: boolean;
    onMoved(moves: GridMove[]): void;
}

/**
 * Attach GridStack to an element Vue has already rendered.
 *
 * Vue owns the item elements; GridStack is told about them rather than
 * creating them, so a re-render never fights the library for the same nodes.
 */
export function createDashboardGrid(
    options: DashboardGridOptions
): DashboardGridHandle {
    const {container} = options;
    // Cell size and gap are owned by the stylesheet (--grid-cell / --card-grid-gap
    // in card-base.css, with the responsive overrides). Read them so the
    // breakpoints keep one home instead of being restated here.
    const gap = readPx(container, '--card-grid-gap', 12);
    const cell = readPx(container, '--grid-cell', 200);

    const grid = GridStack.init(
        {
            cellHeight: cell,
            margin: gap / 2,
            column: columnsFor(container.clientWidth, cell, gap),
            // Cards settle upward into gaps instead of leaving holes — the
            // behaviour `grid-auto-flow: dense` gave the old CSS grid.
            float: false,
            disableResize: true,
            disableDrag: !options.movable,
            // A long press starts a drag on touch so a tap still activates
            // the card, matching what the previous implementation offered.
            draggable: {handle: '.grid-stack-item-content'}
        },
        container
    );
    // init returns null only when the element is already a grid. Silently
    // carrying on would leave a dashboard that looks draggable and is not.
    if (!grid) {
        throw new Error(
            'GridStack.init returned no grid for the dashboard container'
        );
    }

    grid.on('change', (_event: Event, nodes: GridStackNode[]) => {
        if (!nodes?.length) return;
        const moves = nodes
            .map((n) => ({
                id: String(n.id ?? ''),
                x: n.x ?? 0,
                y: n.y ?? 0,
                w: n.w ?? 1,
                h: n.h ?? 1
            }))
            .filter((m) => m.id !== '');
        if (moves.length) options.onMoved(moves);
    });

    return {
        refresh() {
            // Re-read: a breakpoint change rewrites both custom properties.
            const nextCell = readPx(container, '--grid-cell', 200);
            const nextGap = readPx(container, '--card-grid-gap', 12);
            grid.cellHeight(nextCell);
            grid.margin(nextGap / 2);
            grid.column(columnsFor(container.clientWidth, nextCell, nextGap));
        },
        setMovable(movable: boolean) {
            grid.enableMove(movable);
        },
        destroy() {
            // Leave the DOM to Vue; only detach GridStack's own listeners.
            grid.destroy(false);
        }
    };
}
