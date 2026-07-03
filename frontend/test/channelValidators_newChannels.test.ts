/** Validator tests for the 4 new channel types (push, SMS, voice, signed
 *  webhook). One assertion per behaviour rule. */

import {describe, expect, it} from 'vitest';
import {
    validateE164,
    validateFcmToken,
    validateHmacSecret,
    validatePushFcmForm,
    validatePushPlatform,
    validateSmsTwilioForm,
    validateTwimlUrl,
    validateVoiceTwilioForm,
    validateWebhookSignedForm
} from '@/helpers/channelValidators';

describe('FCM device token rule', () => {
    it('accepts a normal-looking token', () => {
        expect(validateFcmToken('cYZkP0_AbCdEfGhIjKlMn').valid).toBe(true);
    });

    it('rejects an empty token because every device needs an address', () => {
        expect(validateFcmToken('').valid).toBe(false);
    });

    it('rejects a token longer than the backend cap so the server never sees an oversize body', () => {
        const overlong = 'x'.repeat(4097);
        expect(validateFcmToken(overlong).valid).toBe(false);
    });
});

describe('push platform rule', () => {
    it('accepts ios', () => {
        expect(validatePushPlatform('ios').valid).toBe(true);
    });

    it('accepts android', () => {
        expect(validatePushPlatform('android').valid).toBe(true);
    });

    it('accepts webpush', () => {
        expect(validatePushPlatform('webpush').valid).toBe(true);
    });

    it('rejects an unknown transport like "kindle"', () => {
        expect(validatePushPlatform('kindle').valid).toBe(false);
    });
});

describe('E.164 phone number rule', () => {
    it('accepts a US number with country code', () => {
        expect(validateE164('+15555550100').valid).toBe(true);
    });

    it('accepts a Bulgarian number with country code', () => {
        expect(validateE164('+359888123456').valid).toBe(true);
    });

    it('rejects a number missing the leading plus so we never let local-format slip through', () => {
        expect(validateE164('15555550100').valid).toBe(false);
    });

    it('rejects a number starting with +0 since 0 is not a valid country code', () => {
        expect(validateE164('+0555555').valid).toBe(false);
    });

    it('rejects letters in the digits section', () => {
        expect(validateE164('+1555ABC1234').valid).toBe(false);
    });
});

describe('TwiML URL rule', () => {
    it('accepts an https URL on a hosted endpoint', () => {
        expect(validateTwimlUrl('https://flow.twil.io/voice').valid).toBe(true);
    });

    it('rejects http because Twilio webhooks must be TLS-protected', () => {
        expect(validateTwimlUrl('http://example.com').valid).toBe(false);
    });
});

describe('HMAC secret rule', () => {
    it('accepts a 32-character secret at the lower bound', () => {
        expect(validateHmacSecret('x'.repeat(32)).valid).toBe(true);
    });

    it('rejects anything shorter than 32 characters because entropy collapses', () => {
        expect(validateHmacSecret('x'.repeat(31)).valid).toBe(false);
    });

    it('rejects the empty string', () => {
        expect(validateHmacSecret('').valid).toBe(false);
    });
});

describe('aggregate validatePushFcmForm', () => {
    it('returns an empty error map for a valid form', () => {
        expect(
            validatePushFcmForm({token: 'cYZkP0_A', platform: 'ios'})
        ).toEqual({});
    });

    it('flags both fields when both are bad', () => {
        const errors = validatePushFcmForm({token: '', platform: 'wat'});
        expect(errors.token).toBeDefined();
        expect(errors.platform).toBeDefined();
    });
});

describe('aggregate validateSmsTwilioForm', () => {
    it('returns an empty error map for a valid form', () => {
        expect(
            validateSmsTwilioForm({to: '+15555550100', from: '+15555550199'})
        ).toEqual({});
    });

    it('flags the recipient field when its number is malformed', () => {
        const errors = validateSmsTwilioForm({to: '+1', from: '+15555550199'});
        expect(errors.to).toBeDefined();
        expect(errors.from).toBeUndefined();
    });
});

describe('aggregate validateVoiceTwilioForm', () => {
    it('returns an empty error map for a valid form', () => {
        expect(
            validateVoiceTwilioForm({
                to: '+15555550100',
                from: '+15555550199',
                twimlUrl: 'https://flow.twil.io/v'
            })
        ).toEqual({});
    });

    it('flags the TwiML URL when it uses plain http', () => {
        const errors = validateVoiceTwilioForm({
            to: '+15555550100',
            from: '+15555550199',
            twimlUrl: 'http://flow.example.com/v'
        });
        expect(errors.twimlUrl).toBeDefined();
    });
});

describe('aggregate validateWebhookSignedForm', () => {
    it('returns an empty error map for a valid form', () => {
        expect(
            validateWebhookSignedForm({
                url: 'https://receiver.example.com',
                signingSecret: 'x'.repeat(32),
                timeoutMs: 10_000
            })
        ).toEqual({});
    });

    it('flags the signing secret when it is shorter than the entropy floor', () => {
        const errors = validateWebhookSignedForm({
            url: 'https://receiver.example.com',
            signingSecret: 'too-short',
            timeoutMs: 10_000
        });
        expect(errors.signingSecret).toBeDefined();
    });

    it('flags the timeout when it is below the legal floor', () => {
        const errors = validateWebhookSignedForm({
            url: 'https://receiver.example.com',
            signingSecret: 'x'.repeat(32),
            timeoutMs: 50
        });
        expect(errors.timeoutMs).toBeDefined();
    });
});
