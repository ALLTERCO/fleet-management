/** Pure URL-state parsing for the locations page.
 *
 *  `?selected=<id>` encodes the selected node; `?tab=<key>` encodes the
 *  active right-pane tab. Extracted from `LocationsLayout.vue` so the
 *  parsing rules are testable without mounting the component or a router. */

export type DetailTabKey = 'overview' | 'plan' | 'devices' | 'settings';

const ALL_TABS: readonly DetailTabKey[] = [
    'overview',
    'plan',
    'devices',
    'settings'
];

/** Coerce a query-param value (string, array, or undefined) to the single
 *  string the URL actually carries. Vue Router passes arrays for repeated
 *  params; we never repeat these, so pick the first. */
function singleValue(raw: unknown): string | null {
    if (Array.isArray(raw)) return typeof raw[0] === 'string' ? raw[0] : null;
    if (typeof raw === 'string') return raw;
    return null;
}

/** Parse `?selected=<id>` to a location id.
 *  Returns null for missing, malformed, zero, or negative inputs. */
export function parseSelectedId(raw: unknown): number | null {
    const value = singleValue(raw);
    if (value == null || value.length === 0) return null;
    const id = Number(value);
    if (!Number.isInteger(id)) return null;
    if (id <= 0) return null;
    return id;
}

/** Parse `?tab=<key>` to a known tab key, defaulting to overview.
 *  Anything we don't recognise quietly falls back so user-typed URLs
 *  with garbage still render something sensible. */
export function parseDetailTab(raw: unknown): DetailTabKey {
    const value = singleValue(raw);
    return isDetailTabKey(value) ? value : 'overview';
}

export function isDetailTabKey(value: unknown): value is DetailTabKey {
    return (
        value === 'overview' ||
        value === 'plan' ||
        value === 'devices' ||
        value === 'settings'
    );
}

export {ALL_TABS};
