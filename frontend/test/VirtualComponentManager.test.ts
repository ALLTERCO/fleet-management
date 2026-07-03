import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import VirtualComponentManager from '@/components/core/VirtualComponentManager.vue';
import {useDevicesStore} from '@/stores/devices';

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn(),
    connect: vi.fn(),
    close: vi.fn()
}));

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('VirtualComponentManager', () => {
    it('lists existing virtual components and opens the editor for one', async () => {
        const devices = useDevicesStore();
        devices.devices.host = {
            shellyID: 'host',
            status: {'boolean:200': {value: true}},
            settings: {'boolean:200': {name: 'Ready flag'}}
        } as never;

        const wrapper = mount(VirtualComponentManager, {
            props: {shellyID: 'host'},
            global: {
                stubs: {
                    VirtualEditModal: {
                        name: 'VirtualEditModal',
                        props: ['visible', 'shellyID', 'componentKey'],
                        template:
                            '<div data-testid="editor">{{ componentKey }}</div>'
                    }
                }
            }
        });

        expect(wrapper.text()).toContain('Ready flag');
        await wrapper.find('.vcm__item').trigger('click');
        expect(wrapper.find('[data-testid="editor"]').text()).toBe(
            'boolean:200'
        );
    });
});
