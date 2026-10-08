export type ProjectionTransform =
    | {kind: 'none'}
    | {kind: 'scale'; factor: number}
    | {kind: 'offset'; offset: number}
    | {kind: 'invert'}
    | {kind: 'enum_map'; mapping: Readonly<Record<string, string>>};

export function applyTransform(
    value: unknown,
    transform: ProjectionTransform
): {value: unknown} | {skip: true} {
    switch (transform.kind) {
        case 'none':
            return {value};
        case 'scale':
            return numericTransform(
                value,
                (number) => number * transform.factor,
                transform.factor
            );
        case 'offset':
            return numericTransform(
                value,
                (number) => number + transform.offset,
                transform.offset
            );
        case 'invert':
            return typeof value === 'boolean' ? {value: !value} : {skip: true};
        case 'enum_map': {
            if (typeof value !== 'string') return {skip: true};
            const mapped = transform.mapping[value];
            return mapped === undefined ? {skip: true} : {value: mapped};
        }
    }
}

export function parseTransform(raw: unknown): ProjectionTransform {
    if (!raw || typeof raw !== 'object') return {kind: 'none'};
    const obj = raw as Record<string, unknown>;
    switch (obj.kind) {
        case 'scale':
            return typeof obj.factor === 'number' && Number.isFinite(obj.factor)
                ? {kind: 'scale', factor: obj.factor}
                : {kind: 'none'};
        case 'offset':
            return typeof obj.offset === 'number' && Number.isFinite(obj.offset)
                ? {kind: 'offset', offset: obj.offset}
                : {kind: 'none'};
        case 'invert':
            return {kind: 'invert'};
        case 'enum_map': {
            const mapping = sanitizeEnumMapping(obj.mapping);
            return mapping ? {kind: 'enum_map', mapping} : {kind: 'none'};
        }
        default:
            return {kind: 'none'};
    }
}

function numericTransform(
    value: unknown,
    op: (number: number) => number,
    operand: number
): {value: unknown} | {skip: true} {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return {skip: true};
    }
    if (!Number.isFinite(operand)) return {skip: true};
    const result = op(value);
    return Number.isFinite(result) ? {value: result} : {skip: true};
}

function sanitizeEnumMapping(raw: unknown): Record<string, string> | null {
    if (!raw || typeof raw !== 'object') return null;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value !== 'string') return null;
        out[key] = value;
    }
    return out;
}
