// 4-tier coverage for the SVG floor-plan wall parser.
//   UNIT — each predicate / tokenizer behaviour in isolation
//   INTEGRATION — full parseSvgFloorPlan returning bbox + walls
//   SYSTEM — Qt-generated floor plan shape (the real producer of our SVGs)
//   REGRESSION — pathological inputs never crash, never lie about bbox

import {describe, expect, it} from 'vitest';
import {parseSvgFloorPlan} from '@/helpers/svg-walls';

// jsdom doesn't ship DOMParser for image/svg+xml by default; the helper uses
// it directly, so tests run only when the global is present.
function svg(body: string, attrs = 'width="100" height="100"'): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
}

// Builds a rectangular wall — both axes present so bbox is 2D and the
// parser doesn't refuse a degenerate single-axis input.
const RECT = 'M 0,0 H 100 V 50 H 0 V 0';

// ─── UNIT — single solid path ───

describe('parseSvgFloorPlan — solid stroke', () => {
    it('extracts 4 segments from a closed rectangle', () => {
        const out = parseSvgFloorPlan(
            svg(`<path stroke="#000" d="${RECT}" />`)
        );
        expect(out).not.toBeNull();
        expect(out!.walls).toHaveLength(4);
    });

    it('returns the bbox of the parsed walls, translated to origin', () => {
        const out = parseSvgFloorPlan(
            svg('<path stroke="#000" d="M 10,20 H 110 V 90 H 10 V 20" />')
        );
        expect(out!.width).toBe(100);
        expect(out!.height).toBe(70);
        // First segment used to start at (10,20); translated to bbox-min.
        expect(out!.walls[0].from).toEqual([0, 0]);
    });
});

// ─── UNIT — filters ───

describe('parseSvgFloorPlan — filters', () => {
    it('skips dashed strokes (dimension lines)', () => {
        const out = parseSvgFloorPlan(
            svg(
                `<path stroke="#000" stroke-dasharray="4,2" d="${RECT}" />` +
                    `<path stroke="#000" d="M 5,5 H 50 V 45 H 5 V 5" />`
            )
        );
        // Only the solid rectangle is kept → 4 segments.
        expect(out!.walls).toHaveLength(4);
    });

    it('skips a path whose ancestor group is dashed', () => {
        const out = parseSvgFloorPlan(
            svg(
                `<g stroke-dasharray="4,2"><path stroke="#000" d="${RECT}" /></g>` +
                    `<path stroke="#000" d="M 5,5 H 50 V 45 H 5 V 5" />`
            )
        );
        expect(out!.walls).toHaveLength(4);
    });

    it('drops sub-threshold segments (< 5 units)', () => {
        const out = parseSvgFloorPlan(
            svg('<path stroke="#000" d="M 0,0 H 3 H 100 V 50 H 0 V 0" />')
        );
        // 3-unit jog is filtered; the rest of the rectangle survives.
        expect(out!.walls).toHaveLength(4);
    });
});

// ─── UNIT — transforms ───

describe('parseSvgFloorPlan — accumulated scale', () => {
    it('multiplies uniform scale() from parent groups', () => {
        const out = parseSvgFloorPlan(
            svg(
                '<g transform="scale(0.5)">' +
                    `<path stroke="#000" d="M 0,0 H 200 V 100 H 0 V 0" />` +
                    '</g>'
            )
        );
        // 200-unit path × 0.5 scale → bbox width 100.
        expect(out!.width).toBe(100);
        expect(out!.height).toBe(50);
    });
});

// ─── INTEGRATION — close path + multiple segments ───

describe('parseSvgFloorPlan — path command coverage', () => {
    it('closes the polygon when Z is present', () => {
        const out = parseSvgFloorPlan(
            svg('<path stroke="#000" d="M 0,0 H 100 V 100 Z" />')
        );
        // M(0,0) → H 100 (seg 1) → V 100 (seg 2) → Z back to (0,0) (seg 3)
        expect(out!.walls).toHaveLength(3);
    });

    it('handles lowercase relative commands', () => {
        const out = parseSvgFloorPlan(
            svg('<path stroke="#000" d="M 10,10 h 50 v 50" />')
        );
        // 10,10 → 60,10 → 60,60. Two segments.
        expect(out!.walls).toHaveLength(2);
    });
});

// ─── SYSTEM — Qt-generated floor plan shape ───

describe('parseSvgFloorPlan — Qt-shaped SVG', () => {
    it('extracts a rectangular room from a Qt-style export', () => {
        const out = parseSvgFloorPlan(
            svg(
                '<g style="display:inline" id="layer1">' +
                    '<g fill="none" stroke="#000" stroke-width="1" transform="scale(0.75)">' +
                    '<path fill-rule="evenodd" d="M 220,150 H 330 V 90 H 220 V 150" />' +
                    '</g></g>'
            )
        );
        expect(out!.walls.length).toBeGreaterThanOrEqual(4);
        // After the 0.75 transform: bbox spans 165..247.5 X, 67.5..112.5 Y.
        // Translated to origin: width 82.5, height 45.
        expect(out!.width).toBeCloseTo(82.5, 1);
        expect(out!.height).toBeCloseTo(45, 1);
    });
});

// ─── INTEGRATION — curve commands sampled to polyline ───

describe('parseSvgFloorPlan — curve commands', () => {
    it('cubic bezier C sampled into multiple straight segments', () => {
        // Closed quad-ish via one cubic and a straight return.
        const out = parseSvgFloorPlan(
            svg('<path stroke="#000" d="M 0,0 C 0,100 100,100 100,0 L 0,0" />')
        );
        // 8 samples from C + 1 from L = at least 9 segments.
        expect(out!.walls.length).toBeGreaterThanOrEqual(9);
    });

    it('quadratic bezier Q sampled into multiple straight segments', () => {
        const out = parseSvgFloorPlan(
            svg('<path stroke="#000" d="M 0,0 Q 50,100 100,0 L 0,0" />')
        );
        expect(out!.walls.length).toBeGreaterThanOrEqual(9);
    });
});

// ─── REGRESSION — never crash, never lie ───

describe('parseSvgFloorPlan — guards', () => {
    it('returns null when the SVG has no paths', () => {
        expect(parseSvgFloorPlan(svg(''))).toBeNull();
    });

    it('returns null when all paths are dashed', () => {
        expect(
            parseSvgFloorPlan(
                svg(
                    '<path stroke="#000" stroke-dasharray="4,2" d="M 0,0 H 100" />'
                )
            )
        ).toBeNull();
    });

    it('returns null when bbox would collapse to zero', () => {
        // Single point — segments < MIN_SEGMENT_LEN are filtered, bbox empty.
        expect(
            parseSvgFloorPlan(
                svg('<path stroke="#000" d="M 50,50 H 50 V 50" />')
            )
        ).toBeNull();
    });

    it('does not throw on unsupported curve commands (silently skipped)', () => {
        expect(() =>
            parseSvgFloorPlan(
                svg(
                    '<path stroke="#000" d="M 0,0 C 10,10 20,20 30,30 H 100" />'
                )
            )
        ).not.toThrow();
    });

    it('returns null for non-svg input', () => {
        expect(
            parseSvgFloorPlan('<html><body>not svg</body></html>')
        ).toBeNull();
    });
});
