import {mount, flushPromises} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import PickPartsStep from '@/components/devices/add/PickPartsStep.vue';

const listSources = vi.hoisted(() => vi.fn());

vi.mock('@host/virtualDevices', () => ({
    virtualDevices: {
        bindings: {listSources}
    }
}));

beforeEach(() => {
    setActivePinia(createPinia());
    listSources.mockReset();
});

describe('PickPartsStep', () => {
    it('loads additional source pages without dropping existing parts', async () => {
        listSources
            .mockResolvedValueOnce({
                items: [
                    {
                        deviceExternalId: 'dev-a',
                        deviceName: 'Device A',
                        componentKey: 'switch:0',
                        componentType: 'switch',
                        dynamicCategory: null,
                        label: 'Relay A',
                        writable: true
                    }
                ],
                total: 2,
                limit: 200,
                offset: 0,
                has_more: true
            })
            .mockResolvedValueOnce({
                items: [
                    {
                        deviceExternalId: 'dev-b',
                        deviceName: 'Device B',
                        componentKey: 'switch:0',
                        componentType: 'switch',
                        dynamicCategory: null,
                        label: 'Relay B',
                        writable: true
                    }
                ],
                total: 2,
                limit: 200,
                offset: 1,
                has_more: false
            });

        const wrapper = mount(PickPartsStep);
        await flushPromises();

        expect(wrapper.text()).toContain('Relay A');
        await wrapper.find('.pps__load-more').trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('Relay A');
        expect(wrapper.text()).toContain('Device B');
        expect(listSources).toHaveBeenLastCalledWith({
            query: undefined,
            limit: 200,
            offset: 1
        });
    });
});
