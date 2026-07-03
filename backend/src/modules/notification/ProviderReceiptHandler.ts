import {createHmac, timingSafeEqual} from 'node:crypto';

export type ProviderReceiptKind =
    | 'delivered'
    | 'bounced'
    | 'complained'
    | 'suppressed'
    | 'unknown';

export interface NormalizedProviderReceipt {
    provider: string;
    kind: ProviderReceiptKind;
    providerMessageId: string | null;
    recipient: string | null;
    occurredAt: string;
    rawEventType: string | null;
}

export function verifyProviderReceiptSignature(input: {
    rawBody: Buffer | string;
    signatureHeader: string | undefined;
    secret: string;
    nowMs?: number;
    toleranceSec?: number;
}): {ok: true} | {ok: false; reason: string} {
    if (!input.signatureHeader) return {ok: false, reason: 'missing'};
    if (!input.secret) return {ok: false, reason: 'missing_secret'};

    const parsed = parseTimestampedSignature(input.signatureHeader);
    if (!parsed) return {ok: false, reason: 'malformed'};

    const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
    const tolerance = input.toleranceSec ?? 300;
    if (Math.abs(nowSec - parsed.timestampSec) > tolerance) {
        return {ok: false, reason: 'expired'};
    }

    const expected = signReceiptBody({
        rawBody: input.rawBody,
        secret: input.secret,
        timestampSec: parsed.timestampSec
    });
    if (!safeEquals(expected, parsed.signatureHex)) {
        return {ok: false, reason: 'mismatch'};
    }
    return {ok: true};
}

export function normalizeProviderReceipt(input: {
    provider: string;
    payload: Record<string, unknown>;
    nowIso?: string;
}): NormalizedProviderReceipt {
    const adapted = normalizeKnownProviderReceipt(input);
    if (adapted) return adapted;

    const eventType = readString(input.payload, [
        'event',
        'eventType',
        'type',
        'status'
    ]);
    return {
        provider: input.provider,
        kind: classifyReceiptKind(eventType),
        providerMessageId: readString(input.payload, [
            'messageId',
            'message_id',
            'providerMessageId',
            'id'
        ]),
        recipient: readString(input.payload, ['recipient', 'email', 'to']),
        occurredAt:
            normalizeTimestamp(
                input.payload.timestamp ??
                    input.payload.ts ??
                    input.payload.time
            ) ??
            input.nowIso ??
            new Date().toISOString(),
        rawEventType: eventType
    };
}

type ProviderReceiptAdapter = (input: {
    provider: string;
    payload: Record<string, unknown>;
    nowIso?: string;
}) => NormalizedProviderReceipt | null;

const PROVIDER_RECEIPT_ADAPTERS: Readonly<
    Record<string, ProviderReceiptAdapter>
> = {
    ses: normalizeSesReceipt,
    aws_ses: normalizeSesReceipt,
    sendgrid: normalizeSendgridReceipt,
    mailgun: normalizeMailgunReceipt,
    postmark: normalizePostmarkReceipt
};

function normalizeKnownProviderReceipt(input: {
    provider: string;
    payload: Record<string, unknown>;
    nowIso?: string;
}): NormalizedProviderReceipt | null {
    const adapter = PROVIDER_RECEIPT_ADAPTERS[input.provider.toLowerCase()];
    return adapter?.(input) ?? null;
}

function normalizeSesReceipt(input: {
    provider: string;
    payload: Record<string, unknown>;
    nowIso?: string;
}): NormalizedProviderReceipt | null {
    const eventType = readString(input.payload, [
        'notificationType',
        'eventType'
    ]);
    if (!eventType) return null;
    const mail = readNestedObject(input.payload, 'mail');
    const recipient = readSesRecipient(input.payload);
    return {
        provider: input.provider,
        kind: classifyReceiptKind(eventType),
        providerMessageId: readString(mail, ['messageId']),
        recipient,
        occurredAt:
            normalizeTimestamp(
                readNestedValue(input.payload, ['mail', 'timestamp'])
            ) ??
            input.nowIso ??
            new Date().toISOString(),
        rawEventType: eventType
    };
}

function normalizeSendgridReceipt(input: {
    provider: string;
    payload: Record<string, unknown>;
    nowIso?: string;
}): NormalizedProviderReceipt | null {
    const eventType = readString(input.payload, ['event']);
    if (!eventType) return null;
    return {
        provider: input.provider,
        kind: classifyReceiptKind(eventType),
        providerMessageId: readString(input.payload, [
            'sg_message_id',
            'smtp-id',
            'messageId'
        ]),
        recipient: readString(input.payload, ['email']),
        occurredAt:
            normalizeTimestamp(input.payload.timestamp) ??
            input.nowIso ??
            new Date().toISOString(),
        rawEventType: eventType
    };
}

function normalizeMailgunReceipt(input: {
    provider: string;
    payload: Record<string, unknown>;
    nowIso?: string;
}): NormalizedProviderReceipt | null {
    const eventData = readNestedObject(input.payload, 'event-data');
    const eventType = readString(eventData, ['event']);
    if (!eventType) return null;
    return {
        provider: input.provider,
        kind: classifyReceiptKind(eventType),
        providerMessageId:
            readString(eventData, ['id']) ??
            readNestedString(eventData, ['message', 'headers', 'message-id']),
        recipient: readString(eventData, ['recipient']),
        occurredAt:
            normalizeTimestamp(eventData.timestamp) ??
            input.nowIso ??
            new Date().toISOString(),
        rawEventType: eventType
    };
}

function normalizePostmarkReceipt(input: {
    provider: string;
    payload: Record<string, unknown>;
    nowIso?: string;
}): NormalizedProviderReceipt | null {
    const eventType = readString(input.payload, ['RecordType']);
    if (!eventType) return null;
    return {
        provider: input.provider,
        kind: classifyReceiptKind(eventType),
        providerMessageId: readString(input.payload, ['MessageID']),
        recipient: readString(input.payload, ['Recipient', 'Email']),
        occurredAt:
            normalizeTimestamp(input.payload.ReceivedAt) ??
            input.nowIso ??
            new Date().toISOString(),
        rawEventType: eventType
    };
}

function parseTimestampedSignature(
    header: string
): {timestampSec: number; signatureHex: string} | null {
    const parts = new Map(
        header.split(',').map((part) => {
            const [key, value] = part.split('=');
            return [key?.trim(), value?.trim()] as const;
        })
    );
    const timestampSec = Number(parts.get('t'));
    const signatureHex = parts.get('v1');
    if (!Number.isInteger(timestampSec) || !signatureHex) return null;
    if (!/^[a-f0-9]{64}$/i.test(signatureHex)) return null;
    return {timestampSec, signatureHex};
}

export function signReceiptBody(input: {
    rawBody: Buffer | string;
    secret: string;
    timestampSec: number;
}): string {
    return createHmac('sha256', input.secret)
        .update(`${input.timestampSec}.`)
        .update(input.rawBody)
        .digest('hex');
}

function safeEquals(expectedHex: string, actualHex: string): boolean {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(actualHex, 'hex');
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
}

function classifyReceiptKind(eventType: string | null): ProviderReceiptKind {
    const normalized = eventType?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
    if (['delivered', 'delivery', 'sent', 'success'].includes(normalized)) {
        return 'delivered';
    }
    if (
        ['bounce', 'bounced', 'failed', 'permanentfailure'].includes(normalized)
    ) {
        return 'bounced';
    }
    if (['complaint', 'complained', 'spamreport'].includes(normalized)) {
        return 'complained';
    }
    if (['suppressed', 'unsubscribe', 'unsubscribed'].includes(normalized)) {
        return 'suppressed';
    }
    return 'unknown';
}

function readString(
    payload: Record<string, unknown>,
    keys: readonly string[]
): string | null {
    for (const key of keys) {
        const value = payload[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

function readNestedObject(
    payload: Record<string, unknown>,
    key: string
): Record<string, unknown> {
    const value = payload[key];
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function readNestedValue(
    payload: Record<string, unknown>,
    path: readonly string[]
): unknown {
    let cursor: unknown = payload;
    for (const key of path) {
        if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
            return undefined;
        }
        cursor = (cursor as Record<string, unknown>)[key];
    }
    return cursor;
}

function readNestedString(
    payload: Record<string, unknown>,
    path: readonly string[]
): string | null {
    const value = readNestedValue(payload, path);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readSesRecipient(payload: Record<string, unknown>): string | null {
    const deliveryRecipients = readNestedValue(payload, [
        'delivery',
        'recipients'
    ]);
    const delivered = readFirstString(deliveryRecipients);
    if (delivered) return delivered;

    const bounced = readNestedValue(payload, ['bounce', 'bouncedRecipients']);
    const bouncedRecipient = readFirstObjectString(bounced, 'emailAddress');
    if (bouncedRecipient) return bouncedRecipient;

    const complained = readNestedValue(payload, [
        'complaint',
        'complainedRecipients'
    ]);
    return readFirstObjectString(complained, 'emailAddress');
}

function readFirstString(value: unknown): string | null {
    if (!Array.isArray(value)) return null;
    const first = value.find((entry) => typeof entry === 'string');
    return typeof first === 'string' && first.trim() ? first.trim() : null;
}

function readFirstObjectString(value: unknown, key: string): string | null {
    if (!Array.isArray(value)) return null;
    for (const entry of value) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }
        const raw = (entry as Record<string, unknown>)[key];
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
    }
    return null;
}

function normalizeTimestamp(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(
            value < 10_000_000_000 ? value * 1000 : value
        ).toISOString();
    }
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return null;
    return new Date(parsed).toISOString();
}
