import {describe, expect, it} from 'vitest';
import {
    type FeatureFlag,
    isFeatureEnabled,
    listFeatureFlags
} from '@/helpers/featureFlags';

describe('isFeatureEnabled', () => {
    it('reports locationsRedesignV2 as enabled by default', () => {
        expect(isFeatureEnabled('locationsRedesignV2')).toBe(true);
    });

    it('typed flag names compile (smoke check via TypeScript signature)', () => {
        const flag: FeatureFlag = 'locationsRedesignV2';
        expect(typeof isFeatureEnabled(flag)).toBe('boolean');
    });
});

describe('listFeatureFlags', () => {
    it('returns the full registry', () => {
        const all = listFeatureFlags();
        expect(all.locationsRedesignV2).toBe(true);
    });

    it('returns a frozen object so callers can not mutate the registry', () => {
        const all = listFeatureFlags();
        expect(Object.isFrozen(all)).toBe(true);
    });
});
