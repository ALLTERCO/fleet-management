import {mount, type VueWrapper} from '@vue/test-utils';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {computed} from 'vue';
import BoundaryScopePicker from '@/components/core/BoundaryScopePicker.vue';
import type {ScopeSelection} from '@/helpers/scopeDimensions';

const {fetchDashboards, fetchAlerts} = vi.hoisted(() => ({
    fetchDashboards: vi.fn(),
    fetchAlerts: vi.fn()
}));

vi.mock('@/composables/useScopeDimensionSources', () => ({
    useScopeDimensionSources: () => ({
        device_ids: {
            options: computed(() => [{value: 'd1', label: 'Device 1'}])
        },
        device_group_ids: {options: computed(() => [])},
        location_ids: {options: computed(() => [])},
        device_tags: {options: computed(() => [])},
        dashboard_ids: {
            fetch: fetchDashboards,
            options: computed(() => [{value: 5, label: 'Main board'}])
        },
        alert_ids: {
            fetch: fetchAlerts,
            options: computed(() => [{value: '1', label: 'High temp'}])
        },
        notification_ids: {options: computed(() => [])},
        integration_keys: {options: computed(() => [])},
        report_ids: {options: computed(() => [])}
    })
}));

function mountPicker(
    modelValue: ScopeSelection = {},
    personaKey?: string
): VueWrapper {
    return mount(BoundaryScopePicker, {
        props: {modelValue, personaKey},
        global: {stubs: {Dropdown: true, ScopeDimensionField: true}}
    });
}

function kindDropdown(wrapper: VueWrapper) {
    return wrapper.findAllComponents({name: 'Dropdown'})[0];
}

function dimensionField(wrapper: VueWrapper) {
    return wrapper.findComponent({name: 'ScopeDimensionField'});
}

beforeEach(() => {
    fetchDashboards.mockClear();
    fetchAlerts.mockClear();
});

describe('BoundaryScopePicker', () => {
    it('writes exactly one dimension', async () => {
        const wrapper = mountPicker();
        dimensionField(wrapper).vm.$emit('update:modelValue', ['d1']);
        await wrapper.vm.$nextTick();
        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
            {device_ids: ['d1']}
        ]);
        wrapper.unmount();
    });

    it('clears the selection when the kind changes', async () => {
        const wrapper = mountPicker({device_ids: ['d1']});
        kindDropdown(wrapper).vm.$emit('selected', 'dashboards');
        await wrapper.vm.$nextTick();
        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{}]);
        // The picker now targets dashboards only.
        dimensionField(wrapper).vm.$emit('update:modelValue', [5]);
        await wrapper.vm.$nextTick();
        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
            {dashboard_ids: [5]}
        ]);
        wrapper.unmount();
    });

    it('lands on the kind of an existing scope when reopened', () => {
        const wrapper = mountPicker({dashboard_ids: [7]});
        expect(kindDropdown(wrapper).props('default')).toBe('dashboards');
        wrapper.unmount();
    });

    it('clears a stale scope on mount when the role forbids its kind', async () => {
        // Reopened picker carrying a dashboards scope, but operator may not
        // scope on dashboards — the picks must not survive.
        const wrapper = mountPicker({dashboard_ids: [7]}, 'operator');
        await wrapper.vm.$nextTick();
        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{}]);
        wrapper.unmount();
    });

    it('filters offered kinds by the shared persona matrix', () => {
        const wrapper = mountPicker({}, 'operator');
        const offered = kindDropdown(wrapper)
            .props('groups')[0]
            .items.map((item: {value: string}) => item.value);
        expect(offered).toContain('devices');
        expect(offered).toContain('alerts');
        expect(offered).not.toContain('dashboards');
        expect(offered).not.toContain('integrations');
        wrapper.unmount();
    });

    it('lazy-loads a list only when its kind is first shown', async () => {
        const wrapper = mountPicker();
        expect(fetchDashboards).not.toHaveBeenCalled();
        kindDropdown(wrapper).vm.$emit('selected', 'dashboards');
        await wrapper.vm.$nextTick();
        expect(fetchDashboards).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });
});
