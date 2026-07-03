/** Per-type channel fieldset smoke tests — one assertion per behaviour.
 *  Heavy validation logic lives in helpers/channelValidators (tested
 *  separately); these tests only verify the presentation contract:
 *  errors render when shown, fields are wired through v-model. */

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import EmailFieldset from '@/components/modals/channelFields/EmailFieldset.vue';
import PushFcmFieldset from '@/components/modals/channelFields/PushFcmFieldset.vue';
import SlackFieldset from '@/components/modals/channelFields/SlackFieldset.vue';
import SmsTwilioFieldset from '@/components/modals/channelFields/SmsTwilioFieldset.vue';
import TeamsFieldset from '@/components/modals/channelFields/TeamsFieldset.vue';
import TelegramFieldset from '@/components/modals/channelFields/TelegramFieldset.vue';
import VoiceTwilioFieldset from '@/components/modals/channelFields/VoiceTwilioFieldset.vue';
import WebhookFieldset from '@/components/modals/channelFields/WebhookFieldset.vue';
import WebhookSignedFieldset from '@/components/modals/channelFields/WebhookSignedFieldset.vue';

const NO_ERRORS = {};
const EMAIL_BASE = {
    mode: 'custom_smtp' as const,
    from: '',
    toAddresses: '',
    host: '',
    port: 587,
    secure: false,
    authUser: '',
    authPass: ''
};

describe('EmailFieldset', () => {
    it('hides errors while showErrors is false', () => {
        const wrapper = mount(EmailFieldset, {
            props: {
                modelValue: EMAIL_BASE,
                showErrors: false,
                errors: {from: 'Invalid'}
            }
        });
        expect(wrapper.text()).not.toContain('Invalid');
    });

    it('shows the parent-supplied error once showErrors flips on', () => {
        const wrapper = mount(EmailFieldset, {
            props: {
                modelValue: EMAIL_BASE,
                showErrors: true,
                errors: {from: 'Invalid email'}
            }
        });
        expect(wrapper.text()).toContain('Invalid email');
    });

    it('omits SMTP host field when the system-SMTP mode is selected', () => {
        const wrapper = mount(EmailFieldset, {
            props: {
                modelValue: {...EMAIL_BASE, mode: 'use_system_smtp' as const},
                showErrors: false,
                errors: NO_ERRORS
            }
        });
        expect(wrapper.text()).not.toContain('SMTP host');
    });
});

describe('WebhookFieldset', () => {
    it('renders the URL field', () => {
        const wrapper = mount(WebhookFieldset, {
            props: {
                modelValue: {url: '', signingSecret: '', timeoutMs: 10000},
                showErrors: false,
                errors: NO_ERRORS
            }
        });
        expect(wrapper.text()).toContain('Webhook URL');
    });

    it('shows the URL error once showErrors is on', () => {
        const wrapper = mount(WebhookFieldset, {
            props: {
                modelValue: {url: '', signingSecret: '', timeoutMs: 10000},
                showErrors: true,
                errors: {url: 'URL is required'}
            }
        });
        expect(wrapper.text()).toContain('URL is required');
    });
});

describe('SlackFieldset', () => {
    it('shows no inline help disclosure — the fieldset stays minimal', () => {
        const wrapper = mount(SlackFieldset, {
            props: {
                modelValue: {url: '', channelOverride: ''},
                showErrors: false,
                errors: NO_ERRORS
            }
        });
        expect(wrapper.text()).not.toContain('How do I get a Slack webhook URL?');
    });
});

describe('TeamsFieldset', () => {
    it('shows no inline help disclosure — the fieldset stays minimal', () => {
        const wrapper = mount(TeamsFieldset, {
            props: {
                modelValue: {url: ''},
                showErrors: false,
                errors: NO_ERRORS
            }
        });
        expect(wrapper.text()).not.toContain('How do I get a Teams workflow URL?');
    });
});

describe('TelegramFieldset', () => {
    it('renders bot-token and chat-ID fields', () => {
        const wrapper = mount(TelegramFieldset, {
            props: {
                modelValue: {botToken: '', chatId: '', parseMode: ''},
                showErrors: false,
                errors: NO_ERRORS
            }
        });
        expect(wrapper.text()).toContain('Bot token');
        expect(wrapper.text()).toContain('Chat ID');
    });

    it('shows the parent-supplied bot-token error', () => {
        const wrapper = mount(TelegramFieldset, {
            props: {
                modelValue: {botToken: '', chatId: '', parseMode: ''},
                showErrors: true,
                errors: {botToken: 'Token is required'}
            }
        });
        expect(wrapper.text()).toContain('Token is required');
    });
});

describe('PushFcmFieldset', () => {
    const baseForm = {
        token: '',
        platform: 'ios' as const,
        env: 'prod' as const
    };

    it('renders the token and platform fields', () => {
        const wrapper = mount(PushFcmFieldset, {
            props: {modelValue: baseForm, showErrors: false, errors: NO_ERRORS}
        });
        expect(wrapper.text()).toContain('Device token');
        expect(wrapper.text()).toContain('Platform');
    });

    it('hides token errors while showErrors is false', () => {
        const wrapper = mount(PushFcmFieldset, {
            props: {
                modelValue: baseForm,
                showErrors: false,
                errors: {token: 'Device token is required'}
            }
        });
        expect(wrapper.text()).not.toContain('Device token is required');
    });

    it('surfaces the parent-supplied platform error once showErrors flips on', () => {
        const wrapper = mount(PushFcmFieldset, {
            props: {
                modelValue: baseForm,
                showErrors: true,
                errors: {platform: 'Platform must be ios, android, or webpush'}
            }
        });
        expect(wrapper.text()).toContain(
            'Platform must be ios, android, or webpush'
        );
    });

    it('marks the segmented button matching the active platform', () => {
        const wrapper = mount(PushFcmFieldset, {
            props: {
                modelValue: {...baseForm, platform: 'android'},
                showErrors: false,
                errors: NO_ERRORS
            }
        });
        const active = wrapper.findAll('.cfs__seg-btn--on');
        expect(active).toHaveLength(1);
        expect(active[0].text()).toContain('Android');
    });
});

describe('SmsTwilioFieldset', () => {
    it('renders both recipient and sender fields', () => {
        const wrapper = mount(SmsTwilioFieldset, {
            props: {
                modelValue: {to: '', from: ''},
                showErrors: false,
                errors: NO_ERRORS
            }
        });
        expect(wrapper.text()).toContain('Recipient (E.164)');
        expect(wrapper.text()).toContain('Twilio sender (E.164)');
    });

    it('shows the recipient error once showErrors flips on', () => {
        const wrapper = mount(SmsTwilioFieldset, {
            props: {
                modelValue: {to: '+1', from: '+15555550199'},
                showErrors: true,
                errors: {to: 'Use E.164 format like +15555550100'}
            }
        });
        expect(wrapper.text()).toContain('Use E.164 format like +15555550100');
    });
});

describe('VoiceTwilioFieldset', () => {
    const baseForm = {to: '', from: '', twimlUrl: ''};

    it('renders recipient, sender, and TwiML URL fields', () => {
        const wrapper = mount(VoiceTwilioFieldset, {
            props: {modelValue: baseForm, showErrors: false, errors: NO_ERRORS}
        });
        expect(wrapper.text()).toContain('TwiML URL');
    });

    it('surfaces the TwiML URL error once showErrors flips on', () => {
        const wrapper = mount(VoiceTwilioFieldset, {
            props: {
                modelValue: {...baseForm, twimlUrl: 'http://example.com'},
                showErrors: true,
                errors: {twimlUrl: 'Webhook URL must use https://'}
            }
        });
        expect(wrapper.text()).toContain('Webhook URL must use https://');
    });
});

describe('WebhookSignedFieldset', () => {
    const baseForm = {url: '', signingSecret: '', timeoutMs: 10_000};

    it('renders url, secret, and timeout fields', () => {
        const wrapper = mount(WebhookSignedFieldset, {
            props: {modelValue: baseForm, showErrors: false, errors: NO_ERRORS}
        });
        expect(wrapper.text()).toContain('URL');
        expect(wrapper.text()).toContain('HMAC secret');
        expect(wrapper.text()).toContain('Timeout (ms)');
    });

    it('shows the signing-secret error once showErrors flips on', () => {
        const wrapper = mount(WebhookSignedFieldset, {
            props: {
                modelValue: {...baseForm, signingSecret: 'short'},
                showErrors: true,
                errors: {signingSecret: 'Secret must be at least 32 characters'}
            }
        });
        expect(wrapper.text()).toContain(
            'Secret must be at least 32 characters'
        );
    });
});
