// Authz module — public exports.

export {
    type AuthzAuditEntry,
    AuthzAuditWriter,
    authzAuditWriter,
    writeAuthzAudit
} from './audit';
export type {AuthzCache} from './cache';
export type {AuthzConfig} from './config';
export {loadAuthzConfig} from './config';
export type {
    AuthzDecision,
    AuthzDecisionReason,
    AuthzRequest,
    AuthzRequestContext,
    ResourceId,
    ScopeFilter,
    ScopeFilterKind
} from './contracts';
export {
    denyAllScope,
    idScope,
    unrestrictedScope
} from './contracts';
// Postgres-backed implementation of ResolverDb.
export {PostgresResolverDb} from './db';
export {
    AuthzEvaluator,
    authzRequestForComponent,
    canPerform,
    canPerformAsync,
    canPerformComponentOperation,
    canPerformComponentOperationAsync,
    componentForResourceType,
    explainAccess,
    getReadableComponentIds,
    getReadableScope,
    getReadableScopeAsync,
    operationForAction,
    requireComponentPermission,
    requireComponentPermissionAsync,
    requirePermission,
    requirePermissionAsync,
    resourceTypeForComponent,
    scopeFilterToIds
} from './evaluator';
export {L1AuthzCache} from './l1-cache';
export {InMemoryAuthzCache} from './memory-cache';
export {
    type AccessRoleSummary,
    accessProvenanceFromShape,
    effectiveShapeNoAccessReason,
    emptyAccessRoleSummary,
    statementToAccessProvenance,
    summarizeAccessProvenance
} from './provenance';
export {RedisAuthzCache} from './redis-cache';
export type {
    AssignmentRow,
    AssignmentSource,
    CheckRequest,
    PersonaRow,
    ResolverDb,
    ResolverDeps,
    SimulationResult
} from './resolver';
// Resolver — pure helpers + orchestration.
export {
    actionAllowed,
    actionInStatement,
    buildEffectiveShape,
    check,
    listAccessibleDevices,
    scopeMatches,
    simulate,
    statementMatches
} from './resolver';
export {
    createDefaultResourceResolver,
    DashboardResourceResolver,
    DeviceResourceResolver,
    GroupResourceResolver,
    type ResourceResolver,
    ResourceResolverRegistry
} from './resources';
// Lazy-init singleton.
export {
    getAuthzRuntimeStatus,
    initAuthzRuntime,
    invalidateAuthzTenant,
    shutdownAuthzRuntime,
    tryGetAuthzRuntime
} from './runtime';
export type {
    CachedEffectiveShape,
    EffectiveShape,
    InvalidationHandler,
    ResolvedStatement,
    Scope
} from './types';
