// SVG transform attribute → 2D affine matrix, plus point/line application.
//
// We carry the matrix in row form `[a, b, c, d, e, f]` matching SVG's own:
//
//   | a c e |
//   | b d f |
//   | 0 0 1 |
//
// Point (x, y, 1) maps to (a·x + c·y + e, b·x + d·y + f).

export type Matrix2D = readonly [
    number,
    number,
    number,
    number,
    number,
    number
];

export type Point = readonly [number, number];

export const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

// ───── application ─────────────────────────────────────────────────────

export function applyMatrixToPoint(m: Matrix2D, p: Point): Point {
    return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

// ───── composition ─────────────────────────────────────────────────────

// outer ∘ inner — applies `inner` first, then `outer`. Same convention as
// SVG: in `transform="A B"`, A is the outer transform applied to the result
// of B.
export function composeMatrices(outer: Matrix2D, inner: Matrix2D): Matrix2D {
    return [
        outer[0] * inner[0] + outer[2] * inner[1],
        outer[1] * inner[0] + outer[3] * inner[1],
        outer[0] * inner[2] + outer[2] * inner[3],
        outer[1] * inner[2] + outer[3] * inner[3],
        outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
        outer[1] * inner[4] + outer[3] * inner[5] + outer[5]
    ];
}

// ───── primitive transforms ────────────────────────────────────────────

export function translate(tx: number, ty: number): Matrix2D {
    return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy: number): Matrix2D {
    return [sx, 0, 0, sy, 0, 0];
}

export function rotate(degrees: number): Matrix2D {
    const r = (degrees * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return [c, s, -s, c, 0, 0];
}

// ───── string parsing ──────────────────────────────────────────────────

// Parse the full `transform` attribute string into a single matrix. Multiple
// transforms compose right-to-left so `translate(10,0) rotate(45)` rotates
// the point first, then translates.
export function parseTransformAttribute(attr: string): Matrix2D {
    let result: Matrix2D = IDENTITY_MATRIX;
    for (const op of tokenizeTransformOps(attr)) {
        result = composeMatrices(result, opToMatrix(op));
    }
    return result;
}

interface TransformOp {
    name: string;
    args: readonly number[];
}

// `translate(10, 20) rotate(45)` → [{name:'translate', args:[10,20]}, {name:'rotate', args:[45]}]
function tokenizeTransformOps(attr: string): TransformOp[] {
    const ops: TransformOp[] = [];
    const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
    let match: RegExpExecArray | null = re.exec(attr);
    while (match !== null) {
        const args = match[2]
            .split(/[\s,]+/)
            .filter((s) => s.length > 0)
            .map(Number)
            .filter(Number.isFinite);
        ops.push({name: match[1], args});
        match = re.exec(attr);
    }
    return ops;
}

// Dispatch table — adding a new transform name is one entry, no branching.
const OP_TABLE: Record<string, (args: readonly number[]) => Matrix2D> = {
    matrix: (a) =>
        a.length >= 6 ? [a[0], a[1], a[2], a[3], a[4], a[5]] : IDENTITY_MATRIX,
    translate: (a) => translate(a[0] ?? 0, a[1] ?? 0),
    scale: (a) => scale(a[0] ?? 1, a[1] ?? a[0] ?? 1),
    rotate: (a) => rotateAround(a[0] ?? 0, {cx: a[1] ?? 0, cy: a[2] ?? 0}),
    skewX: (a) => [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0],
    skewY: (a) => [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]
};

function opToMatrix(op: TransformOp): Matrix2D {
    const builder = OP_TABLE[op.name];
    return builder ? builder(op.args) : IDENTITY_MATRIX;
}

// SVG `rotate(angle cx cy)` = translate(cx,cy) ∘ rotate(angle) ∘ translate(-cx,-cy).
// Plain `rotate(angle)` collapses to a single rotation about the origin.
function rotateAround(
    angle: number,
    center: {cx: number; cy: number}
): Matrix2D {
    if (center.cx === 0 && center.cy === 0) return rotate(angle);
    return composeMatrices(
        composeMatrices(translate(center.cx, center.cy), rotate(angle)),
        translate(-center.cx, -center.cy)
    );
}
