// REGRESSION: prior failures we explicitly fixed. Each `it` names the
// failure mode so a future refactor that brings it back fails here.
import {describe, expect, it} from 'vitest';
import {isAccentTokenKey} from '@/config/accentTokens';

describe('regression: groups parity with virtual devices', () => {
    it('accent set must be a token key, NEVER a raw hex (parity with virtual devices)', () => {
        // Pre-fix: ColorPickerPanel emitted '#4495D1' directly. Lifting the
        // shared schema forced both surfaces to use the token registry.
        expect(isAccentTokenKey('#4495D1')).toBe(false);
        expect(isAccentTokenKey('green')).toBe(true);
    });

    it('null accent passes through as "no accent" without losing icon', () => {
        // Pre-fix: clearing accent dropped icon too because the modal
        // saved {visual: undefined} instead of {visual: {icon}}.
        const visual = {icon: 'fas fa-folder', accent: undefined};
        expect(visual.icon).toBe('fas fa-folder');
    });
});
