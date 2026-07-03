/** REGRESSION: edge cases the kind helper must not regress on.
 *  Each test names the failure mode it pins. */

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import LocationKpiStrip from '@/components/locations/LocationKpiStrip.vue';
import {
    defaultTabForKind,
    kindDotColor,
    resolveActiveTab,
    visibleKpisForKind
} from '@/helpers/location-kinds';

const rollups = {
    deviceCount: 1,
    onlineSplit: {online: 1, offline: 0},
    alertCount: 0,
    powerSumWatts: 50,
    temperature: {avgCelsius: 20, count: 1}
} as const;

describe('REGRESSION: unknown kind never produces var(--undefined)', () => {
    it('kindDotColor falls back to a real token for null and undefined', () => {
        expect(kindDotColor(null)).toBe('var(--color-text-tertiary)');
        expect(kindDotColor(undefined)).toBe('var(--color-text-tertiary)');
    });

    it('KpiStrip with kind=null shows the full indoor set instead of crashing', () => {
        const wrapper = mount(LocationKpiStrip, {
            props: {kind: null, ...rollups}
        });
        const labels = wrapper.findAll('.lk__caption').map((n) => n.text());
        expect(labels).toContain('Power');
        expect(labels).toContain('Temperature');
    });
});

describe('REGRESSION: visibleKpisForKind shares Set instances', () => {
    it('same group of kinds returns the same Set so reactivity stays cheap', () => {
        expect(visibleKpisForKind('continent')).toBe(
            visibleKpisForKind('country')
        );
        expect(visibleKpisForKind('campus')).toBe(visibleKpisForKind('site'));
        expect(visibleKpisForKind('floor')).toBe(visibleKpisForKind('zone'));
    });
});

describe('REGRESSION: resolveActiveTab tolerates Vue Router array params', () => {
    it('an array tab query (?tab=x&tab=y) falls back to the kind default', () => {
        // Vue Router passes string[] when a query key appears more than once.
        const arrayQuery = ['plan', 'settings'] as unknown;
        expect(resolveActiveTab(arrayQuery, 'building')).toBe('plan');
    });

    it('numeric and boolean garbage in the query lands on the kind default', () => {
        expect(resolveActiveTab(0, 'country')).toBe('overview');
        expect(resolveActiveTab(false, 'room')).toBe('plan');
        expect(resolveActiveTab({}, 'site')).toBe('overview');
    });

    it('empty string in the query lands on the kind default', () => {
        expect(resolveActiveTab('', 'zone')).toBe('plan');
    });
});

describe('REGRESSION: defaultTabForKind covers every declared kind', () => {
    it('returns a real tab key for every LocationKind in the union', () => {
        const everyKind = [
            'continent',
            'country',
            'region',
            'county',
            'city',
            'neighborhood',
            'campus',
            'site',
            'building',
            'office',
            'floor',
            'area',
            'room',
            'zone'
        ] as const;
        for (const kind of everyKind) {
            expect(['overview', 'plan']).toContain(defaultTabForKind(kind));
        }
    });
});

describe('REGRESSION: KpiStrip kind change reruns the visibility set', () => {
    it('does not retain a stale visibility snapshot after kind change', async () => {
        const wrapper = mount(LocationKpiStrip, {
            props: {kind: 'country', ...rollups, alertCount: 1}
        });
        const beforeLabels = wrapper
            .findAll('.lk__caption')
            .map((n) => n.text());
        expect(beforeLabels).not.toContain('Power');

        await wrapper.setProps({kind: 'site'});
        await nextTick();
        const afterLabels = wrapper
            .findAll('.lk__caption')
            .map((n) => n.text());
        expect(afterLabels).toContain('Power');
    });
});
