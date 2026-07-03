import type {RelationshipSummaryDto} from '../../types/api/device';
import {
    certificateExpiryThresholdCrossed,
    certificateExpiryWarnDays,
    daysUntilCertificateExpiry
} from '../certificate/expiryPolicy';
import type {
    RelationshipCertificateFact,
    RelationshipCredentialStateFact,
    RelationshipOperationJobFact
} from './types';

export function operationStatus(input: {
    jobStatus: string;
    unitStatus: string;
}): RelationshipOperationJobFact['status'] {
    if (input.jobStatus === 'failed' || input.unitStatus === 'failed') {
        return 'critical';
    }
    if (['queued', 'running', 'in_progress'].includes(input.unitStatus)) {
        return 'warning';
    }
    if (['queued', 'running'].includes(input.jobStatus)) return 'warning';
    if (['done', 'ok', 'applied'].includes(input.unitStatus)) {
        return 'healthy';
    }
    return 'unknown';
}

export function securityStatus(input: {
    status: string;
}): RelationshipCredentialStateFact['status'] {
    if (input.status === 'ok') return 'healthy';
    if (input.status === 'failed') return 'critical';
    return 'unknown';
}

export function certificateStatus(input: {
    pushStatus: string;
    expiresAt: Date | string | null;
}): RelationshipCertificateFact['status'] {
    if (input.pushStatus === 'failed' || input.pushStatus === 'rolled_back') {
        return 'critical';
    }
    if (certificateIsExpired(input.expiresAt)) return 'critical';
    if (certificateIsExpiringSoon(input.expiresAt)) return 'warning';
    if (input.pushStatus === 'queued' || input.pushStatus === 'in_progress') {
        return 'warning';
    }
    if (input.pushStatus === 'applied') return 'healthy';
    return 'unknown';
}

export function certificateIsExpired(value: Date | string | null): boolean {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp <= Date.now();
}

export function certificateIsExpiringSoon(
    value: Date | string | null
): boolean {
    const daysLeft = daysUntilCertificateExpiry(value);
    if (daysLeft === null || daysLeft < 0) return false;
    return (
        certificateExpiryThresholdCrossed(
            daysLeft,
            certificateExpiryWarnDays()
        ) !== null
    );
}

export function operationNeedsAttention(
    fact: RelationshipOperationJobFact
): boolean {
    return fact.status === 'critical' || fact.status === 'warning';
}

export function operationHealthSummary(
    fact: RelationshipOperationJobFact
): RelationshipSummaryDto {
    return {
        severity: 'warning',
        text: `${fact.label} for ${fact.targetExternalId} is ${fact.status}.`,
        nodeIds: [`operation_job:${fact.kind}:${fact.id}`],
        reasonCode:
            fact.status === 'critical'
                ? 'recent_operation_failed'
                : 'recent_operation_pending'
    };
}

export function certificateNeedsAttention(
    fact: RelationshipCertificateFact
): boolean {
    return fact.status === 'critical' || fact.status === 'warning';
}

export function certificateHealthSummary(
    fact: RelationshipCertificateFact
): RelationshipSummaryDto {
    return {
        severity: certificateSummarySeverity(fact),
        text: certificateSummaryText(fact),
        nodeIds: [`certificate:${fact.id}`],
        reasonCode: certificateSummaryReasonCode(fact)
    };
}

function certificateSummarySeverity(
    fact: RelationshipCertificateFact
): RelationshipSummaryDto['severity'] {
    return fact.status === 'critical' ? 'critical' : 'warning';
}

function certificateSummaryText(fact: RelationshipCertificateFact): string {
    const daysLeft = daysUntilCertificateExpiry(fact.expiresAt ?? null);
    if (certificateIsExpired(fact.expiresAt ?? null)) {
        return `${fact.label} for ${fact.targetExternalId} has expired.`;
    }
    if (certificateIsExpiringSoon(fact.expiresAt ?? null)) {
        return `${fact.label} for ${fact.targetExternalId} expires in ${daysLeft} day(s).`;
    }
    return `${fact.label} for ${fact.targetExternalId} needs certificate attention.`;
}

function certificateSummaryReasonCode(
    fact: RelationshipCertificateFact
): string {
    if (certificateIsExpired(fact.expiresAt ?? null)) {
        return 'certificate_expired';
    }
    if (certificateIsExpiringSoon(fact.expiresAt ?? null)) {
        return 'certificate_expiring_soon';
    }
    if (fact.status === 'critical') return 'certificate_push_failed';
    return 'certificate_push_pending';
}
