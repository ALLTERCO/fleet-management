// Group-policy form-state parsers. Owns the metadata.policy.* read+write
// shape, integer guards, and severity-floor pass-through. Modal stays free
// of int-parsing and metadata-shape concerns.

import type {AlertSeverity} from '@api/alert';

export type MetadataRecord = Record<string, unknown>;

export interface PolicyShape {
    severityFloor?: AlertSeverity;
    retentionDays?: number;
    auditRetentionDays?: number;
}

// Answer — true if the value is a non-array object we can safely index into.
export function isMetadataRecord(value: unknown): value is MetadataRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Answer — configProfile string from metadata, or '' when missing.
export function configProfileFromMetadata(metadata: unknown): string {
    if (!isMetadataRecord(metadata)) return '';
    return typeof metadata.configProfile === 'string'
        ? metadata.configProfile
        : '';
}

// Answer — metadata.policy object, or {} when missing/wrong shape.
export function policyFromMetadata(metadata: unknown): MetadataRecord {
    if (!isMetadataRecord(metadata)) return {};
    return isMetadataRecord(metadata.policy) ? metadata.policy : {};
}

export type IntParseResult =
    | {ok: true; value: number | undefined}
    | {ok: false; error: string};

// Answer — parse a positive-integer field. Empty input is valid and
// returns value=undefined (the caller treats it as "inherit").
export function parsePositiveInt(raw: string, label: string): IntParseResult {
    const trimmed = raw.trim();
    if (!trimmed) return {ok: true, value: undefined};
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(n) || n < 1 || String(n) !== trimmed) {
        return {ok: false, error: `${label} must be a positive integer`};
    }
    return {ok: true, value: n};
}

export interface PolicyFormState {
    severityFloor: AlertSeverity | '';
    retentionDaysText: string;
    auditRetentionDaysText: string;
}

export interface PolicyBuildErrors {
    retentionDays?: string;
    auditRetentionDays?: string;
}

export type PolicyBuildResult =
    | {ok: true; data: PolicyShape | undefined}
    | {ok: false; errors: PolicyBuildErrors};

// Answer — assemble a PolicyShape from the form state. Returns the shape
// (undefined when every field is empty so callers can omit policy entirely)
// or a structured per-field error bag.
export function buildPolicyFromForm(form: PolicyFormState): PolicyBuildResult {
    const out: PolicyShape = {};
    const errors: PolicyBuildErrors = {};

    if (form.severityFloor) out.severityFloor = form.severityFloor;

    const retention = parsePositiveInt(
        form.retentionDaysText,
        'Retention days'
    );
    if (!retention.ok) errors.retentionDays = retention.error;
    else if (retention.value !== undefined) out.retentionDays = retention.value;

    const audit = parsePositiveInt(
        form.auditRetentionDaysText,
        'Audit retention days'
    );
    if (!audit.ok) errors.auditRetentionDays = audit.error;
    else if (audit.value !== undefined) out.auditRetentionDays = audit.value;

    if (errors.retentionDays || errors.auditRetentionDays) {
        return {ok: false, errors};
    }
    return {ok: true, data: Object.keys(out).length > 0 ? out : undefined};
}
