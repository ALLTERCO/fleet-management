// Plain-English rendering of a rule's config — drives the live "reads as"
// line in the builder and the human-readable config view on the detail page.

import {describe, expect, it} from 'vitest';
import {describeRuleConfig} from '@/helpers/ruleSentence';

describe('describeRuleConfig', () => {
    it('phrases a relay-on component_state config', () => {
        expect(
            describeRuleConfig('component_state', {
                component: 'switch:0',
                field: 'output',
                equals: true
            })
        ).toBe('a relay turns on');
    });

    it('phrases a temperature threshold with its unit', () => {
        expect(
            describeRuleConfig('component_threshold', {
                component: 'temperature:0',
                field: 'tC',
                operator: 'gt',
                threshold: 30
            })
        ).toBe('temperature goes above 30 °C');
    });

    it('phrases a battery_below config', () => {
        expect(describeRuleConfig('battery_below', {thresholdPct: 20})).toBe(
            'battery drops below 20%'
        );
    });

    it('falls back to the kind label for a config it cannot phrase', () => {
        expect(describeRuleConfig('firmware_operation_failed', {})).toBe(
            'Firmware update failed'
        );
    });

    it('renders a generic field/operator phrase for an unknown metric', () => {
        expect(
            describeRuleConfig('component_threshold', {
                component: 'pm1:0',
                field: 'apower',
                operator: 'lt',
                threshold: 5
            })
        ).toBe('power goes below 5 W');
    });

    it('phrases air-quality metrics by field name', () => {
        expect(
            describeRuleConfig('component_threshold', {
                component: 'bthomesensor:200',
                field: 'co2',
                operator: 'gt',
                threshold: 1000
            })
        ).toBe('CO2 goes above 1000 ppm');
    });

    it('phrases an energy consumption window threshold', () => {
        expect(
            describeRuleConfig('energy_consumption_threshold', {
                windowSec: 300,
                operator: 'gt',
                thresholdKWh: 0.1
            })
        ).toBe('energy use over 5 min goes above 0.1 kWh');
    });
});
