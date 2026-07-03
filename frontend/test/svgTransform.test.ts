// 4-tier coverage for SVG transform parsing + matrix math.
//   UNIT — primitive matrices, application, compose semantics
//   INTEGRATION — parseTransformAttribute composes multiple ops correctly
//   SYSTEM — Qt + Inkscape-shaped transform strings produce expected points
//   REGRESSION — empty / unknown / malformed inputs degrade to identity

import {describe, expect, it} from 'vitest';
import {
    applyMatrixToPoint,
    composeMatrices,
    IDENTITY_MATRIX,
    parseTransformAttribute,
    rotate,
    scale,
    translate
} from '@/helpers/svg-transform';

function pointCloseTo(actual: readonly number[], expected: readonly number[]) {
    expect(actual[0]).toBeCloseTo(expected[0], 5);
    expect(actual[1]).toBeCloseTo(expected[1], 5);
}

// ─── UNIT — primitives ───

describe('matrix primitives', () => {
    it('translate moves a point by (tx, ty)', () => {
        pointCloseTo(applyMatrixToPoint(translate(10, 5), [1, 2]), [11, 7]);
    });

    it('uniform scale multiplies both axes', () => {
        pointCloseTo(applyMatrixToPoint(scale(2, 2), [3, 4]), [6, 8]);
    });

    it('non-uniform scale handles axes independently', () => {
        pointCloseTo(applyMatrixToPoint(scale(2, 0.5), [4, 4]), [8, 2]);
    });

    it('rotate(90) maps (1,0) to (0,1)', () => {
        pointCloseTo(applyMatrixToPoint(rotate(90), [1, 0]), [0, 1]);
    });

    it('identity leaves the point untouched', () => {
        pointCloseTo(
            applyMatrixToPoint(IDENTITY_MATRIX, [3.14, 2.72]),
            [3.14, 2.72]
        );
    });
});

// ─── INTEGRATION — compose ───

describe('composeMatrices', () => {
    it('A ∘ B applies B first, then A', () => {
        const out = composeMatrices(translate(10, 0), rotate(90));
        // (1,0) rotated → (0,1), then translated → (10,1).
        pointCloseTo(applyMatrixToPoint(out, [1, 0]), [10, 1]);
    });

    it('identity is the right neutral element', () => {
        const m = translate(5, 7);
        pointCloseTo(
            applyMatrixToPoint(composeMatrices(m, IDENTITY_MATRIX), [1, 1]),
            applyMatrixToPoint(m, [1, 1])
        );
    });

    it('identity is the left neutral element', () => {
        const m = scale(3, 3);
        pointCloseTo(
            applyMatrixToPoint(composeMatrices(IDENTITY_MATRIX, m), [1, 1]),
            applyMatrixToPoint(m, [1, 1])
        );
    });
});

// ─── INTEGRATION — string parsing ───

describe('parseTransformAttribute', () => {
    it('parses a single scale()', () => {
        pointCloseTo(
            applyMatrixToPoint(
                parseTransformAttribute('scale(0.5)'),
                [100, 100]
            ),
            [50, 50]
        );
    });

    it('parses translate() with two arguments', () => {
        pointCloseTo(
            applyMatrixToPoint(
                parseTransformAttribute('translate(10, 20)'),
                [0, 0]
            ),
            [10, 20]
        );
    });

    it('parses matrix() directly', () => {
        // matrix(1,0,0,1,10,20) is just translate(10,20).
        pointCloseTo(
            applyMatrixToPoint(
                parseTransformAttribute('matrix(1, 0, 0, 1, 10, 20)'),
                [3, 4]
            ),
            [13, 24]
        );
    });

    it('composes multiple ops left-to-right', () => {
        // translate first, then scale. SVG applies right-to-left so:
        //   point → scale(2) → translate(5,0)
        // (1,1) → (2,2) → (7,2).
        pointCloseTo(
            applyMatrixToPoint(
                parseTransformAttribute('translate(5,0) scale(2)'),
                [1, 1]
            ),
            [7, 2]
        );
    });

    it('handles rotate(angle cx cy) around an arbitrary centre', () => {
        // Rotate 180° about (10, 10) → reflects through that point.
        pointCloseTo(
            applyMatrixToPoint(
                parseTransformAttribute('rotate(180 10 10)'),
                [0, 0]
            ),
            [20, 20]
        );
    });
});

// ─── SYSTEM — real-world transform strings ───

describe('parseTransformAttribute — real-world shapes', () => {
    it('Qt scale(0.75) — the actual format Qt emits', () => {
        pointCloseTo(
            applyMatrixToPoint(
                parseTransformAttribute('scale(0.75)'),
                [200, 400]
            ),
            [150, 300]
        );
    });

    it('Inkscape matrix(0.75,0,0,0.75,-7.5,0) — translated + scaled layer', () => {
        pointCloseTo(
            applyMatrixToPoint(
                parseTransformAttribute('matrix(0.75,0,0,0.75,-7.5,0)'),
                [10, 0]
            ),
            [0, 0]
        );
    });
});

// ─── INTEGRATION — three-way compose chains ───

describe('parseTransformAttribute — three-way composes', () => {
    it('translate ∘ rotate ∘ translate puts the rotation centre at the inner translate', () => {
        // rotate(90, 10, 10) = translate(10,10) · rotate(90) · translate(-10,-10)
        // so the same string spelled out the long way should match it.
        const a = parseTransformAttribute(
            'translate(10,10) rotate(90) translate(-10,-10)'
        );
        const b = parseTransformAttribute('rotate(90 10 10)');
        // Test a few points — algebraic equality is unreliable due to fp noise.
        for (const pt of [
            [0, 0],
            [20, 0],
            [10, 5],
            [-5, -5]
        ] as const) {
            const pa = applyMatrixToPoint(a, pt);
            const pb = applyMatrixToPoint(b, pt);
            pointCloseTo(pa, pb);
        }
    });

    it('scale ∘ scale multiplies the scale factors', () => {
        pointCloseTo(
            applyMatrixToPoint(
                parseTransformAttribute('scale(2) scale(3)'),
                [1, 1]
            ),
            [6, 6]
        );
    });

    it('rotate(180) twice returns to identity', () => {
        pointCloseTo(
            applyMatrixToPoint(
                parseTransformAttribute('rotate(180) rotate(180)'),
                [3, 5]
            ),
            [3, 5]
        );
    });
});

// ─── REGRESSION — guards ───

describe('parseTransformAttribute — guards', () => {
    it('empty string yields identity', () => {
        pointCloseTo(
            applyMatrixToPoint(parseTransformAttribute(''), [1, 2]),
            [1, 2]
        );
    });

    it('unknown op names are ignored, not crashed on', () => {
        // 'bogus' has no entry in the dispatch table; it should resolve to
        // identity and leave the surrounding ops intact.
        pointCloseTo(
            applyMatrixToPoint(
                parseTransformAttribute('translate(5,5) bogus(1,2) scale(2)'),
                [1, 1]
            ),
            [7, 7]
        );
    });

    it('malformed args ignored', () => {
        // scale() with no args → identity.
        pointCloseTo(
            applyMatrixToPoint(parseTransformAttribute('scale()'), [3, 4]),
            [3, 4]
        );
    });
});
