// Twilio Voice adapter. Account creds from env, per-endpoint to/from +
// TwiML URL from config. TwiML URL must return <Say>/<Gather> markup;
// FM doesn't host it (customer choice — Twilio Studio / their own server).

import {envCred, readString} from '../../util/objectReaders';
import type {DeliveryAdapter, DeliveryResult} from '../types';
import {twilioPost} from './twilioClient';
import {sendVoice, type VoiceProviderSendFn} from './voice';

export const voiceTwilioAdapter: DeliveryAdapter = {
    provider: 'voice_twilio',
    async send(payload, context): Promise<DeliveryResult> {
        const accountSid = envCred('FM_TWILIO_ACCOUNT_SID');
        const authToken = envCred('FM_TWILIO_AUTH_TOKEN');
        const ackSigningKey = envCred('FM_VOICE_ACK_SIGNING_KEY');
        if (!accountSid || !authToken) {
            return {
                state: 'failed',
                errorMessage:
                    'Twilio Voice not configured — set FM_TWILIO_ACCOUNT_SID + FM_TWILIO_AUTH_TOKEN.'
            };
        }
        if (!ackSigningKey) {
            return {
                state: 'failed',
                errorMessage:
                    'FM_VOICE_ACK_SIGNING_KEY not set — required to bind DTMF ack codes.'
            };
        }
        const to = readString(context.config, 'to');
        const from = readString(context.config, 'from');
        const twimlUrl = readString(context.config, 'twimlUrl');
        if (!to || !from || !twimlUrl) {
            return {
                state: 'failed',
                errorMessage: 'voice_twilio config missing to/from/twimlUrl.'
            };
        }
        const providerSend: VoiceProviderSendFn = async () => {
            const r = await twilioPost({
                accountSid,
                authToken,
                resource: 'Calls.json',
                form: {To: to, From: from, Url: twimlUrl}
            });
            return r.success
                ? {
                      success: true,
                      provider: 'twilio',
                      providerCallId: r.sid,
                      httpStatus: r.httpStatus
                  }
                : {
                      success: false,
                      provider: 'twilio',
                      retryable: r.retryable,
                      errorMessage: r.errorMessage,
                      httpStatus: r.httpStatus
                  };
        };
        // Only Twilio is wired here; providerSend ignores the provider arg.
        // Restrict to ['twilio'] so a retryable failure doesn't fall through
        // to the next provider slot and place a second call in the same attempt.
        const result = await sendVoice(
            {to: {to}, payload, ackSigningKey},
            providerSend,
            ['twilio']
        );
        if (result.success) {
            return {
                state: 'succeeded',
                providerCode: result.providerCallId ?? null,
                httpStatus: result.httpStatus ?? null
            };
        }
        return {
            state: 'failed',
            errorMessage: result.errorMessage ?? 'voice send failed',
            retryAfterSec: result.retryable ? 60 : null,
            httpStatus: result.httpStatus ?? null
        };
    }
};
