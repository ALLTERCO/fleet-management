import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import WaitingRoomDeviceCard from '@/components/cards/WaitingRoomDeviceCard.vue';
import type {PendingDevice} from '@/composables/useWaitingRoomList';

// A sleeping (battery) device reports sys.wakeup_period; the card flags it so an
// operator knows the card won't refresh in real time.
function device(sys: Record<string, unknown>): PendingDevice {
    return {
        shellyID: 'shellyplus2pm-aabbcc',
        status: {sys},
        touchedAt: Date.now()
    } as unknown as PendingDevice;
}

function mountCard(dev: PendingDevice) {
    return mount(WaitingRoomDeviceCard, {
        props: {device: dev, canAccept: true, canReject: true, showReject: true},
        attachTo: document.body,
        // Button/Pill pull in Pinia stores irrelevant to the badge under test.
        global: {stubs: {Button: true, Pill: true}}
    });
}

describe('WaitingRoomDeviceCard sleeping badge', () => {
    it('shows the sleeping badge when the device reports a wakeup_period', () => {
        const wrapper = mountCard(device({wakeup_period: 3600}));
        expect(wrapper.find('.wrc-header__sleep').exists()).toBe(true);
        wrapper.unmount();
    });

    it('hides the badge for an always-on device', () => {
        const wrapper = mountCard(device({}));
        expect(wrapper.find('.wrc-header__sleep').exists()).toBe(false);
        wrapper.unmount();
    });
});
