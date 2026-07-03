import {envStr} from '../../config/envReader';
import * as Observability from '../Observability';
import {
    normalizeProviderReceipt,
    verifyProviderReceiptSignature
} from './ProviderReceiptHandler';
import {storeProviderReceipt} from './ProviderReceiptStore';

const SIGNATURE_HEADER = 'x-fm-signature';
const RECEIPT_SECRET_ENV = 'FM_NOTIFICATION_RECEIPT_SIGNING_SECRET';

export interface ProviderReceiptCallbackInput {
    provider: string;
    rawBody: Buffer | string | undefined;
    signatureHeader: string | undefined;
    payload: unknown;
}

export interface ProviderReceiptCallbackResult {
    ok: true;
    receiptId: number;
    suppressionId: number | null;
}

export async function handleProviderReceiptCallback(
    input: ProviderReceiptCallbackInput
): Promise<ProviderReceiptCallbackResult> {
    const secret = envStr(RECEIPT_SECRET_ENV, '');
    if (!secret) {
        throw new Error(`${RECEIPT_SECRET_ENV} is not configured`);
    }
    const payload = parseReceiptPayload(input.payload);
    const rawBody = input.rawBody ?? JSON.stringify(payload);
    const signature = verifyProviderReceiptSignature({
        rawBody,
        secret,
        signatureHeader: input.signatureHeader
    });
    if (!signature.ok) {
        Observability.incrementCounter(
            'notification_receipt_signature_rejects'
        );
        throw new Error(`invalid receipt signature: ${signature.reason}`);
    }

    const organizationId = readRequiredString(payload, 'organizationId');
    const endpointId = readOptionalNumber(payload, 'endpointId');
    const receipt = normalizeProviderReceipt({
        provider: input.provider,
        payload
    });
    const stored = await storeProviderReceipt({
        organizationId,
        endpointId,
        receipt,
        payload
    });
    Observability.incrementCounter(`notification_receipt_${receipt.kind}`);
    return {ok: true, ...stored};
}

export function receiptSignatureHeaderName(): string {
    return SIGNATURE_HEADER;
}

function parseReceiptPayload(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    throw new Error('receipt payload must be a JSON object');
}

function readRequiredString(
    payload: Record<string, unknown>,
    key: string
): string {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    throw new Error(`receipt payload requires ${key}`);
}

function readOptionalNumber(
    payload: Record<string, unknown>,
    key: string
): number | null {
    const value = payload[key];
    if (value == null) return null;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
    }
    throw new Error(`receipt payload ${key} must be a positive integer`);
}
