// Authz module — shared types.
// Library-agnostic. ioredis types confined to redis-cache.ts.

export interface CachedEffectiveShape {
    version: number;
    shape: EffectiveShape;
    cachedAt: number;
    // Stable hash of builtInRoles the shape was built under. Mismatch
    // means a Zitadel grant changed without an FM authz mutation; treat
    // as miss so the resolver rebuilds rather than serving stale shape.
    rolesHash: string;
}

export interface EffectiveShape {
    statements: ResolvedStatement[];
}

export type StatementEffect = 'Allow' | 'Deny';
export type ResolvedStatementSource =
    | 'built-in-jwt'
    | 'group-assignment'
    | 'user-assignment';

export interface AccessProvenance {
    source: ResolvedStatementSource;
    persona?: string;
    assignmentId?: string;
    subjectType?: 'user' | 'user_group';
    subjectId?: string;
    grantorId?: string;
    expiresAt?: number;
    actions: string[];
    resourceTypes: string[];
    scope: Scope;
    effect: StatementEffect;
}

export interface StatementCondition {
    mfa?: {required?: boolean};
    ip?: {cidrs?: string[]};
    time?: {window?: {start: string; end: string}};
}

export interface ResolvedStatement {
    actions: string[];
    notActions?: string[];
    resourceTypes: string[];
    notResourceTypes?: string[];
    scope: Scope;
    effect: StatementEffect;
    condition?: StatementCondition;
    // Assignment id this statement was attached to. Empty for built-in JWT roles.
    assignmentId?: string;
    // Unix millis when this assignment stops contributing permissions.
    assignmentExpiresAt?: number;
    source?: ResolvedStatementSource;
    persona?: string;
    subjectType?: 'user' | 'user_group';
    subjectId?: string;
    grantorId?: string;
}

export interface RequestContext {
    mfaPresent?: boolean;
    sourceIp?: string;
    now?: number;
}

// Stable cache-key fragment for a request context. Sorted keys = order-independent.
export function requestContextCacheKey(ctx?: RequestContext): string {
    if (!ctx) return '';
    return (Object.keys(ctx) as Array<keyof RequestContext>)
        .sort()
        .filter((k) => ctx[k] !== undefined)
        .map((k) => `${k}=${String(ctx[k])}`)
        .join('&');
}

// Resolver-side scope shape. Mirrors the wire format in
// types/api/assignment.ts; kept local so the resolver has no API import.
export interface Scope {
    all?: boolean;
    device_ids?: string[];
    location_ids?: number[];
    device_group_ids?: number[];
    device_tags?: string[];
    dashboard_ids?: number[];
    plugin_keys?: string[];
    waiting_room_ids?: string[];
    configuration_keys?: string[];
    report_ids?: number[];
    organization_ids?: string[];
    alert_ids?: string[];
    notification_ids?: string[];
    integration_keys?: string[];
    automation_ids?: string[];
    // PAT-only narrowing. Patterns: 'type:verb', 'type:*', '*:verb', '*'.
    // Undefined = inherit all. Empty array rejected at create-time.
    actions?: string[];
}

export type InvalidationHandler = (tenantId: string, version: number) => void;
