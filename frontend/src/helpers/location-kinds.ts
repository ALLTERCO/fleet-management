import type {LocationKind} from '@api/location';
import {type DetailTabKey, isDetailTabKey} from './locationsUrlState';

/* ──────────────────────────── Plan-friendly ──────────────────────────── */

// Kinds that conceptually host a floor plan (anything below city level).
export const PLAN_FRIENDLY_KINDS: ReadonlySet<LocationKind> = new Set([
    'campus',
    'site',
    'building',
    'office',
    'floor',
    'area',
    'room',
    'zone'
]);

export function isPlanFriendlyKind(
    kind: LocationKind | undefined | null
): boolean {
    return !!kind && PLAN_FRIENDLY_KINDS.has(kind);
}

/* ──────────────────────────── Dot colour ──────────────────────────── */

// Four conceptual bands map to four token slots. Geographic kinds carry
// the same dot, then site, then building shell, then indoor enclosure.
const KIND_DOT_COLOR: Record<LocationKind, string> = {
    continent: 'var(--chart-color-1)',
    country: 'var(--chart-color-1)',
    region: 'var(--chart-color-1)',
    county: 'var(--chart-color-1)',
    city: 'var(--chart-color-2)',
    neighborhood: 'var(--chart-color-2)',
    campus: 'var(--chart-color-3)',
    site: 'var(--chart-color-3)',
    building: 'var(--color-text-tertiary)',
    office: 'var(--color-text-tertiary)',
    floor: 'var(--chart-color-5)',
    area: 'var(--chart-color-5)',
    room: 'var(--chart-color-5)',
    zone: 'var(--chart-color-5)'
};

export function kindDotColor(kind: LocationKind | undefined | null): string {
    if (!kind) return 'var(--color-text-tertiary)';
    return KIND_DOT_COLOR[kind];
}

/* ──────────────────────────── Default tab ──────────────────────────── */

// Geographic + site-level land on overview; indoor kinds land on plan
// because that's the user's reason to drill in.
const KIND_DEFAULT_TAB: Record<LocationKind, DetailTabKey> = {
    continent: 'overview',
    country: 'overview',
    region: 'overview',
    county: 'overview',
    city: 'overview',
    neighborhood: 'overview',
    campus: 'overview',
    site: 'overview',
    building: 'plan',
    office: 'plan',
    floor: 'plan',
    area: 'plan',
    room: 'plan',
    zone: 'plan'
};

export function defaultTabForKind(
    kind: LocationKind | undefined | null
): DetailTabKey {
    if (!kind) return 'overview';
    return KIND_DEFAULT_TAB[kind];
}

// Compose URL value + kind into the tab to render. Explicit URL state wins;
// otherwise the kind picks the most useful default. Kept in this helper
// because it composes both signals and keeps the consumer one-liner small.
export function resolveActiveTab(
    rawTabQuery: unknown,
    kind: LocationKind | undefined | null
): DetailTabKey {
    if (typeof rawTabQuery === 'string' && isDetailTabKey(rawTabQuery)) {
        return rawTabQuery;
    }
    return defaultTabForKind(kind);
}

/* ──────────────────────────── KPI visibility ──────────────────────────── */

export type KpiKey = 'devices' | 'offline' | 'alerts' | 'power' | 'temperature';

// Three shared sets — same instance reused so a kind lookup is one map hit.
const GEOGRAPHIC_KPIS: ReadonlySet<KpiKey> = new Set<KpiKey>([
    'devices',
    'offline',
    'alerts'
]);
const SITE_LEVEL_KPIS: ReadonlySet<KpiKey> = new Set<KpiKey>([
    'devices',
    'offline',
    'alerts',
    'power'
]);
const INDOOR_KPIS: ReadonlySet<KpiKey> = new Set<KpiKey>([
    'devices',
    'offline',
    'alerts',
    'power',
    'temperature'
]);

const KIND_VISIBLE_KPIS: Record<LocationKind, ReadonlySet<KpiKey>> = {
    continent: GEOGRAPHIC_KPIS,
    country: GEOGRAPHIC_KPIS,
    region: GEOGRAPHIC_KPIS,
    county: GEOGRAPHIC_KPIS,
    city: GEOGRAPHIC_KPIS,
    neighborhood: GEOGRAPHIC_KPIS,
    campus: SITE_LEVEL_KPIS,
    site: SITE_LEVEL_KPIS,
    building: INDOOR_KPIS,
    office: INDOOR_KPIS,
    floor: INDOOR_KPIS,
    area: INDOOR_KPIS,
    room: INDOOR_KPIS,
    zone: INDOOR_KPIS
};

export function visibleKpisForKind(
    kind: LocationKind | undefined | null
): ReadonlySet<KpiKey> {
    if (!kind) return INDOOR_KPIS;
    return KIND_VISIBLE_KPIS[kind];
}
