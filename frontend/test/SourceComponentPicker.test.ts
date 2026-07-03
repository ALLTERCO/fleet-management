import {mount} from '@vue/test-utils';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick} from 'vue';

const sendRPC = vi.hoisted(() => vi.fn());

vi.mock('@/tools/websocket', () => ({
    sendRPC,
    close: vi.fn(),
    connect: vi.fn()
}));

import SourceComponentPicker from '@/components/devices/add/SourceComponentPicker.vue';

beforeEach(() => {
    sendRPC.mockReset();
});

describe('SourceComponentPicker — search input loads candidates from the backend', () => {
    it('does not call the backend until the user actually focuses or types — avoids burning requests on every step render', () => {
        sendRPC.mockResolvedValue({
            items: [],
            total: 0,
            limit: 0,
            offset: 0,
            has_more: false
        });
        const w = mount(SourceComponentPicker, {
            props: {roleKey: 'burner', selected: null},
            attachTo: document.body
        });
        expect(sendRPC).not.toHaveBeenCalled();
        w.unmount();
    });

    it('loads on first focus and forwards the role key so the backend filters by compatibility', async () => {
        sendRPC.mockResolvedValue({
            items: [],
            total: 0,
            limit: 0,
            offset: 0,
            has_more: false
        });
        const w = mount(SourceComponentPicker, {
            props: {roleKey: 'burner', selected: null},
            attachTo: document.body
        });
        await w.get('input').trigger('focus');
        await nextTick();
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.binding.listsources',
            expect.objectContaining({roleKey: 'burner', limit: 50})
        );
        w.unmount();
    });
});

describe('SourceComponentPicker — picking a candidate emits the binding ref', () => {
    it('emits select with deviceExternalId + componentKey so the parent can call bindRole', async () => {
        sendRPC.mockResolvedValue({
            items: [
                {
                    deviceExternalId: 'shelly-1',
                    deviceName: 'Shelly Plus 1PM',
                    componentKey: 'switch:0',
                    componentType: 'switch',
                    dynamicCategory: null,
                    writable: true
                }
            ],
            total: 1,
            limit: 50,
            offset: 0,
            has_more: false
        });
        const w = mount(SourceComponentPicker, {
            props: {roleKey: 'burner', selected: null},
            attachTo: document.body
        });
        await w.get('input').trigger('focus');
        await new Promise((r) => setTimeout(r, 0));
        await w.get('[data-candidate="shelly-1|switch:0"]').trigger('click');
        expect(w.emitted('select')?.[0][0]).toEqual({
            deviceExternalId: 'shelly-1',
            componentKey: 'switch:0'
        });
        w.unmount();
    });
});

describe('SourceComponentPicker — showing the current selection', () => {
    it('renders the chosen source as a pill instead of the search box when one is set', () => {
        const w = mount(SourceComponentPicker, {
            props: {
                roleKey: 'burner',
                selected: {
                    deviceExternalId: 'shelly-1',
                    componentKey: 'switch:0'
                }
            },
            attachTo: document.body
        });
        expect(w.find('[data-source="shelly-1|switch:0"]').exists()).toBe(true);
        expect(w.find('input').exists()).toBe(false);
        w.unmount();
    });

    it('emits clear when the user clicks the X so the parent can null the binding', async () => {
        const w = mount(SourceComponentPicker, {
            props: {
                roleKey: 'burner',
                selected: {
                    deviceExternalId: 'shelly-1',
                    componentKey: 'switch:0'
                }
            },
            attachTo: document.body
        });
        await w.get('.scp__clear').trigger('click');
        expect(w.emitted('clear')).toBeDefined();
        w.unmount();
    });
});
