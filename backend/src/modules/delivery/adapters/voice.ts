// Phase 6e: voice channel (TTS body + DTMF ack code).
//
// Renders an SSML script for outbound voice calls and a short DTMF
// challenge so the call recipient can ack/snooze without leaving the
// call. Concrete provider IO (Twilio Programmable Voice / Telnyx /
// MessageBird Voice) is injected the same way as the SMS/push adapters
// so tests stay deterministic.

import {createHmac, randomInt, timingSafeEqual} from 'node:crypto';

import {toCanonical} from '../render/canonical';
import type {DeliveryPayload} from '../types';

export type VoiceProvider = 'twilio' | 'telnyx' | 'messagebird';

export interface VoiceDeliveryRequest {
    to: {to: string};
    payload: DeliveryPayload;
    /** HMAC secret used to bind ack codes to (alertId, recipient). */
    ackSigningKey: string;
    locale?: string;
    voiceName?: string;
}

export interface VoiceDeliveryResult {
    success: boolean;
    provider?: VoiceProvider;
    providerCallId?: string;
    retryable?: boolean;
    errorMessage?: string;
    httpStatus?: number;
}

export type VoiceProviderSendFn = (params: {
    provider: VoiceProvider;
    to: string;
    ssml: string;
    ackCode: string;
    ackSignature: string;
    ackKeys: VoiceAckKey[];
    locale: string;
    voiceName: string;
}) => Promise<VoiceDeliveryResult>;

export interface VoiceAckKey {
    digit: '1' | '2' | '3';
    intent: 'ack' | 'snooze' | 'resolve';
}

export const VOICE_ACK_KEYMAP: ReadonlyArray<VoiceAckKey> = Object.freeze([
    {digit: '1', intent: 'ack'},
    {digit: '2', intent: 'snooze'},
    {digit: '3', intent: 'resolve'}
]);

const E164_RE = /^\+[1-9]\d{7,14}$/;
const PROVIDER_ORDER: ReadonlyArray<VoiceProvider> = ['twilio', 'telnyx'];

export function isValidE164(value: string): boolean {
    return E164_RE.test(value);
}

export function generateAckCode(): string {
    // 6-digit zero-padded numeric code. randomInt is crypto-strong.
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function signAckCode(params: {
    alertId: number;
    recipient: string;
    code: string;
    key: string;
}): string {
    return createHmac('sha256', params.key)
        .update(`${params.alertId}|${params.recipient}|${params.code}`)
        .digest('hex')
        .slice(0, 32);
}

export function verifyAckCode(params: {
    alertId: number;
    recipient: string;
    code: string;
    signature: string;
    key: string;
}): boolean {
    const expected = signAckCode(params);
    if (expected.length !== params.signature.length) return false;
    return timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(params.signature)
    );
}

// Build an SSML body. We keep it small and provider-agnostic; Twilio
// <Say>, Telnyx <Speak> and MessageBird all accept SSML 1.0.
export function renderVoiceSsml(
    payload: DeliveryPayload,
    ackCode: string,
    voiceName: string = 'Polly.Joanna'
): string {
    const c = toCanonical(payload);
    const severity = sayWord(c.severity);
    const titleSafe = escapeSsml(c.title);
    const bodySafe = escapeSsml(c.body);
    const intro =
        c.state === 'resolved'
            ? 'This is a Shelly Fleet Manager recovery notification.'
            : `This is a ${severity} Shelly Fleet Manager alert.`;
    const keyPrompt = VOICE_ACK_KEYMAP.map(
        (k) => `Press ${k.digit} to ${k.intent}.`
    ).join(' ');
    return [
        '<speak>',
        `<voice name="${voiceName}">`,
        `<p>${intro}</p>`,
        `<p>${titleSafe}.</p>`,
        `<p>${bodySafe}</p>`,
        '<break time="500ms"/>',
        `<p>${keyPrompt}</p>`,
        `<p>To stop these calls reply with the word stop on S M S.</p>`,
        `<p>Your confirmation code is <say-as interpret-as="digits">${ackCode}</say-as>.</p>`,
        '</voice>',
        '</speak>'
    ].join('');
}

export async function sendVoice(
    req: VoiceDeliveryRequest,
    providerSend: VoiceProviderSendFn,
    providers: readonly VoiceProvider[] = PROVIDER_ORDER
): Promise<VoiceDeliveryResult> {
    if (!isValidE164(req.to.to)) {
        return {
            success: false,
            retryable: false,
            errorMessage: 'invalid E.164 number'
        };
    }
    const ackCode = generateAckCode();
    const ackSignature = signAckCode({
        alertId: req.payload.alertId ?? 0,
        recipient: req.to.to,
        code: ackCode,
        key: req.ackSigningKey
    });
    const voiceName = req.voiceName ?? 'Polly.Joanna';
    const locale = req.locale ?? 'en-US';
    const ssml = renderVoiceSsml(req.payload, ackCode, voiceName);

    let lastError: VoiceDeliveryResult | null = null;
    for (const provider of providers) {
        const result = await providerSend({
            provider,
            to: req.to.to,
            ssml,
            ackCode,
            ackSignature,
            ackKeys: VOICE_ACK_KEYMAP.slice(),
            locale,
            voiceName
        });
        if (result.success) return result;
        lastError = result;
        if (!result.retryable) return result;
    }
    return (
        lastError ?? {
            success: false,
            retryable: true,
            errorMessage: 'no voice provider attempted'
        }
    );
}

function sayWord(severity: 'critical' | 'warning' | 'info'): string {
    switch (severity) {
        case 'critical':
            return 'critical';
        case 'warning':
            return 'warning level';
        case 'info':
            return 'informational';
    }
}

function escapeSsml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
