// Quick-picks are derived from the backend starter templates (single source);
// the frontend only adds a presentation icon.

import type {AlertRuleTemplate} from '@api/alert';
import {describe, expect, it} from 'vitest';
import {kindHasPresets, presetsForKind} from '@/helpers/rulePresets';

function tpl(
    templateKey: string,
    kind: AlertRuleTemplate['kind'],
    label: string,
    config: Record<string, unknown>
): AlertRuleTemplate {
    return {templateKey, kind, label, config} as AlertRuleTemplate;
}

const TEMPLATES: AlertRuleTemplate[] = [
    tpl('builtin:relay_on', 'component_state', 'Relay turns on', {
        component: 'switch:0',
        field: 'output',
        equals: true
    }),
    tpl(
        'builtin:temp_above_30c',
        'component_threshold',
        'Temperature above 30 °C',
        {
            component: 'temperature:0',
            field: 'tC',
            operator: 'gt',
            threshold: 30
        }
    ),
    tpl('builtin:device_offline_5min', 'device_offline', 'Device offline', {
        offlineForSec: 300
    })
];

describe('kindHasPresets', () => {
    it('is true for the free-form condition kinds, false otherwise', () => {
        expect(kindHasPresets('component_state')).toBe(true);
        expect(kindHasPresets('component_threshold')).toBe(true);
        expect(kindHasPresets('device_offline')).toBe(false);
    });
});

describe('presetsForKind', () => {
    it('derives a choice per matching starter, carrying the backend config', () => {
        const choices = presetsForKind(TEMPLATES, 'component_state');
        expect(choices).toHaveLength(1);
        expect(choices[0]).toMatchObject({
            key: 'builtin:relay_on',
            label: 'Relay turns on',
            config: {component: 'switch:0', field: 'output', equals: true}
        });
        expect(choices[0].icon).toContain('toggle');
    });

    it('picks an icon from the component family for sensors', () => {
        const [temp] = presetsForKind(TEMPLATES, 'component_threshold');
        expect(temp.icon).toContain('temperature');
    });

    it('returns nothing for a kind without quick-picks', () => {
        expect(presetsForKind(TEMPLATES, 'device_offline')).toEqual([]);
    });
});
