// Single entry point: should this alert reach this recipient on this
// channel right now? Five orthogonal layers consulted in fixed order so
// the verdict carries WHY.

import type {AlertSeverity} from '../../types/api/alert';
import {localClock} from './localClock';

export type SuppressionReason =
    | 'silence'
    | 'maintenance'
    | 'inhibition'
    | 'quiet_hours'
    | 'severity_floor'
    | 'vacation';

export interface SuppressionVerdict {
    deliver: boolean;
    reason?: SuppressionReason;
    /** Human note for audit; safe to surface in WS payloads. */
    detail?: string;
    /** Wakes the recipient back up at this point; null = open-ended. */
    expiresAt?: string | null;
}

export interface SuppressionContext {
    nowMs: number;
    alert: {
        id: number;
        severity: AlertSeverity;
        silencedUntilMs: number | null;
        subjectType: 'device' | 'entity' | 'group' | 'location' | 'tag';
        subjectId: string;
        ruleLabels?: Record<string, string>;
    };
    recipient: {
        userId: string;
        minSeverity?: AlertSeverity | null;
        vacationUntilMs?: number | null;
        quietHours?: {
            startMinute: number;
            endMinute: number;
            timezone: string;
        } | null;
    };
    inhibition: {
        anyParentFiring: boolean;
        matchingLabel?: string;
    };
    maintenance: {
        active: boolean;
        expiresAtMs?: number | null;
    };
}

const SEVERITY_RANK: Readonly<Record<AlertSeverity, number>> = {
    info: 0,
    warning: 1,
    critical: 2
};

export function evaluateSuppression(
    ctx: SuppressionContext
): SuppressionVerdict {
    // Per-alert silence (operator action) wins over every other layer.
    if (
        ctx.alert.silencedUntilMs !== null &&
        ctx.alert.silencedUntilMs > ctx.nowMs
    ) {
        return {
            deliver: false,
            reason: 'silence',
            expiresAt: new Date(ctx.alert.silencedUntilMs).toISOString()
        };
    }

    // Maintenance window covering the subject.
    if (ctx.maintenance.active) {
        return {
            deliver: false,
            reason: 'maintenance',
            expiresAt: ctx.maintenance.expiresAtMs
                ? new Date(ctx.maintenance.expiresAtMs).toISOString()
                : null
        };
    }

    // Cross-alert inhibition (parent firing suppresses children).
    if (ctx.inhibition.anyParentFiring) {
        return {
            deliver: false,
            reason: 'inhibition',
            detail: ctx.inhibition.matchingLabel
        };
    }

    // Recipient-specific gates after global gates.
    if (
        ctx.recipient.vacationUntilMs !== null &&
        ctx.recipient.vacationUntilMs !== undefined &&
        ctx.recipient.vacationUntilMs > ctx.nowMs
    ) {
        return {
            deliver: false,
            reason: 'vacation',
            expiresAt: new Date(ctx.recipient.vacationUntilMs).toISOString()
        };
    }

    if (ctx.recipient.minSeverity) {
        if (
            SEVERITY_RANK[ctx.alert.severity] <
            SEVERITY_RANK[ctx.recipient.minSeverity]
        ) {
            return {
                deliver: false,
                reason: 'severity_floor',
                detail: `alert severity=${ctx.alert.severity} < floor=${ctx.recipient.minSeverity}`
            };
        }
    }

    if (
        ctx.recipient.quietHours &&
        isInQuietHours(ctx.nowMs, ctx.recipient.quietHours)
    ) {
        return {deliver: false, reason: 'quiet_hours'};
    }

    return {deliver: true};
}

// Quiet-hours window expressed as minutes-of-day in the user's timezone.
// Crossing-midnight windows (start > end) are supported.
function isInQuietHours(
    nowMs: number,
    qh: {startMinute: number; endMinute: number; timezone: string}
): boolean {
    const minuteOfDay = localClock(new Date(nowMs), qh.timezone)?.minuteOfDay;
    if (minuteOfDay === undefined) return false;
    if (qh.startMinute <= qh.endMinute) {
        return minuteOfDay >= qh.startMinute && minuteOfDay < qh.endMinute;
    }
    // Crosses midnight: e.g. 22:00 → 07:00.
    return minuteOfDay >= qh.startMinute || minuteOfDay < qh.endMinute;
}
