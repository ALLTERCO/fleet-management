/**
 * One matcher for every search box in the app — and, from here in core,
 * every custom UI's own search boxes too: this lives in core because
 * template-host may never import Fleet code, while the app is free to
 * import core (`@/helpers/searchMatch` re-exports this file unchanged).
 *
 * It forgives a fast typist: the query's letters only have to appear in order,
 * so "tarif" and "utl acc" still find "Utility accounting". Exact hits still
 * win the ranking, so the obvious answer stays on top. A candidate may carry
 * keywords, which let a page answer to words nobody put in its name.
 */

/** A run of letters in the label that the query matched. */
export interface SearchRange {
    from: number;
    /** Exclusive, so `label.slice(from, to)` is the matched run. */
    to: number;
}

export interface SearchCandidate<T> {
    value: T;
    label: string;
    /** Words this candidate also answers to, never shown as the name. */
    keywords?: readonly string[];
    /**
     * Match only what the person actually typed. Set it for identifiers: a
     * device name, a MAC, a serial, a store code. Forgiving a typo there turns
     * one wrong digit into a list of wrong devices, which is worse than an
     * empty result.
     */
    exact?: boolean;
}

export interface SearchHit<T> {
    item: SearchCandidate<T>;
    /** Higher is a better answer. Only meaningful against the same query. */
    score: number;
    /** Where to bold the label. Empty when only a keyword matched. */
    labelRanges: SearchRange[];
    /** The keyword that matched, when the label did not. */
    matchedKeyword?: string;
}

// A label match beats a keyword match, and within each the tighter kind of
// match beats the looser one. The gaps leave room for the position bonus.
const SCORE_LABEL_PREFIX = 1000;
const SCORE_LABEL_SUBSTRING = 800;
const SCORE_LABEL_SCATTERED = 600;
const SCORE_KEYWORD_PREFIX = 400;
const SCORE_KEYWORD_SUBSTRING = 300;
const SCORE_KEYWORD_SCATTERED = 200;

/** True at the start of the text or straight after a separator. */
function startsWord(text: string, at: number): boolean {
    return at === 0 || /[\s\-_/.]/.test(text[at - 1]);
}

/** A space matches anything, so "utl acc" reads as one run of letters. */
function normalise(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, '');
}

// Below this a query carries no signal: three letters walk straight through
// an unrelated word, so "dsa" would find "destination". Short queries match
// only what is really written.
const SCATTER_MIN_QUERY = 4;

// A typo drops or swaps a letter; it does not scatter letters across a whole
// phrase. Anything longer than this much of a run is somebody else's word.
const SCATTER_SPAN_ALLOWANCE = 5;
const SCATTER_SPAN_FACTOR = 2;

/**
 * Where each query letter landed, or null when the letters are missing, out of
 * order, started mid-word, or spread too thin to be a typo. Without those last
 * two rules "ale" finds "locale" and "logical meter", which is noise.
 */
function scatteredRanges(query: string, text: string): SearchRange[] | null {
    if (query.length < SCATTER_MIN_QUERY) return null;
    const first = text.indexOf(query[0]);
    if (first === -1) return null;

    for (
        let start = first;
        start !== -1;
        start = text.indexOf(query[0], start + 1)
    ) {
        if (!startsWord(text, start)) continue;
        const ranges = runFrom(query, text, start);
        if (ranges) return ranges;
    }
    return null;
}

/** The letters in order from one starting point, if they fit close enough. */
function runFrom(
    query: string,
    text: string,
    start: number
): SearchRange[] | null {
    const ranges: SearchRange[] = [{from: start, to: start + 1}];
    let at = start + 1;
    for (const letter of query.slice(1)) {
        const found = text.indexOf(letter, at);
        if (found === -1) return null;
        const last = ranges[ranges.length - 1];
        if (last.to === found) last.to = found + 1;
        else ranges.push({from: found, to: found + 1});
        at = found + 1;
    }
    const span = at - start;
    const allowed = query.length * SCATTER_SPAN_FACTOR + SCATTER_SPAN_ALLOWANCE;
    return span <= allowed ? ranges : null;
}

/**
 * Where the query sits in the label, spaces kept so a range points at the real
 * text. It must start a word: "ale" inside "locale" is a letter accident, not
 * something a person searched for.
 */
function substringRanges(
    query: string,
    label: string,
    exact = false
): SearchRange[] | null {
    const lower = label.toLowerCase();
    for (
        let at = lower.indexOf(query);
        at !== -1;
        at = lower.indexOf(query, at + 1)
    ) {
        // An identifier is one run of characters, so a hit anywhere inside it
        // is the person's own typing, not a letter accident in another word.
        if (exact || startsWord(lower, at)) {
            return [{from: at, to: at + query.length}];
        }
    }
    return null;
}

function scoreLabel(
    query: string,
    label: string,
    exact: boolean
): {score: number; ranges: SearchRange[]} | null {
    const plain = substringRanges(query, label, exact);
    if (plain) {
        const kind =
            plain[0].from === 0 ? SCORE_LABEL_PREFIX : SCORE_LABEL_SUBSTRING;
        return {score: kind - plain[0].from, ranges: plain};
    }
    if (exact) return null;
    const scattered = scatteredRanges(query, label.toLowerCase());
    if (!scattered) return null;
    // A tighter run of letters is the better answer, so fewer gaps score higher.
    return {score: SCORE_LABEL_SCATTERED - scattered.length, ranges: scattered};
}

function scoreKeyword(
    query: string,
    keywords: readonly string[],
    exact: boolean
): {score: number; keyword: string} | null {
    let best: {score: number; keyword: string} | null = null;
    for (const keyword of keywords) {
        const lower = keyword.toLowerCase();
        const plain = substringRanges(query, lower, exact);
        let score: number | null = null;
        if (plain?.[0].from === 0) score = SCORE_KEYWORD_PREFIX;
        else if (plain) score = SCORE_KEYWORD_SUBSTRING - plain[0].from;
        else if (!exact && scatteredRanges(query, lower))
            score = SCORE_KEYWORD_SCATTERED;
        if (score !== null && (best === null || score > best.score)) {
            best = {score, keyword};
        }
    }
    return best;
}

/** How well one candidate answers the query, or null when it does not. */
export function matchSearch<T>(
    query: string,
    candidate: SearchCandidate<T>
): SearchHit<T> | null {
    const wanted = normalise(query);
    if (!wanted) return null;

    const exact = candidate.exact === true;
    const label = scoreLabel(wanted, candidate.label, exact);
    if (label) {
        return {item: candidate, score: label.score, labelRanges: label.ranges};
    }

    const keyword = scoreKeyword(wanted, candidate.keywords ?? [], exact);
    if (!keyword) return null;
    return {
        item: candidate,
        score: keyword.score,
        labelRanges: [],
        matchedKeyword: keyword.keyword
    };
}

/** Every candidate that answers the query, best answer first. */
export function rankSearchMatches<T>(
    query: string,
    candidates: readonly SearchCandidate<T>[]
): SearchHit<T>[] {
    return (
        candidates
            .map((candidate, order) => ({
                hit: matchSearch(query, candidate),
                order
            }))
            .filter(
                (entry): entry is {hit: SearchHit<T>; order: number} =>
                    entry.hit !== null
            )
            // Ties keep the order the caller gave, so a curated list stays curated.
            .sort((a, b) => b.hit.score - a.hit.score || a.order - b.order)
            .map((entry) => entry.hit)
    );
}
