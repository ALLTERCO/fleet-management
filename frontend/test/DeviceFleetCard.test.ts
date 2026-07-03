import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import DeviceFleetCard from '@/components/cards/DeviceFleetCard.vue';

const lazyload = {
    mounted(el: HTMLImageElement) {
        el.src = el.dataset.url ?? '';
    }
};

function virtualDevice(overrides: Record<string, unknown> = {}) {
    return {
        shellyID: 'vdev-1',
        source: 'virtual',
        online: true,
        info: {name: 'Virtual pump', app: 'Virtual Device'},
        status: {
            virtualdevice: {
                health: {status: 'online'},
                presence: 'online'
            }
        },
        meta: {virtualDevice: {visual: {}}},
        ...overrides
    };
}

describe('DeviceFleetCard — virtual status', () => {
    it('shows a ready pill for healthy virtual devices', () => {
        const w = mount(DeviceFleetCard, {
            props: {device: virtualDevice()},
            global: {directives: {lazyload}}
        });
        expect(w.text()).toContain('Ready');
    });

    it('shows degraded from the backend virtual health payload', () => {
        const w = mount(DeviceFleetCard, {
            props: {
                device: virtualDevice({
                    status: {
                        virtualdevice: {
                            health: {status: 'degraded'},
                            presence: 'degraded'
                        }
                    }
                })
            },
            global: {directives: {lazyload}}
        });
        expect(w.text()).toContain('Degraded');
    });

    it('shows preview for frontend-only wizard cards', () => {
        const w = mount(DeviceFleetCard, {
            props: {
                device: virtualDevice({
                    meta: {preview: true, virtualDevice: {visual: {}}}
                })
            },
            global: {directives: {lazyload}}
        });
        expect(w.text()).toContain('Preview');
    });
});
