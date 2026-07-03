import {describe, expect, it} from 'vitest';
import {
    DEVICE_SELECTORS,
    SCOPE_DIMENSIONS,
    SCOPE_KINDS,
    scopeKindsForPersona
} from '@/helpers/scopeDimensions';

describe('scopeDimensions', () => {
    it('has a unique key per dimension', () => {
        const keys = SCOPE_DIMENSIONS.map((dim) => dim.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('gives every dimension complete metadata', () => {
        for (const dim of SCOPE_DIMENSIONS) {
            expect(dim.label.length).toBeGreaterThan(0);
            expect(dim.icon.length).toBeGreaterThan(0);
            expect(dim.source.length).toBeGreaterThan(0);
            expect(['string', 'number']).toContain(dim.valueType);
        }
    });

    it('maps every kind and device selector to a real dimension', () => {
        const dimensionKeys = new Set(SCOPE_DIMENSIONS.map((d) => d.key));
        for (const kind of SCOPE_KINDS) {
            if (kind.dimension)
                expect(dimensionKeys.has(kind.dimension)).toBe(true);
        }
        for (const selector of DEVICE_SELECTORS) {
            expect(dimensionKeys.has(selector.key)).toBe(true);
        }
    });
});

describe('scopeKindsForPersona', () => {
    it('offers every kind when no role or a custom role is picked', () => {
        expect(scopeKindsForPersona(undefined)).toHaveLength(
            SCOPE_KINDS.length
        );
        expect(scopeKindsForPersona('my-custom-persona')).toHaveLength(
            SCOPE_KINDS.length
        );
    });

    it('filters kinds by the shared matrix for system roles', () => {
        // Backend matrix: operator may scope on device family, alerts,
        // notifications — not dashboards or integrations.
        const operator = scopeKindsForPersona('operator').map((k) => k.key);
        expect(operator).toContain('devices');
        expect(operator).toContain('alerts');
        expect(operator).toContain('notifications');
        expect(operator).not.toContain('dashboards');
        expect(operator).not.toContain('integrations');
    });

    it('offers admins every kind', () => {
        expect(scopeKindsForPersona('admin')).toHaveLength(SCOPE_KINDS.length);
    });
});
