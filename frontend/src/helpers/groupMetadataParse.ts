// Pure parsers used by GroupMetadataForm — they ANSWER (validate + parse),
// they don't DO (mutate state). Component setters compose these into the
// side-effecting model update. Keeping the split lets the parsers be
// covered by unit tests without a DOM harness.

export type ParseOk<T> = {ok: true; value: T};
export type ParseFail = {ok: false; error: string};
export type ParseResult<T> = ParseOk<T> | ParseFail;

export type NumericKind = 'integer' | 'number';
export type ArrayItemKind = 'string' | 'integer' | 'number';

const DECIMAL_OR_EXP = /[.eE]/;

export function parseNumericInput(
    raw: string,
    kind: NumericKind
): ParseResult<number> {
    if (kind === 'integer' && DECIMAL_OR_EXP.test(raw)) {
        return {ok: false, error: 'Integer required — no decimals.'};
    }
    const n = kind === 'integer' ? Number.parseInt(raw, 10) : Number(raw);
    if (Number.isNaN(n)) return {ok: false, error: 'Not a valid number.'};
    return {ok: true, value: n};
}

// Items that fail item-type validation are dropped (per the principle:
// frontend is the friendlier filter; backend is the authoritative
// rejector). Empty list returns ok with []; caller decides whether to
// store [] or treat it as cleared.
export function parseCsvArrayInput(
    raw: string,
    itemType: ArrayItemKind
): ParseResult<unknown[]> {
    const trimmed = raw.trim();
    if (trimmed === '') return {ok: true, value: []};
    const parts = trimmed
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (itemType === 'integer') return {ok: true, value: parseIntList(parts)};
    if (itemType === 'number') return {ok: true, value: parseNumberList(parts)};
    return {ok: true, value: parts};
}

function parseIntList(parts: readonly string[]): number[] {
    return parts
        .filter((s) => !DECIMAL_OR_EXP.test(s))
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => !Number.isNaN(n));
}

function parseNumberList(parts: readonly string[]): number[] {
    return parts.map((s) => Number(s)).filter((n) => !Number.isNaN(n));
}
