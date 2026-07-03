/** Unit tests for ChannelStatusBadge — one assertion per behaviour. */

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import ChannelStatusBadge from '@/components/core/ChannelStatusBadge.vue';

describe('ChannelStatusBadge label', () => {
    it('reads "Verified" when the upstream test succeeded', () => {
        const wrapper = mount(ChannelStatusBadge, {
            props: {verificationStatus: 'verified'}
        });
        expect(wrapper.text()).toBe('Verified');
    });

    it('reads "Failed" when the upstream test failed', () => {
        const wrapper = mount(ChannelStatusBadge, {
            props: {verificationStatus: 'failed'}
        });
        expect(wrapper.text()).toBe('Failed');
    });

    it('reads "Pending" while the channel has not been tested yet', () => {
        const wrapper = mount(ChannelStatusBadge, {
            props: {verificationStatus: 'pending'}
        });
        expect(wrapper.text()).toBe('Pending');
    });

    it('reads "Unverified" as a synonym for pending', () => {
        const wrapper = mount(ChannelStatusBadge, {
            props: {verificationStatus: 'unverified'}
        });
        expect(wrapper.text()).toBe('Unverified');
    });

    it('falls back to "Unknown" for an unrecognised status string', () => {
        const wrapper = mount(ChannelStatusBadge, {
            props: {verificationStatus: 'wat'}
        });
        expect(wrapper.text()).toBe('Unknown');
    });

    it('falls back to "Unknown" when verificationStatus is missing', () => {
        const wrapper = mount(ChannelStatusBadge);
        expect(wrapper.text()).toBe('Unknown');
    });
});

describe('ChannelStatusBadge disabled precedence', () => {
    it('shows "Disabled" when the channel is disabled regardless of test status', () => {
        const wrapper = mount(ChannelStatusBadge, {
            props: {
                verificationStatus: 'verified',
                disabledReason: 'admin_disabled'
            }
        });
        expect(wrapper.text()).toBe('Disabled');
    });
});

describe('ChannelStatusBadge variant class', () => {
    it('applies the verified variant class for the verified status', () => {
        const wrapper = mount(ChannelStatusBadge, {
            props: {verificationStatus: 'verified'}
        });
        expect(wrapper.classes()).toContain('csb--verified');
    });

    it('applies the failed variant class for the failed status', () => {
        const wrapper = mount(ChannelStatusBadge, {
            props: {verificationStatus: 'failed'}
        });
        expect(wrapper.classes()).toContain('csb--failed');
    });

    it('applies the pending variant class for the pending status', () => {
        const wrapper = mount(ChannelStatusBadge, {
            props: {verificationStatus: 'pending'}
        });
        expect(wrapper.classes()).toContain('csb--pending');
    });
});
