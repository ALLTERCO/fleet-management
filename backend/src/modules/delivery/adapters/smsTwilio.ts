// Twilio SMS adapter. Account creds from env (FM_TWILIO_ACCOUNT_SID +
// FM_TWILIO_AUTH_TOKEN), per-endpoint `to` + `from` from config.

import {envCred, readString} from '../../util/objectReaders';
import type {DeliveryAdapter, DeliveryResult} from '../types';
import {type SmsProviderSendFn, sendSms} from './sms';
import {twilioPost} from './twilioClient';

export const smsTwilioAdapter: DeliveryAdapter = {
    provider: 'sms_twilio',
    async send(payload, context): Promise<DeliveryResult> {
        const accountSid = envCred('FM_TWILIO_ACCOUNT_SID');
        const authToken = envCred('FM_TWILIO_AUTH_TOKEN');
        if (!accountSid || !authToken) {
            return {
                state: 'failed',
                errorMessage:
                    'Twilio SMS not configured — set FM_TWILIO_ACCOUNT_SID + FM_TWILIO_AUTH_TOKEN.'
            };
        }
        const to = readString(context.config, 'to');
        const from = readString(context.config, 'from');
        const messagingServiceSid = readString(
            context.config,
            'messagingServiceSid'
        );
        const statusCallback = readString(context.config, 'statusCallback');
        if (!to || (!from && !messagingServiceSid)) {
            return {
                state: 'failed',
                errorMessage:
                    'sms_twilio config needs `to` and one of `from` / `messagingServiceSid`.'
            };
        }
        const providerSend: SmsProviderSendFn = async ({body}) => {
            const r = await twilioPost({
                accountSid,
                authToken,
                resource: 'Messages.json',
                form: buildTwilioSmsForm({
                    to,
                    from,
                    messagingServiceSid,
                    statusCallback,
                    body
                })
            });
            return r.success
                ? {
                      success: true,
                      provider: 'twilio',
                      providerMessageId: r.sid,
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
        // to the next provider slot and re-send to Twilio in the same attempt.
        const result = await sendSms({to: {to}, payload}, providerSend, [
            'twilio'
        ]);
        return mapResult(result);
    }
};

// Build the Twilio Messages form. Messaging Service wins over From; both
// statusCallback and the sender fields are optional at this layer (the
// adapter guards that a sender is present).
export function buildTwilioSmsForm(input: {
    to: string;
    body: string;
    from?: string | null;
    messagingServiceSid?: string | null;
    statusCallback?: string | null;
}): Record<string, string> {
    const form: Record<string, string> = {To: input.to, Body: input.body};
    if (input.messagingServiceSid) {
        form.MessagingServiceSid = input.messagingServiceSid;
    } else if (input.from) {
        form.From = input.from;
    }
    if (input.statusCallback) form.StatusCallback = input.statusCallback;
    return form;
}

function mapResult(r: {
    success: boolean;
    providerMessageId?: string;
    errorMessage?: string;
    retryable?: boolean;
    httpStatus?: number;
}): DeliveryResult {
    if (r.success) {
        return {
            state: 'succeeded',
            providerCode: r.providerMessageId ?? null,
            httpStatus: r.httpStatus ?? null
        };
    }
    return {
        state: 'failed',
        errorMessage: r.errorMessage ?? 'sms send failed',
        retryAfterSec: r.retryable ? 60 : null,
        httpStatus: r.httpStatus ?? null
    };
}
