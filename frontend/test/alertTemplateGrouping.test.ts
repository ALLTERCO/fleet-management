// Groups alert-rule templates by their category for the builder gallery.

import type {AlertRuleTemplate} from '@api/alert';
import {describe, expect, it} from 'vitest';
import {groupTemplatesByCategory} from '@/helpers/alertTemplateGrouping';

function tpl(templateKey: string, category: string): AlertRuleTemplate {
    return {category, templateKey} as AlertRuleTemplate;
}

describe('groupTemplatesByCategory', () => {
    it('groups templates under their category in first-seen order', () => {
        const grouped = groupTemplatesByCategory([
            tpl('a', 'Connectivity'),
            tpl('b', 'Safety'),
            tpl('c', 'Connectivity')
        ]);
        expect(grouped).toEqual([
            {
                category: 'Connectivity',
                templates: [tpl('a', 'Connectivity'), tpl('c', 'Connectivity')]
            },
            {category: 'Safety', templates: [tpl('b', 'Safety')]}
        ]);
    });

    it('returns an empty array for no templates', () => {
        expect(groupTemplatesByCategory([])).toEqual([]);
    });
});
