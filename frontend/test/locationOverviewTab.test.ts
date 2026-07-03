import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/composables/useChildOverview', () => ({
    useChildOverview: () => ({value: []})
}));
vi.mock('@/tools/observability', () => ({trackInteraction: vi.fn()}));
vi.mock('@/helpers/realtimeSocket', () => ({
    realtimeSocket: {isWired: false, subscribe: () => () => {}}
}));

import type {LocationKind} from '@api/location';
import LocationOverviewTab from '@/components/locations/LocationOverviewTab.vue';
import type {ApiLocation} from '@/stores/locations';

function makeLocation(kind: LocationKind): ApiLocation {
    return {
        id: 1,
        organizationId: 'org',
        name: 'Test',
        kind,
        parentLocationId: null,
        sortOrder: 0,
        kindFields: {},
        customFields: {},
        effective: {
            timezone: null,
            countryCode: null,
            currency: null,
            regulatoryZone: null,
            complianceTags: []
        },
        coordinateStatus: {state: 'missing_address', summary: ''},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null
    };
}

describe('LocationOverviewTab dispatcher', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it('renders the geographic tier view for a country', () => {
        const wrapper = mount(LocationOverviewTab, {
            props: {location: makeLocation('country')}
        });
        expect(wrapper.find('.ov-geo').exists()).toBe(true);
        expect(wrapper.find('.ov-site').exists()).toBe(false);
        expect(wrapper.find('.ov-bld').exists()).toBe(false);
        expect(wrapper.find('.ov-indoor').exists()).toBe(false);
    });

    it('renders the site tier view for a site', () => {
        const wrapper = mount(LocationOverviewTab, {
            props: {location: makeLocation('site')}
        });
        expect(wrapper.find('.ov-site').exists()).toBe(true);
    });

    it('renders the building tier view for a building', () => {
        const wrapper = mount(LocationOverviewTab, {
            props: {location: makeLocation('building')}
        });
        expect(wrapper.find('.ov-bld').exists()).toBe(true);
    });

    it('renders the indoor tier view for a floor', () => {
        const wrapper = mount(LocationOverviewTab, {
            props: {location: makeLocation('floor')}
        });
        expect(wrapper.find('.ov-indoor').exists()).toBe(true);
    });

    it('shows the loading hint when location is null', () => {
        const wrapper = mount(LocationOverviewTab, {
            props: {location: null}
        });
        expect(wrapper.text()).toContain('Loading');
    });
});
