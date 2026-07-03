import {sanitizeStatus} from '../WaitingRoom/sanitize';
import type {SanitizedStatusShape} from '../WaitingRoom/types';
import {truncateSafeDetail} from './redaction';

export interface IngressSafeDetailInput {
    reportedExternalId: string;
    requestSummary: Record<string, unknown>;
    rawData: Buffer;
    maxBytes: number;
}

export function buildIngressSafeDetail(
    input: IngressSafeDetailInput
): Record<string, unknown> {
    const detail: Record<string, unknown> = {
        reportedExternalId: input.reportedExternalId,
        request: truncateSafeDetail(input.requestSummary, input.maxBytes)
    };
    const status = statusFromInitPayload(input.rawData);
    if (hasStatusFields(status)) detail.status = status;
    return detail;
}

export function statusFromSafeDetail(
    safeDetail: Record<string, unknown>
): SanitizedStatusShape {
    return sanitizeStatus(recordValue(safeDetail, 'status') ?? {});
}

function statusFromInitPayload(rawData: Buffer): SanitizedStatusShape {
    return sanitizeStatus(recordValue(parseJson(rawData), 'params') ?? {});
}

function parseJson(rawData: Buffer): unknown {
    try {
        return JSON.parse(rawData.toString('utf8'));
    } catch {
        return {};
    }
}

function recordValue(
    source: unknown,
    key: string
): Record<string, unknown> | undefined {
    if (!isRecord(source)) return undefined;
    const value = source[key];
    return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasStatusFields(status: SanitizedStatusShape): boolean {
    return Object.keys(status).length > 0;
}
