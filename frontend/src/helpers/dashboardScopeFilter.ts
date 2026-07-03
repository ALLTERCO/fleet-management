// Reduce an array of devices to those that match the active dashboard
// scope. Pure — pass the device + its memberships; the helper decides.
// Used by every domain dashboard so the scope-picker filter behaves the
// same everywhere.

import type {DashboardScope, ScopeKind} from '@/composables/useDashboardScope';

export interface DeviceMembership {
    readonly groupIds: readonly number[];
    readonly tagIds: readonly number[];
    readonly locationId: number | null;
    readonly shellyID: string;
}

// One matcher per ScopeKind — buries the dispatch so the caller stays a
// single table lookup. New kinds add a row, no edits elsewhere.
type Matcher = (membership: DeviceMembership, id: number) => boolean;
const SCOPE_MATCHERS: Record<ScopeKind, Matcher> = {
    fleet: () => true,
    group: (m, id) => m.groupIds.includes(id),
    tag: (m, id) => m.tagIds.includes(id),
    location: (m, id) => m.locationId === id
};

export function deviceMatchesScope(
    membership: DeviceMembership,
    scope: DashboardScope
): boolean {
    if (scope.kind === 'fleet' || scope.id === undefined) return true;
    return SCOPE_MATCHERS[scope.kind](membership, scope.id);
}

// Filter a list of arbitrary records by their associated device membership.
// Returns a new array — never mutates input.
export function filterByScope<T>(
    items: readonly T[],
    membershipOf: (item: T) => DeviceMembership | null,
    scope: DashboardScope
): readonly T[] {
    if (scope.kind === 'fleet') return items;
    return items.filter((item) => {
        const m = membershipOf(item);
        return m === null ? false : deviceMatchesScope(m, scope);
    });
}
