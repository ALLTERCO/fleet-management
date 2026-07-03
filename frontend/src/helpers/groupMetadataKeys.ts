// Reserved keys on `groups.metadata`. They have dedicated UI (policy via
// SeverityFloorPicker + RetentionDaysInput; configProfile via the Config
// Profile dropdown) and never appear in the kind-specific form.
// Single source of truth — imported by both GroupMetadataForm and the
// modal's load helper so neither drifts.

import {isMetadataRecord} from './groupPolicyParse';

export const RESERVED_METADATA_KEYS: ReadonlySet<string> = new Set([
    'policy',
    'configProfile'
]);

export function isReservedMetadataKey(key: string): boolean {
    return RESERVED_METADATA_KEYS.has(key);
}

// Strip the reserved system keys from a group's metadata bag — the result
// is what the per-kind form edits. Non-record input returns {}.
export function extractKindMetadata(value: unknown): Record<string, unknown> {
    if (!isMetadataRecord(value)) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
        if (isReservedMetadataKey(k)) continue;
        out[k] = v;
    }
    return out;
}
