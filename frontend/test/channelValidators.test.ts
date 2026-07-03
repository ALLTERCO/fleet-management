/** Unit tests for helpers/channelValidators — one assertion per behaviour,
 *  one focus per test. Test names describe the rule, not the function. */

import {describe, expect, it} from 'vitest';
import {
    validateChannelName,
    validateEmailAddress,
    validateEmailForm,
    validateEmailRecipientList,
    validateQuietHourBound,
    validateSlackForm,
    validateSlackWebhookUrl,
    validateSmtpHost,
    validateSmtpPort,
    validateTeamsForm,
    validateTeamsWorkflowUrl,
    validateTelegramBotToken,
    validateTelegramChatId,
    validateTelegramForm,
    validateTimezone,
    validateWebhookForm,
    validateWebhookTimeoutMs,
    validateWebhookUrl
} from '@/helpers/channelValidators';

describe('channel name rule', () => {
    it('accepts a normal name', () => {
        expect(validateChannelName('Ops Slack').valid).toBe(true);
    });

    it('rejects an empty string with a required-field message', () => {
        const result = validateChannelName('');
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.message).toMatch(/required/i);
    });

    it('rejects whitespace-only input', () => {
        expect(validateChannelName('   ').valid).toBe(false);
    });

    it('rejects a single-character name', () => {
        expect(validateChannelName('a').valid).toBe(false);
    });

    it('rejects names longer than the bounded maximum', () => {
        expect(validateChannelName('a'.repeat(65)).valid).toBe(false);
    });
});

describe('email address rule', () => {
    it('accepts a standard address', () => {
        expect(validateEmailAddress('ops@example.com').valid).toBe(true);
    });

    it('rejects a string with no at-sign', () => {
        expect(validateEmailAddress('opsexample.com').valid).toBe(false);
    });

    it('rejects an address missing a dot in the domain', () => {
        expect(validateEmailAddress('ops@localhost').valid).toBe(false);
    });

    it('rejects whitespace inside the address', () => {
        expect(validateEmailAddress('ops @example.com').valid).toBe(false);
    });
});

describe('email recipient list rule', () => {
    it('accepts a single comma-free address', () => {
        expect(validateEmailRecipientList('a@b.co').valid).toBe(true);
    });

    it('accepts several addresses separated by commas', () => {
        expect(
            validateEmailRecipientList('a@b.co, c@d.co , e@f.co').valid
        ).toBe(true);
    });

    it('rejects an empty list', () => {
        expect(validateEmailRecipientList('').valid).toBe(false);
    });

    it('reports the first invalid entry in the message', () => {
        const result = validateEmailRecipientList('a@b.co, broken, c@d.co');
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.message).toContain('broken');
    });
});

describe('SMTP host rule', () => {
    it('accepts a hostname', () => {
        expect(validateSmtpHost('smtp.example.com').valid).toBe(true);
    });

    it('rejects an empty host', () => {
        expect(validateSmtpHost('').valid).toBe(false);
    });

    it('rejects a host with internal whitespace', () => {
        expect(validateSmtpHost('smtp host').valid).toBe(false);
    });
});

describe('SMTP port rule', () => {
    it('accepts the standard submission port', () => {
        expect(validateSmtpPort(587).valid).toBe(true);
    });

    it('accepts a numeric string equivalent', () => {
        expect(validateSmtpPort('587').valid).toBe(true);
    });

    it('rejects a non-integer fractional value', () => {
        expect(validateSmtpPort(587.5).valid).toBe(false);
    });

    it('rejects a port outside the TCP range', () => {
        expect(validateSmtpPort(70000).valid).toBe(false);
    });

    it('rejects zero because port zero is not deliverable', () => {
        expect(validateSmtpPort(0).valid).toBe(false);
    });
});

describe('webhook URL rule', () => {
    it('accepts an https URL with host and path', () => {
        expect(validateWebhookUrl('https://example.com/hook').valid).toBe(true);
    });

    it('rejects an http URL because plaintext webhooks are unsafe', () => {
        expect(validateWebhookUrl('http://example.com/hook').valid).toBe(false);
    });

    it('rejects garbage that cannot be parsed as a URL', () => {
        expect(validateWebhookUrl('not a url').valid).toBe(false);
    });
});

describe('Slack webhook URL rule', () => {
    it('accepts the canonical hooks.slack.com host', () => {
        expect(
            validateSlackWebhookUrl(
                'https://hooks.slack.com/services/T000/B000/abc'
            ).valid
        ).toBe(true);
    });

    it('rejects a non-Slack host even when https', () => {
        expect(validateSlackWebhookUrl('https://example.com/hook').valid).toBe(
            false
        );
    });
});

describe('Teams workflow URL rule', () => {
    it('accepts an azure logic workflow host', () => {
        expect(
            validateTeamsWorkflowUrl(
                'https://prod-1.westus.logic.azure.com/workflows/abc'
            ).valid
        ).toBe(true);
    });

    it('rejects a non-Azure host', () => {
        expect(validateTeamsWorkflowUrl('https://example.com/hook').valid).toBe(
            false
        );
    });
});

describe('Telegram bot token rule', () => {
    it('accepts a token in the documented shape', () => {
        expect(
            validateTelegramBotToken('123456:ABCDEF1234567890_AbCdEfGhIj').valid
        ).toBe(true);
    });

    it('rejects a token missing the colon separator', () => {
        expect(
            validateTelegramBotToken('123456ABCDEF1234567890_AbCdEfGhIj').valid
        ).toBe(false);
    });

    it('rejects an empty token', () => {
        expect(validateTelegramBotToken('').valid).toBe(false);
    });
});

describe('Telegram chat ID rule', () => {
    it('accepts a positive integer', () => {
        expect(validateTelegramChatId('123').valid).toBe(true);
    });

    it('accepts a negative integer for group chats', () => {
        expect(validateTelegramChatId('-100123').valid).toBe(true);
    });

    it('rejects a non-numeric string', () => {
        expect(validateTelegramChatId('abc').valid).toBe(false);
    });

    it('rejects an empty value', () => {
        expect(validateTelegramChatId('').valid).toBe(false);
    });
});

describe('quiet-hours bound rule', () => {
    it('accepts hour zero', () => {
        expect(validateQuietHourBound(0).valid).toBe(true);
    });

    it('accepts hour twenty-three', () => {
        expect(validateQuietHourBound(23).valid).toBe(true);
    });

    it('rejects hour twenty-four', () => {
        expect(validateQuietHourBound(24).valid).toBe(false);
    });

    it('rejects a negative hour', () => {
        expect(validateQuietHourBound(-1).valid).toBe(false);
    });

    it('rejects a fractional hour', () => {
        expect(validateQuietHourBound(12.5).valid).toBe(false);
    });
});

describe('timezone rule', () => {
    it('accepts a region/city IANA name', () => {
        expect(validateTimezone('Europe/Sofia').valid).toBe(true);
    });

    it('accepts UTC', () => {
        expect(validateTimezone('UTC').valid).toBe(true);
    });

    it('rejects an empty timezone', () => {
        expect(validateTimezone('').valid).toBe(false);
    });

    it('rejects a string with disallowed characters', () => {
        expect(validateTimezone('Europe/Sofia!').valid).toBe(false);
    });
});

describe('webhook timeout rule', () => {
    it('accepts the default ten-second timeout', () => {
        expect(validateWebhookTimeoutMs(10000).valid).toBe(true);
    });

    it('accepts the minimum 1s timeout', () => {
        expect(validateWebhookTimeoutMs(1000).valid).toBe(true);
    });

    it('rejects a timeout under one second', () => {
        expect(validateWebhookTimeoutMs(500).valid).toBe(false);
    });

    it('rejects a timeout above sixty seconds', () => {
        expect(validateWebhookTimeoutMs(120000).valid).toBe(false);
    });
});

describe('email form aggregate', () => {
    it('returns no errors when a custom-SMTP form is complete', () => {
        expect(
            validateEmailForm({
                mode: 'custom_smtp',
                from: 'ops@example.com',
                toAddresses: 'a@b.co',
                host: 'smtp.example.com',
                port: 587,
                authUser: '',
                authPass: ''
            })
        ).toEqual({});
    });

    it('skips SMTP fields when the system SMTP mode is selected', () => {
        const errors = validateEmailForm({
            mode: 'use_system_smtp',
            from: '',
            toAddresses: 'a@b.co',
            host: '',
            port: 0,
            authUser: '',
            authPass: ''
        });
        expect(errors).toEqual({});
    });

    it('points at the recipients field when no recipient is given', () => {
        const errors = validateEmailForm({
            mode: 'use_system_smtp',
            from: '',
            toAddresses: '',
            host: '',
            port: 0,
            authUser: '',
            authPass: ''
        });
        expect(errors.toAddresses).toBeTruthy();
    });
});

describe('webhook form aggregate', () => {
    it('returns no errors for an https URL with the default timeout', () => {
        expect(
            validateWebhookForm({url: 'https://x.co/h', timeoutMs: 10000})
        ).toEqual({});
    });

    it('reports a url error for an http URL', () => {
        expect(
            validateWebhookForm({url: 'http://x.co/h', timeoutMs: 10000}).url
        ).toBeTruthy();
    });
});

describe('slack form aggregate', () => {
    it('returns no errors when the URL is on hooks.slack.com', () => {
        expect(
            validateSlackForm({
                url: 'https://hooks.slack.com/services/T/B/c'
            })
        ).toEqual({});
    });
});

describe('teams form aggregate', () => {
    it('returns no errors when the URL is on logic.azure.com', () => {
        expect(
            validateTeamsForm({
                url: 'https://prod.eu.logic.azure.com/workflows/x'
            })
        ).toEqual({});
    });
});

describe('telegram form aggregate', () => {
    it('returns no errors when token and chat ID are well-formed', () => {
        expect(
            validateTelegramForm({
                botToken: '123456:ABCDEF1234567890_AbCdEfGhIj',
                chatId: '-100123'
            })
        ).toEqual({});
    });
});
