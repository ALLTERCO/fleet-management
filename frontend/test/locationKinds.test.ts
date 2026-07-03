import {describe, expect, it} from 'vitest';
import {
    defaultTabForKind,
    type KpiKey,
    kindDotColor,
    resolveActiveTab,
    visibleKpisForKind
} from '@/helpers/location-kinds';

describe('kindDotColor', () => {
    it('paints geographic kinds blue', () => {
        expect(kindDotColor('continent')).toBe('var(--chart-color-1)');
        expect(kindDotColor('country')).toBe('var(--chart-color-1)');
        expect(kindDotColor('region')).toBe('var(--chart-color-1)');
        expect(kindDotColor('county')).toBe('var(--chart-color-1)');
    });

    it('shifts cities and neighborhoods to green', () => {
        expect(kindDotColor('city')).toBe('var(--chart-color-2)');
        expect(kindDotColor('neighborhood')).toBe('var(--chart-color-2)');
    });

    it('marks site-level kinds amber', () => {
        expect(kindDotColor('campus')).toBe('var(--chart-color-3)');
        expect(kindDotColor('site')).toBe('var(--chart-color-3)');
    });

    it('keeps building shell kinds neutral', () => {
        expect(kindDotColor('building')).toBe('var(--color-text-tertiary)');
        expect(kindDotColor('office')).toBe('var(--color-text-tertiary)');
    });

    it('paints indoor enclosure kinds purple', () => {
        expect(kindDotColor('floor')).toBe('var(--chart-color-5)');
        expect(kindDotColor('area')).toBe('var(--chart-color-5)');
        expect(kindDotColor('room')).toBe('var(--chart-color-5)');
        expect(kindDotColor('zone')).toBe('var(--chart-color-5)');
    });

    it('falls back to neutral when the kind is unknown', () => {
        expect(kindDotColor(null)).toBe('var(--color-text-tertiary)');
        expect(kindDotColor(undefined)).toBe('var(--color-text-tertiary)');
    });
});

describe('defaultTabForKind', () => {
    it('opens overview for geographic kinds', () => {
        expect(defaultTabForKind('continent')).toBe('overview');
        expect(defaultTabForKind('country')).toBe('overview');
        expect(defaultTabForKind('city')).toBe('overview');
    });

    it('opens overview for sites (still big-picture)', () => {
        expect(defaultTabForKind('campus')).toBe('overview');
        expect(defaultTabForKind('site')).toBe('overview');
    });

    it('jumps straight to the plan for indoor kinds', () => {
        expect(defaultTabForKind('building')).toBe('plan');
        expect(defaultTabForKind('office')).toBe('plan');
        expect(defaultTabForKind('floor')).toBe('plan');
        expect(defaultTabForKind('area')).toBe('plan');
        expect(defaultTabForKind('room')).toBe('plan');
        expect(defaultTabForKind('zone')).toBe('plan');
    });

    it('falls back to overview when the kind is unknown', () => {
        expect(defaultTabForKind(null)).toBe('overview');
        expect(defaultTabForKind(undefined)).toBe('overview');
    });
});

describe('visibleKpisForKind', () => {
    it('hides power and temperature for geographic kinds', () => {
        const kpis = visibleKpisForKind('country');
        expect(kpis.has('devices')).toBe(true);
        expect(kpis.has('offline')).toBe(true);
        expect(kpis.has('alerts')).toBe(true);
        expect(kpis.has('power')).toBe(false);
        expect(kpis.has('temperature')).toBe(false);
    });

    it('reveals power but still hides temperature at site-level', () => {
        const kpis = visibleKpisForKind('site');
        expect(kpis.has('power')).toBe(true);
        expect(kpis.has('temperature')).toBe(false);
    });

    it('shows the full set indoors', () => {
        const kpis = visibleKpisForKind('zone');
        const expected: ReadonlySet<KpiKey> = new Set([
            'devices',
            'offline',
            'alerts',
            'power',
            'temperature'
        ]);
        for (const key of expected) expect(kpis.has(key)).toBe(true);
    });

    it('shares the geographic set instance across geographic kinds', () => {
        // Identity check guards against accidental Set rebuilds in the map.
        expect(visibleKpisForKind('continent')).toBe(
            visibleKpisForKind('country')
        );
    });

    it('defaults to the indoor set when the kind is unknown', () => {
        const kpis = visibleKpisForKind(null);
        expect(kpis.has('temperature')).toBe(true);
    });
});

describe('resolveActiveTab', () => {
    it('honours a valid tab from the URL even when kind would default elsewhere', () => {
        expect(resolveActiveTab('plan', 'country')).toBe('plan');
        expect(resolveActiveTab('settings', 'zone')).toBe('settings');
    });

    it('falls back to the kind default when the URL value is missing', () => {
        expect(resolveActiveTab(undefined, 'building')).toBe('plan');
        expect(resolveActiveTab(undefined, 'country')).toBe('overview');
    });

    it('falls back to the kind default when the URL value is garbage', () => {
        expect(resolveActiveTab('not-a-tab', 'room')).toBe('plan');
        expect(resolveActiveTab(42, 'site')).toBe('overview');
    });

    it('falls back to overview when neither URL nor kind helps', () => {
        expect(resolveActiveTab(undefined, null)).toBe('overview');
        expect(resolveActiveTab(null, undefined)).toBe('overview');
    });
});
