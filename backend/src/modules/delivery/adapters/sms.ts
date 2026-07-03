// SMS adapter shell. Two providers (Twilio primary, MessageBird fallback)
// behind a pure dispatch function so unit tests can inject fakes.

import {smsSegmentInfo} from '../render/i18n';
import type {DeliveryPayload} from '../types';

export type SmsProvider = 'twilio' | 'messagebird';

export interface SmsToAddress {
    /** Recipient phone number in E.164 (+15555550100). */
    to: string;
}

export interface SmsDeliveryRequest {
    to: SmsToAddress;
    payload: DeliveryPayload;
}

export interface SmsDeliveryResult {
    success: boolean;
    provider: SmsProvider | null;
    providerMessageId?: string;
    segments?: number;
    retryable?: boolean;
    errorMessage?: string;
    httpStatus?: number;
}

export type SmsProviderSendFn = (params: {
    provider: SmsProvider;
    to: string;
    body: string;
}) => Promise<SmsDeliveryResult>;

// Validates E.164 — leading +, country code 1-3 digits, total 8-15 digits.
export function isValidE164(phone: string): boolean {
    return /^\+[1-9]\d{7,14}$/.test(phone);
}

export function renderSmsBody(payload: DeliveryPayload): string {
    // Severity prefix + title + short body. Keep to ~140 chars when
    // possible; the segment counter is the source of truth on billing.
    const prefix = severityPrefix(payload.severity);
    const head = `${prefix}${payload.title}`;
    if (!payload.message || payload.message === payload.title) return head;
    return `${head}: ${payload.message}`;
}

function severityPrefix(severity: 'info' | 'warning' | 'critical'): string {
    switch (severity) {
        case 'critical':
            return '[CRIT] ';
        case 'warning':
            return '[WARN] ';
        case 'info':
            return '';
    }
}

export async function sendSms(
    req: SmsDeliveryRequest,
    providerSend: SmsProviderSendFn,
    providers: readonly SmsProvider[] = ['twilio', 'messagebird']
): Promise<SmsDeliveryResult> {
    if (!isValidE164(req.to.to)) {
        return {
            success: false,
            provider: null,
            errorMessage: 'invalid E.164 phone number'
        };
    }
    const body = renderSmsBody(req.payload);
    const segments = smsSegmentInfo(body).segments;
    let last: SmsDeliveryResult | null = null;
    for (const provider of providers) {
        const result = await providerSend({
            provider,
            to: req.to.to,
            body
        });
        if (result.success) return {...result, provider, segments};
        last = result;
        // Non-retryable failure: don't try the next provider; the issue
        // is structural (bad number, blocked recipient, etc).
        if (!result.retryable) break;
    }
    return {
        success: false,
        provider: null,
        segments,
        errorMessage: last?.errorMessage ?? 'all SMS providers failed',
        retryable: last?.retryable ?? false
    };
}

// TCPA "any reasonable means" — match incoming-reply text against the
// canonical opt-out / opt-in word list. Caller treats true as a STOP
// signal and writes to recipient_suppressions.
const STOP_WORDS = new Set([
    'STOP',
    'UNSUBSCRIBE',
    'QUIT',
    'END',
    'CANCEL',
    'OPT OUT',
    'OPTOUT',
    'STOPALL'
]);
const START_WORDS = new Set(['START', 'YES', 'UNSTOP', 'OPT IN', 'OPTIN']);

export function classifySmsReply(body: string): 'optout' | 'optin' | 'neither' {
    const norm = body.trim().toUpperCase();
    if (STOP_WORDS.has(norm)) return 'optout';
    if (START_WORDS.has(norm)) return 'optin';
    return 'neither';
}
