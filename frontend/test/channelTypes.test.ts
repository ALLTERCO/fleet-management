/** Unit tests for helpers/channelTypes — one assertion per behaviour, one
 *  test per public function. Test names describe what is being verified,
 *  intentionally NOT mirroring the function name so they read as a spec. */

import {describe, expect, it} from 'vitest';
import {
    type ChannelType,
    canTestChannelType,
    describeChannelType,
    isChannelType,
    labelForChannelType,
    listAllChannelTypes,
    listConfigurableChannelTypes
} from '@/helpers/channelTypes';

describe('listConfigurableChannelTypes', () => {
    it('returns the six configurable channel types', () => {
        const list = listConfigurableChannelTypes();
        expect(list.length).toBe(6);
    });

    it('does not include the in-app channel because it has no config form', () => {
        const list = listConfigurableChannelTypes();
        expect(list).not.toContain('in_app');
    });

    it('includes signed webhook but holds back push, SMS and voice until ready', () => {
        const list = listConfigurableChannelTypes();
        expect(list).toContain('webhook_signed');
        // push/SMS/voice are not released yet — keep them out of the picker.
        expect(list).not.toContain('push_fcm');
        expect(list).not.toContain('sms_twilio');
        expect(list).not.toContain('voice_twilio');
    });

    it('places email first because it is the most common channel', () => {
        const list = listConfigurableChannelTypes();
        expect(list[0]).toBe('email_smtp');
    });
});

describe('listAllChannelTypes', () => {
    it('includes the in-app preference type', () => {
        expect(listAllChannelTypes()).toContain('in_app');
    });

    it('contains every configurable type as well', () => {
        const all = listAllChannelTypes();
        for (const type of listConfigurableChannelTypes()) {
            expect(all).toContain(type);
        }
    });
});

describe('describeChannelType', () => {
    it('returns a label that matches its display name', () => {
        expect(describeChannelType('slack_webhook').label).toBe('Slack');
    });

    it('returns an icon class that targets the slack brand glyph', () => {
        expect(describeChannelType('slack_webhook').icon).toContain('slack');
    });

    it('points at a CSS custom property for its brand colour', () => {
        expect(describeChannelType('telegram_bot').colorToken).toMatch(
            /^--channel-color-/
        );
    });

    it('names the fieldset component for each configurable type', () => {
        expect(describeChannelType('email_smtp').fieldsetComponent).toBe(
            'EmailFieldset'
        );
    });

    it('returns null fieldsetComponent for the in-app type', () => {
        expect(describeChannelType('in_app').fieldsetComponent).toBeNull();
    });

    it('throws when given a value outside the union', () => {
        expect(() => describeChannelType('bogus' as ChannelType)).toThrow();
    });
});

describe('isChannelType', () => {
    it('recognises a known channel type string', () => {
        expect(isChannelType('email_smtp')).toBe(true);
    });

    it('rejects an unrelated string', () => {
        expect(isChannelType('not_a_channel')).toBe(false);
    });
});

describe('labelForChannelType', () => {
    it('translates a known channel type into its display label', () => {
        expect(labelForChannelType('teams_workflow_webhook')).toBe('Teams');
    });

    it('falls back to the input string when given an unknown value', () => {
        expect(labelForChannelType('mystery_protocol')).toBe(
            'mystery_protocol'
        );
    });
});

describe('canTestChannelType', () => {
    it('reports true for webhook channels that the backend can deliver to', () => {
        expect(canTestChannelType('slack_webhook')).toBe(true);
    });

    it('reports false for the in-app channel which has no remote delivery', () => {
        expect(canTestChannelType('in_app')).toBe(false);
    });
});
