import {describe, expect, it} from 'vitest';
import {componentActivePower} from '@api/componentPower';

describe('componentActivePower', () => {
    it('reads a switch / PM1 / cover / light via apower', () => {
        expect(componentActivePower({apower: 42})).toBe(42);
    });

    it('reads an EM1 via act_power', () => {
        expect(componentActivePower({act_power: 7})).toBe(7);
    });

    it('sums a 3-phase EM via its per-phase fields, ignoring the total', () => {
        expect(
            componentActivePower({
                a_act_power: 100,
                b_act_power: 200,
                c_act_power: 300,
                total_act_power: 600
            })
        ).toBe(600);
    });

    it('falls back to total_act_power when no per-phase / single field exists', () => {
        expect(componentActivePower({total_act_power: 480})).toBe(480);
    });

    it('prefers apower over act_power when both somehow appear', () => {
        expect(componentActivePower({apower: 5, act_power: 9})).toBe(5);
    });

    it('keeps the raw sign (export = negative)', () => {
        expect(componentActivePower({apower: -12})).toBe(-12);
    });

    it('returns null when no active-power field is present', () => {
        expect(componentActivePower({voltage: 230, current: 0.5})).toBeNull();
    });

    it('ignores non-numeric fields', () => {
        expect(componentActivePower({apower: 'oops'})).toBeNull();
    });
});
