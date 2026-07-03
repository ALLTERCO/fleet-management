// Catalog-driven report section dispatch. Which sections a report contains is
// decided by the kind categories in scope, not by hardcoded asset-role checks.
// This module owns the routing table and the selection — the single decision
// source for category -> section. Section rendering wires onto it separately.

import type {GroupKindCategory} from '../../config/groupKindCatalog';
import type {ReportSectionId} from '../../types/api/reporttemplate';

export type {ReportSectionId};

export interface CategorySection {
    id: ReportSectionId;
    categories: readonly GroupKindCategory[];
}

// One row per report section, in render order. A section fires when any of its
// categories is present in scope. Source of truth for category -> section.
export const CATEGORY_SECTIONS: readonly CategorySection[] = [
    {id: 'demand', categories: ['electrical']},
    {id: 'solar', categories: ['solar', 'renewables']},
    {id: 'battery', categories: ['energy_storage']},
    {id: 'ev', categories: ['ev']},
    {id: 'tenant', categories: ['property']}
];

// The sections to render for a scope, in table order. A section is kept only
// when one of its categories is in scope, so an empty scope yields no sections.
export function selectSections(
    categoriesInScope: ReadonlySet<GroupKindCategory>
): ReportSectionId[] {
    return CATEGORY_SECTIONS.filter((section) =>
        section.categories.some((category) => categoriesInScope.has(category))
    ).map((section) => section.id);
}

// Narrow scope-selected sections to a template's allowlist, in render order.
// An absent or empty allowlist means "no restriction" — render every triggered
// section (so a stray [] never silently blanks the role-gated sections).
export function applySectionAllowlist(
    selected: readonly ReportSectionId[],
    allowed: readonly string[] | null | undefined
): ReportSectionId[] {
    if (!allowed || allowed.length === 0) return [...selected];
    const allow = new Set(allowed);
    return selected.filter((id) => allow.has(id));
}
