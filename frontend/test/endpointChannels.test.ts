// Maps the channels (integration channels) a rule notifies to the message
// body each one uses, so the builder can show a channel-aware preview.

import {describe, expect, it} from 'vitest';
import {
    channelsForChannels,
    providerBodyKind,
    providerChannelLabel
} from '@/helpers/endpointChannels';

describe('providerChannelLabel / providerBodyKind', () => {
    it('maps rich-body providers to their dedicated channel', () => {
        expect(providerBodyKind('email_smtp')).toBe('email');
        expect(providerBodyKind('slack_webhook')).toBe('slack');
        expect(providerBodyKind('teams_workflow_webhook')).toBe('teams');
    });

    it('maps every other provider to the plain-text fallback', () => {
        expect(providerBodyKind('telegram_bot')).toBe('fallback');
        expect(providerBodyKind('sms_twilio')).toBe('fallback');
        expect(providerBodyKind('generic_webhook')).toBe('fallback');
    });

    it('gives a friendly label for a provider', () => {
        expect(providerChannelLabel('email_smtp')).toBe('Email');
        expect(providerChannelLabel('teams_workflow_webhook')).toBe('Teams');
        expect(providerChannelLabel('sms_twilio')).toBe('SMS');
    });
});

describe('channelsForChannels', () => {
    const channels = [
        {id: 1, provider: 'email_smtp'},
        {id: 2, provider: 'slack_webhook'},
        {id: 3, provider: 'email_smtp'},
        {id: 4, provider: 'sms_twilio'}
    ];

    it('returns the unique channels for the selected channels, in stable order', () => {
        const result = channelsForChannels(channels, [1, 2, 3, 4]);
        expect(result).toEqual([
            {label: 'Email', bodyKind: 'email'},
            {label: 'Slack', bodyKind: 'slack'},
            {label: 'SMS', bodyKind: 'fallback'}
        ]);
    });

    it('ignores ids that are not selected and unknown ids', () => {
        const result = channelsForChannels(channels, [2, 99]);
        expect(result).toEqual([{label: 'Slack', bodyKind: 'slack'}]);
    });
});
