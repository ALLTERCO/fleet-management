import type {DeliveryResult} from './types';

export type DeliveryFailureKind = 'retryable' | 'permanent';

export interface DeliveryFailureClassification {
    kind: DeliveryFailureKind;
    reason: string;
}

const RETRYABLE_HTTP_STATUS = new Set([408, 409, 425, 429]);
const PERMANENT_HTTP_STATUS = new Set([
    400, 401, 403, 404, 405, 410, 413, 414, 415, 422
]);

const RETRYABLE_ERROR_PATTERNS = [
    /\bECONNRESET\b/i,
    /\bECONNREFUSED\b/i,
    /\bETIMEDOUT\b/i,
    /\bEAI_AGAIN\b/i,
    /\bENOTFOUND\b/i,
    /\btimeout\b/i,
    /\babort/i,
    /\bCircuitOpen\b/i,
    /\bDNS lookup failed\b/i
];

const PERMANENT_ERROR_PATTERNS = [
    /\bnot configured\b/i,
    /\bis required\b/i,
    /\binvalid URL\b/i,
    /\bSSRF:/i,
    /\bexceeds\b/i,
    /\bauthentication failed\b/i,
    /\binvalid token\b/i,
    /\bunauthorized\b/i,
    /\bforbidden\b/i
];

export function classifyDeliveryFailure(
    result: DeliveryResult
): DeliveryFailureClassification {
    if (result.state !== 'failed') {
        return {kind: 'permanent', reason: 'delivery succeeded'};
    }
    if (hasRetryAfter(result)) {
        return {kind: 'retryable', reason: 'provider requested retry-after'};
    }
    const http = classifyHttpStatus(result.httpStatus);
    if (http) return http;

    const textHttp = classifyHttpStatusFromMessage(result.errorMessage);
    if (textHttp) return textHttp;

    const smtp = classifySmtpStatus(result.errorMessage);
    if (smtp) return smtp;

    const message = result.errorMessage ?? '';
    if (matchesAny(message, PERMANENT_ERROR_PATTERNS)) {
        return {kind: 'permanent', reason: 'permanent provider/config error'};
    }
    if (matchesAny(message, RETRYABLE_ERROR_PATTERNS)) {
        return {kind: 'retryable', reason: 'transient transport error'};
    }
    return {kind: 'retryable', reason: 'unclassified failure'};
}

function hasRetryAfter(result: DeliveryResult): boolean {
    return typeof result.retryAfterSec === 'number' && result.retryAfterSec > 0;
}

function classifyHttpStatus(
    status: number | null | undefined
): DeliveryFailureClassification | null {
    if (typeof status !== 'number') return null;
    if (RETRYABLE_HTTP_STATUS.has(status) || status >= 500) {
        return {kind: 'retryable', reason: `retryable HTTP ${status}`};
    }
    if (PERMANENT_HTTP_STATUS.has(status)) {
        return {kind: 'permanent', reason: `permanent HTTP ${status}`};
    }
    return null;
}

function classifyHttpStatusFromMessage(
    message: string | null | undefined
): DeliveryFailureClassification | null {
    if (!message) return null;
    const match = /\b(?:HTTP|webhook)\s+([45]\d{2})\b/i.exec(message);
    if (!match) return null;
    return classifyHttpStatus(Number(match[1]));
}

function classifySmtpStatus(
    message: string | null | undefined
): DeliveryFailureClassification | null {
    if (!message) return null;
    const match =
        /\b(?:SMTP|ESMTP|mail|mailbox|recipient|sender|RCPT|DATA|MAIL FROM)\b[\s\S]{0,80}\b([45]\d{2})\b/i.exec(
            message
        ) ??
        /\b([45]\d{2})\b(?:[ -][245]\.\d\.\d)?[\s\S]{0,80}\b(?:SMTP|mail|mailbox|recipient|sender|user unknown|relay|quota|greylist|temporary|permanent|local problem)\b/i.exec(
            message
        );
    if (!match) return null;
    const code = Number(match[1]);
    if (code >= 400 && code < 500) {
        return {kind: 'retryable', reason: `retryable SMTP ${code}`};
    }
    if (code >= 500 && code < 600) {
        return {kind: 'permanent', reason: `permanent SMTP ${code}`};
    }
    return null;
}

function matchesAny(message: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(message));
}
