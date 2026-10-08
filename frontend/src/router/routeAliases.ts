// One release generation of aliases only: paths that existed in the previous
// release, plus group paths that have no page of their own. Older aliases are
// gone. The query rides along, so a deep link survives the move.

import type {LocationQuery} from 'vue-router';

const ENERGY_ROOT = '/settings/energy';
const ENERGY_LANDING = `${ENERGY_ROOT}/bill`;
const UTILITY_ACCOUNTING_PATH = '/settings/utility-accounting';

// Sections that moved wholesale under Settings and kept their sub-paths.
const MOVED_SECTIONS = ['/alerts', '/monitoring'];

// A URL decides these lookups, so a Map keeps object prototype keys out.
const MOVED_PATHS = new Map<string, string>([
    // Device Auth moved under Settings > Security.
    ['/operations/device-auth', '/settings/security/credentials'],
    ['/operations/device-auth/certificates', '/settings/security/certificates'],
    // Paths with no page of their own land on the nearest real page.
    ['/settings/monitoring/investigate', '/settings/monitoring/logs'],
    ['/settings/monitoring/resources', '/settings/monitoring/runtime'],
    [ENERGY_ROOT, ENERGY_LANDING]
]);

// The Utility accounting tabs became pages; the old ?tab= names the page.
const ENERGY_PAGE_BY_LEGACY_TAB = new Map<string, string>([
    ['tariffs', `${ENERGY_ROOT}/tariffs`],
    ['bills', `${ENERGY_ROOT}/bills`],
    ['meters', `${ENERGY_ROOT}/meters`],
    ['carbon', `${ENERGY_ROOT}/carbon`],
    ['gas', `${ENERGY_ROOT}/carbon`],
    ['history', `${ENERGY_ROOT}/repair`]
]);

export type RouteAlias = {
    path: string;
    query: LocationQuery;
};

export function resolveRouteAlias(source: RouteAlias): RouteAlias | null {
    if (source.path === UTILITY_ACCOUNTING_PATH) {
        return {
            path: energyPageForLegacyTab(source.query.tab),
            query: queryWithoutTab(source.query)
        };
    }
    const path = movedPath(source.path);
    return path === null ? null : {path, query: source.query};
}

function movedPath(path: string): string | null {
    const moved = MOVED_PATHS.get(path);
    if (moved) return moved;
    return movedSection(path) ? `/settings${path}` : null;
}

function movedSection(path: string): boolean {
    return MOVED_SECTIONS.some(
        (section) => path === section || path.startsWith(`${section}/`)
    );
}

function energyPageForLegacyTab(tab: LocationQuery[string]): string {
    if (typeof tab !== 'string') return ENERGY_LANDING;
    return ENERGY_PAGE_BY_LEGACY_TAB.get(tab) ?? ENERGY_LANDING;
}

function queryWithoutTab(query: LocationQuery): LocationQuery {
    return Object.fromEntries(
        Object.entries(query).filter(([key]) => key !== 'tab')
    );
}
