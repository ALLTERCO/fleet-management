// Group alert-rule starter templates by their category, preserving the order
// each category first appears. The starter set is the single backend source
// (Rule.ListTemplates); the builder gallery renders one section per category.

import type {AlertRuleTemplate} from '@api/alert';

export interface TemplateCategoryGroup {
    category: string;
    templates: AlertRuleTemplate[];
}

/** Answer: templates bucketed by category, in first-seen order. */
export function groupTemplatesByCategory(
    templates: readonly AlertRuleTemplate[]
): TemplateCategoryGroup[] {
    const groups = new Map<string, AlertRuleTemplate[]>();
    for (const template of templates) {
        let bucket = groups.get(template.category);
        if (!bucket) {
            bucket = [];
            groups.set(template.category, bucket);
        }
        bucket.push(template);
    }
    return Array.from(groups.entries()).map(([category, items]) => ({
        category,
        templates: items
    }));
}
