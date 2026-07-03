/** Unit tests for helpers/ruleKinds — one assertion per behaviour, test
 *  names read as a spec instead of mirroring the function name. */

import {ALERT_RULE_KINDS} from '@api/alert';
import {describe, expect, it} from 'vitest';
import {
    describeRuleKind,
    groupRuleKindsByCategory,
    isRuleKind,
    labelForCategory,
    labelForRuleKind,
    listAllRuleKinds
} from '@/helpers/ruleKinds';

describe('listAllRuleKinds', () => {
    // Assert against the backend SSOT, not a magic number, so adding a kind
    // backend-side can't silently drift this test.
    it('returns one metadata record per backend kind', () => {
        expect(listAllRuleKinds().length).toBe(ALERT_RULE_KINDS.length);
        expect(new Set(listAllRuleKinds().map((meta) => meta.key))).toEqual(
            new Set(ALERT_RULE_KINDS)
        );
    });

    it('places the connectivity kinds first because they are the most common', () => {
        const first = listAllRuleKinds()[0];
        expect(first.key).toBe('device_offline');
    });
});

describe('describeRuleKind', () => {
    it('returns a label that humans can read out loud', () => {
        expect(describeRuleKind('battery_below').label).toBe(
            'Battery below threshold'
        );
    });

    it('puts the smoke-alarm kind in the safety category', () => {
        expect(describeRuleKind('smoke_alarm').category).toBe('safety');
    });

    it('points at a CSS custom property for its category colour', () => {
        expect(describeRuleKind('device_offline').colorToken).toMatch(
            /^--rule-color-/
        );
    });

    it('declares the scope types the backend supports for the kind', () => {
        expect(
            describeRuleKind('device_offline').supportedScopeTypes
        ).toContain('device');
    });

    it('throws when given a value outside the kind union', () => {
        expect(() => describeRuleKind('mystery' as never)).toThrow();
    });
});

describe('isRuleKind', () => {
    it('returns true for a known kind string', () => {
        expect(isRuleKind('flood_alarm')).toBe(true);
    });

    it('returns false for an unrelated string', () => {
        expect(isRuleKind('not_a_kind')).toBe(false);
    });
});

describe('labelForRuleKind', () => {
    it('translates a known kind into its display label', () => {
        expect(labelForRuleKind('motion_detected')).toBe('Motion detected');
    });

    it('falls back to the input string when given an unknown kind', () => {
        expect(labelForRuleKind('zzz')).toBe('zzz');
    });
});

describe('labelForCategory', () => {
    it('returns a human label for the connectivity category', () => {
        expect(labelForCategory('connectivity')).toBe('Connectivity');
    });
});

describe('groupRuleKindsByCategory', () => {
    it('emits one bucket per category', () => {
        expect(groupRuleKindsByCategory().length).toBe(4);
    });

    it('places the safety bucket first because life-safety alerts dominate', () => {
        expect(groupRuleKindsByCategory()[0].category).toBe('safety');
    });

    it('puts smoke and flood inside the safety bucket', () => {
        const safety = groupRuleKindsByCategory()[0];
        const keys = safety.kinds.map((meta) => meta.key);
        expect(keys).toContain('smoke_alarm');
        expect(keys).toContain('flood_alarm');
    });

    it('puts component threshold inside the measurement bucket', () => {
        const measurement = groupRuleKindsByCategory().find(
            (entry) => entry.category === 'measurement'
        );
        expect(measurement?.kinds.map((meta) => meta.key)).toContain(
            'component_threshold'
        );
    });

    it('puts energy consumption inside the measurement bucket', () => {
        const measurement = groupRuleKindsByCategory().find(
            (entry) => entry.category === 'measurement'
        );
        expect(measurement?.kinds.map((meta) => meta.key)).toContain(
            'energy_consumption_threshold'
        );
    });
});
