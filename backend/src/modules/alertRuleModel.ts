import RpcError from '../rpc/RpcError';
import {validateOrThrow} from '../rpc/validateOrThrow';
import type {JsonSchema} from '../types/api/_schema';
import {MAX_BATCH_SIZE} from '../types/api/_shared';
import {
    ALERT_RULE_KIND_CONFIG_SCHEMAS,
    ALERT_RULE_KIND_DESCRIPTORS,
    ALERT_SCOPE_SELECTOR_SCHEMA,
    type AlertRuleKind,
    type ScopeSelector
} from '../types/api/alert';

type JsonRecord = Record<string, unknown>;
type StoredScopeSelector = ScopeSelector & {entityIds?: string[]};

const SCOPE_KEY_TO_TYPE = {
    deviceIds: 'device',
    componentIds: 'component',
    groupIds: 'group',
    locationIds: 'location',
    tagIds: 'tag'
} as const;

const STORED_ALERT_SCOPE_SELECTOR_SCHEMA: JsonSchema = {
    ...ALERT_SCOPE_SELECTOR_SCHEMA,
    properties: {
        ...(ALERT_SCOPE_SELECTOR_SCHEMA.properties ?? {}),
        entityIds: {
            type: 'array',
            items: {type: 'string', minLength: 1, maxLength: 255},
            maxItems: MAX_BATCH_SIZE
        }
    }
};

function cloneRecord(value: unknown): JsonRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    // structuredClone is ~2x faster than JSON round-trip and supports
    // more types (Date, Map, Set, ArrayBuffer) we may encounter once
    // alert rule shapes evolve.
    return structuredClone(value) as JsonRecord;
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(
        new Set(
            value
                .filter((entry): entry is string => typeof entry === 'string')
                .map((entry) => entry.trim())
                .filter(Boolean)
        )
    ).sort((left, right) => left.localeCompare(right));
}

function normalizeIntegerArray(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return Array.from(
        new Set(
            value.filter(
                (entry): entry is number =>
                    typeof entry === 'number' &&
                    Number.isInteger(entry) &&
                    entry > 0
            )
        )
    ).sort((left, right) => left - right);
}

export function normalizeScopeSelector(scope: unknown): ScopeSelector {
    const validated = validateOrThrow<ScopeSelector>(
        scope ?? {},
        ALERT_SCOPE_SELECTOR_SCHEMA
    );
    const normalized: ScopeSelector = {};

    const deviceIds = normalizeStringArray(validated.deviceIds);
    const componentIds = normalizeStringArray(validated.componentIds);
    const groupIds = normalizeIntegerArray(validated.groupIds);
    const locationIds = normalizeIntegerArray(validated.locationIds);
    const tagIds = normalizeIntegerArray(validated.tagIds);

    if (deviceIds.length > 0) normalized.deviceIds = deviceIds;
    if (componentIds.length > 0) normalized.componentIds = componentIds;
    if (groupIds.length > 0) normalized.groupIds = groupIds;
    if (locationIds.length > 0) normalized.locationIds = locationIds;
    if (tagIds.length > 0) normalized.tagIds = tagIds;

    return normalized;
}

export function publicScopeSelector(scope: unknown): ScopeSelector {
    const validated = validateOrThrow<StoredScopeSelector>(
        scope ?? {},
        STORED_ALERT_SCOPE_SELECTOR_SCHEMA
    );
    return normalizeScopeSelector({
        ...validated,
        componentIds: [
            ...(validated.componentIds ?? []),
            ...(validated.entityIds ?? [])
        ]
    });
}

export function storageScopeSelector(scope: ScopeSelector): ScopeSelector {
    return normalizeScopeSelector(scope);
}

export function validateSupportedScopeSelector(
    kind: AlertRuleKind,
    scope: unknown
): ScopeSelector {
    const normalized = normalizeScopeSelector(scope);
    const descriptor = ALERT_RULE_KIND_DESCRIPTORS.find(
        (item) => item.key === kind
    );

    if (!descriptor) {
        throw RpcError.InvalidParams(`Unknown alert rule kind "${kind}"`);
    }

    for (const [scopeKey, scopeType] of Object.entries(SCOPE_KEY_TO_TYPE)) {
        const entries = normalized[scopeKey as keyof ScopeSelector];
        if (
            Array.isArray(entries) &&
            entries.length > 0 &&
            !descriptor.supportedScopeTypes.includes(scopeType)
        ) {
            throw RpcError.InvalidParams(
                `${scopeKey} is not supported for alert rule kind "${kind}"`
            );
        }
    }

    return normalized;
}

export function normalizeDestinationGroupIds(value: unknown): number[] {
    return normalizeIntegerArray(value);
}

// Channels a rule targets directly, bypassing groups.
export function normalizeDestinationChannelIds(value: unknown): number[] {
    return normalizeIntegerArray(value);
}

// A rule must reach someone: at least one channel or one group. The single home
// for the recipient-presence rule, shared by create and update.
export function assertRuleHasRecipient(recipients: {
    channelIds: number[];
    groupIds: number[];
}): void {
    if (
        recipients.channelIds.length === 0 &&
        recipients.groupIds.length === 0
    ) {
        throw RpcError.InvalidParams(
            'A rule needs at least one recipient — pick a channel or a group'
        );
    }
}

// FM_ALERT_GROUP_BY per-rule override. Null-in → null-out (use env default).
// Validated against ALERT_GROUP_BY_LABELS by the Describe schema upstream.
export function normalizeGroupBy(value: unknown): string[] | null {
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value)) return null;
    const out = value
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .map((v) => v.trim())
        .filter(Boolean);
    return out.length > 0 ? out : null;
}

export function resolveAlertRuleAutoResolve(
    kind: AlertRuleKind,
    requested?: boolean | null
): boolean {
    const descriptor = ALERT_RULE_KIND_DESCRIPTORS.find(
        (item) => item.key === kind
    );

    if (!descriptor) {
        throw RpcError.InvalidParams(`Unknown alert rule kind "${kind}"`);
    }

    const defaultValue = descriptor.supportsAutoResolve
        ? true
        : !descriptor.supportsManualResolve;
    const resolved = requested ?? defaultValue;

    if (resolved && !descriptor.supportsAutoResolve) {
        throw RpcError.InvalidParams(
            `alert rule kind "${kind}" does not support autoResolve=true`
        );
    }

    if (!resolved && !descriptor.supportsManualResolve) {
        throw RpcError.InvalidParams(
            `alert rule kind "${kind}" does not support manual resolve`
        );
    }

    return resolved;
}

export function normalizeAlertRuleConfig(
    kind: AlertRuleKind,
    config: unknown
): JsonRecord {
    const validated = validateOrThrow<JsonRecord>(
        config ?? {},
        ALERT_RULE_KIND_CONFIG_SCHEMAS[kind]
    );
    return cloneRecord(validated);
}

export function normalizeOptionalText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') {
        throw RpcError.InvalidParams('Expected a string or null');
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function normalizeOptionalUserId(value: unknown): string | null {
    const normalized = normalizeOptionalText(value);
    return normalized;
}
