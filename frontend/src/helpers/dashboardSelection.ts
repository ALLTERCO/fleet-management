// Filter-aware selection bookkeeping for the manage page.
// Pure helpers — selection state lives in the component, these answer
// "what is visible / what is hidden" without touching reactive refs.

import type {OrderedId} from '@/helpers/dashboardOrder';

export interface SelectionView {
    readonly visible: ReadonlySet<string>;
    readonly hidden: ReadonlySet<string>;
}

export function projectSelection(
    selected: ReadonlySet<string>,
    visibleIds: readonly OrderedId[]
): SelectionView {
    const visibleSet = new Set(visibleIds.map(String));
    const visible = new Set<string>();
    const hidden = new Set<string>();
    for (const id of selected) {
        (visibleSet.has(id) ? visible : hidden).add(id);
    }
    return {visible, hidden};
}

// Remove only the filter-visible ids — keep hidden selections so a
// "deselect all" doesn't silently nuke rows the user can't see.
export function deselectFiltered(
    selected: ReadonlySet<string>,
    visibleIds: readonly OrderedId[]
): Set<string> {
    const visibleSet = new Set(visibleIds.map(String));
    const next = new Set<string>();
    for (const id of selected) {
        if (!visibleSet.has(id)) next.add(id);
    }
    return next;
}

export function selectFiltered(
    selected: ReadonlySet<string>,
    visibleIds: readonly OrderedId[]
): Set<string> {
    const next = new Set(selected);
    for (const id of visibleIds) next.add(String(id));
    return next;
}
