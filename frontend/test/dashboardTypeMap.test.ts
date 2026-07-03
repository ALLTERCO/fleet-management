import {describe, expect, it} from 'vitest';
import {
    appearanceForDashboardType,
    DOMAIN_TYPE_META,
    DOMAIN_TYPES
} from '@/types/dashboard';

describe('dashboard taxonomy: map type', () => {
    it('includes map as a domain type', () => {
        expect(DOMAIN_TYPES).toContain('map');
    });

    it('exposes metadata for map', () => {
        const meta = DOMAIN_TYPE_META.map;
        expect(meta).toBeDefined();
        expect(meta.label).toBe('Map');
        expect(meta.icon).toBe('fas fa-map-location-dot');
        expect(meta.defaultName).toBe('Map');
        expect(meta.detects).toEqual([]);
    });

    it('exposes appearance for map', () => {
        const appearance = appearanceForDashboardType('map');
        expect(appearance.label).toBe('Map');
        expect(appearance.icon).toBe('fas fa-map-location-dot');
        expect(appearance.accent).toBe('primary');
    });
});
