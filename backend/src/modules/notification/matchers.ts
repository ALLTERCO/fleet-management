import {envInt} from '../../config/envReader';
import {BoundedMap} from '../boundedMap';
import {readObject, readString, readStringArray} from './rowReaders';

// ReDoS bounds: reject over-long pattern/value before .test().
const REGEX_MAX_PATTERN_LEN = envInt(
    'FM_MATCHER_REGEX_MAX_PATTERN_LEN',
    512,
    1
);
const REGEX_MAX_INPUT_LEN = envInt('FM_MATCHER_REGEX_MAX_INPUT_LEN', 1024, 1);

export interface MatchableResource {
    type: string;
    id: string;
}

// LRU cache of compiled patterns. Reused across alerts so the same rule
// pattern is not recompiled per match. null = invalid pattern (cached so
// we do not re-throw the SyntaxError on every retry).
const REGEX_CACHE_MAX = 200;
const compiledRegexCache = new BoundedMap<string, RegExp | null>({
    maxSize: REGEX_CACHE_MAX
});

export function labelMatchersMatch(
    matchers: unknown[],
    labels: Record<string, string>
): boolean {
    return matchers.every((matcher) => labelMatcherMatches(matcher, labels));
}

export function resourceSelectorsMatch(
    selectors: unknown[],
    resource?: MatchableResource
): boolean {
    if (selectors.length === 0) return true;
    if (!resource) return false;
    return selectors.some((selector) =>
        resourceSelectorMatches(selector, resource)
    );
}

function labelMatcherMatches(
    matcher: unknown,
    labels: Record<string, string>
): boolean {
    const record = readObject(matcher);
    const label = readString(record.label ?? record.key ?? record.name);
    if (!label) return false;
    const actual = labels[label] ?? '';
    const operator = readString(record.operator) ?? '=';
    if (operator === '=') return actual === readExpectedValue(record);
    if (operator === '!=') return actual !== readExpectedValue(record);
    if (operator === 'in') return readExpectedValues(record).includes(actual);
    if (operator === 'not_in') {
        return !readExpectedValues(record).includes(actual);
    }
    if (operator === '=~') {
        return regexMatches(readExpectedValue(record), actual);
    }
    if (operator === '!~') {
        return !regexMatches(readExpectedValue(record), actual);
    }
    return false;
}

function resourceSelectorMatches(
    selector: unknown,
    resource: MatchableResource
): boolean {
    const record = readObject(selector);
    const type = readString(record.type ?? record.resourceType);
    const id = readString(record.id ?? record.resourceId);
    if (type && type !== resource.type) return false;
    if (id && id !== resource.id) return false;
    return Boolean(type || id);
}

function readExpectedValue(record: Record<string, unknown>): string {
    return readString(record.value ?? record.expected) ?? '';
}

function readExpectedValues(record: Record<string, unknown>): string[] {
    const value = record.values ?? record.value;
    return readStringArray(value);
}

function regexMatches(pattern: string, value: string): boolean {
    // Cap input — the backtracking multiplier.
    if (value.length > REGEX_MAX_INPUT_LEN) return false;
    const compiled = compileOrLookup(pattern);
    return compiled === null ? false : compiled.test(value);
}

function compileOrLookup(pattern: string): RegExp | null {
    const cached = compiledRegexCache.get(pattern);
    if (cached !== undefined) return cached;
    const compiled = tryCompile(pattern);
    compiledRegexCache.set(pattern, compiled);
    return compiled;
}

function tryCompile(pattern: string): RegExp | null {
    if (pattern.length > REGEX_MAX_PATTERN_LEN) return null;
    try {
        return new RegExp(pattern);
    } catch {
        return null;
    }
}

/** Test-only: clears the compiled-regex LRU between cases. */
export function __resetRegexCacheForTests(): void {
    compiledRegexCache.clear();
}
