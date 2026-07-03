/**
 * Group-type policy config — parses `FM_GROUP_POLICY_*` env vars once at
 * boot and exposes a typed, frozen object. No other module reads the env.
 * Per-group overrides live in DB metadata and are resolved in SQL.
 */
import {ALERT_SEVERITIES, type AlertSeverity} from '../types/api/alert';
import {GROUP_TYPES, type GroupType} from '../types/api/group';

export interface GroupPolicyConfig {
    severityFloorByType: Readonly<Record<GroupType, AlertSeverity | null>>;
    retentionDaysByType: Readonly<Record<GroupType, number | null>>;
    auditRetentionDaysByType: Readonly<Record<GroupType, number | null>>;
    /** Status days used when a device belongs to no group with a status policy. */
    retentionFallbackDays: number;
    /** Audit days used for rows with no shelly_id or no group policy. */
    auditRetentionFallbackDays: number;
    /** How often the status + audit sweeps run, in milliseconds. */
    sweepIntervalMs: number;
}

const SEVERITY_FLOOR_ENV: Record<GroupType, string> = {
    standard: 'FM_GROUP_POLICY_SEVERITY_FLOOR_STANDARD',
    operational: 'FM_GROUP_POLICY_SEVERITY_FLOOR_OPERATIONAL',
    critical: 'FM_GROUP_POLICY_SEVERITY_FLOOR_CRITICAL',
    custom: 'FM_GROUP_POLICY_SEVERITY_FLOOR_CUSTOM'
};

const RETENTION_DAYS_ENV: Record<GroupType, string> = {
    standard: 'FM_GROUP_POLICY_RETENTION_STANDARD_DAYS',
    operational: 'FM_GROUP_POLICY_RETENTION_OPERATIONAL_DAYS',
    critical: 'FM_GROUP_POLICY_RETENTION_CRITICAL_DAYS',
    custom: 'FM_GROUP_POLICY_RETENTION_CUSTOM_DAYS'
};

const AUDIT_RETENTION_DAYS_ENV: Record<GroupType, string> = {
    standard: 'FM_GROUP_POLICY_AUDIT_RETENTION_STANDARD_DAYS',
    operational: 'FM_GROUP_POLICY_AUDIT_RETENTION_OPERATIONAL_DAYS',
    critical: 'FM_GROUP_POLICY_AUDIT_RETENTION_CRITICAL_DAYS',
    custom: 'FM_GROUP_POLICY_AUDIT_RETENTION_CUSTOM_DAYS'
};

/** Parse+validate the severity-floor env var; empty/unset → null. */
function parseSeverityFloor(varName: string): AlertSeverity | null {
    const raw = process.env[varName]?.trim();
    if (!raw) return null;
    if (!(ALERT_SEVERITIES as readonly string[]).includes(raw)) {
        throw new Error(
            `${varName}=${raw}: expected one of ${ALERT_SEVERITIES.join('|')} or empty`
        );
    }
    return raw as AlertSeverity;
}

/** Parse+validate the retention-days env var; empty/unset → null. */
function parseRetentionDays(varName: string): number | null {
    const raw = process.env[varName]?.trim();
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1 || String(n) !== raw) {
        throw new Error(
            `${varName}=${raw}: expected a positive integer or empty`
        );
    }
    return n;
}

/** Parse a positive-integer env var with a fallback when unset. Abort on invalid. */
function parsePositiveInt(varName: string, fallback: number): number {
    const raw = process.env[varName]?.trim();
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1 || String(n) !== raw) {
        throw new Error(
            `${varName}=${raw}: expected positive integer or empty`
        );
    }
    return n;
}

function build(): GroupPolicyConfig {
    const severityFloorByType = {} as Record<GroupType, AlertSeverity | null>;
    const retentionDaysByType = {} as Record<GroupType, number | null>;
    const auditRetentionDaysByType = {} as Record<GroupType, number | null>;
    for (const t of GROUP_TYPES) {
        severityFloorByType[t] = parseSeverityFloor(SEVERITY_FLOOR_ENV[t]);
        retentionDaysByType[t] = parseRetentionDays(RETENTION_DAYS_ENV[t]);
        auditRetentionDaysByType[t] = parseRetentionDays(
            AUDIT_RETENTION_DAYS_ENV[t]
        );
    }
    const retentionFallbackDays = parsePositiveInt(
        'FM_GROUP_POLICY_RETENTION_FALLBACK_DAYS',
        7
    );
    const auditRetentionFallbackDays = parsePositiveInt(
        'FM_GROUP_POLICY_AUDIT_RETENTION_FALLBACK_DAYS',
        90
    );
    const sweepIntervalMinutes = parsePositiveInt(
        'FM_GROUP_POLICY_SWEEP_INTERVAL_MINUTES',
        60
    );
    return Object.freeze({
        severityFloorByType: Object.freeze(severityFloorByType),
        retentionDaysByType: Object.freeze(retentionDaysByType),
        auditRetentionDaysByType: Object.freeze(auditRetentionDaysByType),
        retentionFallbackDays,
        auditRetentionFallbackDays,
        sweepIntervalMs: sweepIntervalMinutes * 60_000
    });
}

let cached: GroupPolicyConfig | undefined;

/** Cached lookup — call this on hot paths. Boot validation throws on first call. */
export function groupPolicy(): GroupPolicyConfig {
    if (!cached) cached = build();
    return cached;
}

/** Test helper — forgets the parsed singleton so a new env can be parsed. */
export function __resetGroupPolicyForTests(): void {
    cached = undefined;
}
