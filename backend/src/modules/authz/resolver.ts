// Authz resolver — pure helpers + cached orchestration.

import {createHash} from 'node:crypto';
import log4js from 'log4js';
import * as Observability from '../Observability';
import type {AuthzCache} from './cache';
import type {L1AuthzCache} from './l1-cache';
import {isExplicitScope} from './scopeGuard';
import type {
    EffectiveShape,
    RequestContext,
    ResolvedStatement,
    Scope,
    StatementCondition
} from './types';
import {requestContextCacheKey} from './types';

// Stable hash for cache key — sorted set so role order doesn't matter.
function hashRoles(roles: readonly string[]): string {
    const sorted = [...new Set(roles)].sort();
    return createHash('sha256')
        .update(sorted.join('\x1f'))
        .digest('base64url')
        .slice(0, 16);
}

const logger = log4js.getLogger('authz-resolver');

// ─── Public types ─────────────────────────────────────────────────

export interface ResourceRef {
    type: string;
    id: string | number;
    locationId?: number;
    locationIds?: number[];
    deviceGroupIds?: number[];
    tags?: string[];
}

export interface CheckRequest {
    userId: string;
    tenantId: string;
    builtInRoles: string[]; // from JWT urn:zitadel:iam:org:project:roles
    action: string;
    resource: ResourceRef;
    context?: RequestContext;
}

export type AssignmentSource =
    | 'built-in-jwt'
    | 'group-assignment'
    | 'user-assignment';

export interface SimulationResult {
    decision: boolean;
    matchedBy: Array<{
        source: AssignmentSource;
        persona: string;
        scope?: Scope;
    }>;
}

export interface ResolverDeps {
    cache: AuthzCache;
    db: ResolverDb;
    l1?: L1AuthzCache;
}

export interface PersonaRow {
    id: string;
    key: string;
    statements: ResolvedStatement[];
    version: number;
    // True for the 8 seeded system personas (tenant_id IS NULL).
    is_system_managed: boolean;
}

export interface AssignmentRow {
    id: string;
    subject_type: 'user' | 'user_group';
    subject_id: string;
    persona_id: string;
    scope: Scope;
    expires_at?: string | null;
    created_by?: string | null;
}

export interface ResolverDb {
    getSystemPersonas(keys: string[]): Promise<PersonaRow[]>;
    /** Durable shadow of the tenant authz version (organization.profile.authz_version). */
    getDurableTenantVersion(tenantId: string): Promise<number>;
    getGroupsForUser(userId: string, tenantId: string): Promise<string[]>;
    getAssignmentsForSubjects(
        tenantId: string,
        subjects: Array<{type: 'user' | 'user_group'; id: string}>
    ): Promise<AssignmentRow[]>;
    getPersonasByIds(
        tenantId: string,
        personaIds: string[]
    ): Promise<PersonaRow[]>;
    getAllDeviceIdsForTenant(tenantId: string): Promise<string[]>;
    getDeviceIdsByLocations(
        tenantId: string,
        locationIds: number[]
    ): Promise<string[]>;
    getDeviceIdsByDeviceGroups(
        tenantId: string,
        deviceGroupIds: number[]
    ): Promise<string[]>;
    getDeviceIdsByTags(tenantId: string, tags: string[]): Promise<string[]>;
    markAssignmentsUsed(
        tenantId: string,
        assignmentIds: string[]
    ): Promise<void>;
}

// ─── Pure helpers (implemented + tested) ──────────────────────────

// Per-dimension AND-intersect of two scopes. null = empty intersection.
export function scopeIntersect(
    statement: Scope,
    boundary: Scope
): Scope | null {
    if (boundary.all === true) return statement;
    if (statement.all === true) return {...boundary};
    const out: Scope = {};
    const dims: Array<keyof Scope> = [
        'device_ids',
        'location_ids',
        'device_group_ids',
        'device_tags',
        'dashboard_ids',
        'plugin_keys',
        'waiting_room_ids',
        'configuration_keys',
        'report_ids',
        'organization_ids',
        'alert_ids',
        'notification_ids',
        'integration_keys',
        'automation_ids'
    ];
    for (const dim of dims) {
        const s = statement[dim] as readonly (string | number)[] | undefined;
        const b = boundary[dim] as readonly (string | number)[] | undefined;
        if (s && b) {
            const sSet = new Set(s.map(String));
            const intersection = b.filter((x) => sSet.has(String(x)));
            if (intersection.length === 0) return null;
            (out as Record<string, unknown>)[dim] = intersection;
        } else if (s) {
            (out as Record<string, unknown>)[dim] = [...s];
        } else if (b) {
            (out as Record<string, unknown>)[dim] = [...b];
        }
    }
    return scopeIsExplicit(out) ? out : null;
}

// Pattern-aware. boundary supports 'type:verb' / 'type:*' / '*:verb' / '*'.
export function intersectActions(
    statementActions: readonly string[],
    boundaryActions: readonly string[]
): string[] {
    if (boundaryActions.includes('*')) return [...statementActions];
    const out: string[] = [];
    for (const action of statementActions) {
        const [stmtType, stmtVerb] = action.split(':');
        for (const pattern of boundaryActions) {
            const [patType, patVerb] = pattern.split(':');
            const typeMatches = patType === '*' || patType === stmtType;
            const verbMatches = patVerb === '*' || patVerb === stmtVerb;
            if (typeMatches && verbMatches) {
                out.push(action);
                break;
            }
        }
    }
    return out;
}

export function applyBoundary(
    shape: EffectiveShape,
    boundary: Scope | undefined
): EffectiveShape {
    if (!boundary) return shape;
    // all=true still narrows when actions is set.
    if (boundary.all === true && !boundary.actions) return shape;
    const out: ResolvedStatement[] = [];
    for (const s of shape.statements) {
        const narrowedScope =
            boundary.all === true ? s.scope : scopeIntersect(s.scope, boundary);
        if (!narrowedScope) continue;
        const narrowedActions = boundary.actions
            ? intersectActions(s.actions, boundary.actions)
            : s.actions;
        if (narrowedActions.length === 0) continue;
        out.push({...s, scope: narrowedScope, actions: narrowedActions});
    }
    return {statements: out};
}

// Delegates to the one scope guard so the dimension list has a single home.
export function scopeIsExplicit(scope: Scope): boolean {
    return isExplicitScope(scope);
}

export function scopeMatches(scope: Scope, resource: ResourceRef): boolean {
    if (!scopeIsExplicit(scope)) return false;
    if (scope.all === true) return true;
    if (
        scope.device_ids?.length &&
        !scope.device_ids.includes(String(resource.id))
    ) {
        return false;
    }
    if (scope.location_ids?.length) {
        const resourceLocationIds =
            resource.locationIds ??
            (resource.locationId === undefined ? [] : [resource.locationId]);
        const has = scope.location_ids.some((id) =>
            resourceLocationIds.includes(id)
        );
        if (!has) return false;
    }
    if (scope.device_group_ids?.length) {
        const has =
            isDeviceGroupResourceInScope(resource, scope.device_group_ids) ||
            Boolean(
                resource.deviceGroupIds?.some((groupId) =>
                    scope.device_group_ids!.includes(groupId)
                )
            );
        if (!has) return false;
    }
    if (scope.device_tags?.length) {
        if (!resource.tags?.length) return false;
        const has = scope.device_tags.some((t) => resource.tags!.includes(t));
        if (!has) return false;
    }
    if (
        scope.dashboard_ids?.length &&
        !scope.dashboard_ids.includes(Number(resource.id))
    ) {
        return false;
    }
    if (
        scope.plugin_keys?.length &&
        !scope.plugin_keys.includes(String(resource.id))
    ) {
        return false;
    }
    if (!stringScopeMatches(scope.waiting_room_ids, resource.id)) return false;
    if (!stringScopeMatches(scope.configuration_keys, resource.id))
        return false;
    if (!numberScopeMatches(scope.report_ids, resource.id)) return false;
    if (!stringScopeMatches(scope.organization_ids, resource.id)) return false;
    if (!stringScopeMatches(scope.alert_ids, resource.id)) return false;
    if (!stringScopeMatches(scope.notification_ids, resource.id)) return false;
    if (!stringScopeMatches(scope.integration_keys, resource.id)) return false;
    if (!stringScopeMatches(scope.automation_ids, resource.id)) return false;
    return true;
}

function isDeviceGroupResourceInScope(
    resource: ResourceRef,
    scopeGroupIds: readonly number[]
): boolean {
    return (
        (resource.type === 'group' || resource.type === 'device_group') &&
        scopeGroupIds.includes(Number(resource.id))
    );
}

function stringScopeMatches(
    values: readonly string[] | undefined,
    resourceId: string | number
): boolean {
    return !values?.length || values.includes(String(resourceId));
}

function numberScopeMatches(
    values: readonly number[] | undefined,
    resourceId: string | number
): boolean {
    return !values?.length || values.includes(Number(resourceId));
}

export function actionInStatement(
    action: string,
    statementActions: string[]
): boolean {
    if (statementActions.includes(action) || statementActions.includes('*')) {
        return true;
    }
    const colonIdx = action.indexOf(':');
    if (colonIdx > 0) {
        const resource = action.slice(0, colonIdx);
        const verb = action.slice(colonIdx + 1);
        // Resource-side wildcard: "device:*" matches "device:read"
        if (statementActions.includes(`${resource}:*`)) return true;
        // Verb-side wildcard: "*:read" matches "device:read"
        if (statementActions.includes(`*:${verb}`)) return true;
    }
    return false;
}

// Parse "1.2.3.4/24" or "::1/128" into normalized parts. Returns null on malformed.
function parseCidr(
    cidr: string
): {addr: bigint; bits: number; v6: boolean} | null {
    const slash = cidr.indexOf('/');
    if (slash < 0) return null;
    const addrStr = cidr.slice(0, slash);
    const bits = Number.parseInt(cidr.slice(slash + 1), 10);
    if (!Number.isFinite(bits) || bits < 0) return null;
    const v6 = addrStr.includes(':');
    if (v6) {
        if (bits > 128) return null;
        const expanded = expandV6(addrStr);
        if (!expanded) return null;
        let addr = 0n;
        for (const part of expanded.split(':')) {
            const n = Number.parseInt(part, 16);
            if (!Number.isFinite(n) || n < 0 || n > 0xffff) return null;
            addr = (addr << 16n) | BigInt(n);
        }
        return {addr, bits, v6: true};
    }
    if (bits > 32) return null;
    const octets = addrStr.split('.');
    if (octets.length !== 4) return null;
    let addr = 0n;
    for (const o of octets) {
        const n = Number.parseInt(o, 10);
        if (!Number.isFinite(n) || n < 0 || n > 255) return null;
        addr = (addr << 8n) | BigInt(n);
    }
    return {addr, bits, v6: false};
}

function expandV6(s: string): string | null {
    const dz = s.indexOf('::');
    if (dz < 0) return s;
    const left = s.slice(0, dz).split(':').filter(Boolean);
    const right = s
        .slice(dz + 2)
        .split(':')
        .filter(Boolean);
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    return [...left, ...new Array(fill).fill('0'), ...right].join(':');
}

function ipMatchesCidr(ip: string, cidr: string): boolean {
    const target = parseCidr(`${ip}/${ip.includes(':') ? 128 : 32}`);
    const mask = parseCidr(cidr);
    if (!target || !mask) return false;
    if (target.v6 !== mask.v6) return false;
    const total = mask.v6 ? 128 : 32;
    const shift = BigInt(total - mask.bits);
    return target.addr >> shift === mask.addr >> shift;
}

export function conditionMatches(
    condition: StatementCondition | undefined,
    context: RequestContext | undefined
): boolean {
    if (!condition) return true;
    if (condition.mfa?.required && !context?.mfaPresent) return false;

    const cidrs = condition.ip?.cidrs;
    if (cidrs && cidrs.length > 0) {
        const ip = context?.sourceIp;
        if (!ip) return false;
        if (!cidrs.some((c) => ipMatchesCidr(ip, c))) return false;
    }

    const win = condition.time?.window;
    if (win) {
        const now = context?.now ?? Date.now();
        const start = Date.parse(win.start);
        const end = Date.parse(win.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        if (now < start || now > end) return false;
    }
    return true;
}

export function statementMatches(
    statement: ResolvedStatement,
    action: string,
    resource: ResourceRef,
    context?: RequestContext
): boolean {
    if (statementIsExpired(statement, context)) return false;
    // Action: must match `actions` AND not match `notActions` (NotAction = exception).
    if (!actionInStatement(action, statement.actions)) return false;
    if (
        statement.notActions &&
        statement.notActions.length > 0 &&
        actionInStatement(action, statement.notActions)
    ) {
        return false;
    }
    if (
        !statement.resourceTypes.includes(resource.type) &&
        !statement.resourceTypes.includes('*')
    ) {
        return false;
    }
    if (
        statement.notResourceTypes &&
        statement.notResourceTypes.length > 0 &&
        statement.notResourceTypes.includes(resource.type)
    ) {
        return false;
    }
    if (!scopeMatches(statement.scope, resource)) return false;
    return conditionMatches(statement.condition, context);
}

export function statementIsExpired(
    statement: ResolvedStatement,
    context?: RequestContext
): boolean {
    return (
        statement.assignmentExpiresAt !== undefined &&
        statement.assignmentExpiresAt <= (context?.now ?? Date.now())
    );
}

export interface ActionDecision {
    decision: boolean;
    matchedAllowAssignmentIds: string[];
}

export function actionAllowedWithTrace(
    shape: EffectiveShape,
    action: string,
    resource: ResourceRef,
    context?: RequestContext
): ActionDecision {
    let allowed = false;
    const matchedAllowAssignmentIds: string[] = [];
    for (const statement of shape.statements) {
        if (!statementMatches(statement, action, resource, context)) continue;
        if (statement.effect === 'Deny') {
            return {decision: false, matchedAllowAssignmentIds: []};
        }
        allowed = true;
        if (statement.assignmentId) {
            matchedAllowAssignmentIds.push(statement.assignmentId);
        }
    }
    return {decision: allowed, matchedAllowAssignmentIds};
}

export function actionAllowed(
    shape: EffectiveShape,
    action: string,
    resource: ResourceRef,
    context?: RequestContext
): boolean {
    return actionAllowedWithTrace(shape, action, resource, context).decision;
}

// ─── Orchestration ────────────────────────────────────────────────

interface AssignmentTrace {
    statement: ResolvedStatement;
    source: AssignmentSource;
    persona: string;
    scope?: Scope;
}

/**
 * Build effective shape from JWT built-in roles + DB assignments + scopes.
 * The expensive cold-path computation; result is cached at L2 by callers.
 *
 *   - JWT built-in roles → seeded persona shapes (implicit scope=all)
 *   - User's groups → group assignments → custom personas + scopes
 *   - Direct user assignments → custom personas + narrow scopes
 *   - Union all → effective shape
 */
export async function buildEffectiveShape(
    deps: ResolverDeps,
    userId: string,
    tenantId: string,
    builtInRoles: string[]
): Promise<EffectiveShape> {
    const traces = await collectAssignmentTraces(
        deps,
        userId,
        tenantId,
        builtInRoles
    );
    return {statements: traces.map((t) => t.statement)};
}

async function collectAssignmentTraces(
    deps: ResolverDeps,
    userId: string,
    tenantId: string,
    builtInRoles: string[]
): Promise<AssignmentTrace[]> {
    const traces: AssignmentTrace[] = [];

    // Step b + c: gather group + user assignments in one batch.
    const groupIds = await deps.db.getGroupsForUser(userId, tenantId);
    const subjects: Array<{type: 'user' | 'user_group'; id: string}> = [
        {type: 'user', id: userId},
        ...groupIds.map((id) => ({type: 'user_group' as const, id}))
    ];
    const assignments = activeAssignments(
        await deps.db.getAssignmentsForSubjects(tenantId, subjects)
    );

    // Step d: resolve persona shapes for assignments, attach scope per assignment.
    const uniquePersonaIds = Array.from(
        new Set(assignments.map((a) => a.persona_id))
    );
    const personaList =
        uniquePersonaIds.length > 0
            ? await deps.db.getPersonasByIds(tenantId, uniquePersonaIds)
            : [];
    const personaById = new Map<string, PersonaRow>(
        personaList.map((p) => [p.id, p])
    );

    // Narrowing: system persona keys with an assignment skip their JWT
    // scope:{all} — the assignment's scope wins. AWS-IAM boundary semantic.
    const narrowedSystemKeys = new Set<string>();
    for (const a of assignments) {
        const p = personaById.get(a.persona_id);
        if (p?.is_system_managed) narrowedSystemKeys.add(p.key);
    }

    // Step a: JWT built-ins; skip those with an assignment (narrowing).
    if (builtInRoles.length > 0) {
        const builtIns = await deps.db.getSystemPersonas(builtInRoles);
        for (const persona of builtIns) {
            if (narrowedSystemKeys.has(persona.key)) continue;
            for (const statement of persona.statements) {
                traces.push({
                    statement: {
                        ...statement,
                        scope: {all: true},
                        source: 'built-in-jwt',
                        persona: persona.key
                    },
                    source: 'built-in-jwt',
                    persona: persona.key
                });
            }
        }
    }

    for (const assignment of assignments) {
        const persona = personaById.get(assignment.persona_id);
        if (!persona) continue;
        for (const statement of persona.statements) {
            traces.push({
                statement: {
                    ...statement,
                    scope: assignment.scope,
                    assignmentId: assignment.id,
                    assignmentExpiresAt: assignmentExpiresAtMs(assignment),
                    source:
                        assignment.subject_type === 'user_group'
                            ? 'group-assignment'
                            : 'user-assignment',
                    persona: persona.key,
                    subjectType: assignment.subject_type,
                    subjectId: assignment.subject_id,
                    grantorId: assignment.created_by ?? undefined
                },
                source:
                    assignment.subject_type === 'user_group'
                        ? 'group-assignment'
                        : 'user-assignment',
                persona: persona.key,
                scope: assignment.scope
            });
        }
    }

    return traces;
}

function activeAssignments(assignments: AssignmentRow[]): AssignmentRow[] {
    const now = Date.now();
    return assignments.filter((assignment) => {
        const expiresAt = assignmentExpiresAtMs(assignment);
        return expiresAt === undefined || expiresAt > now;
    });
}

function assignmentExpiresAtMs(assignment: AssignmentRow): number | undefined {
    if (!assignment.expires_at) return undefined;
    const expiresAt = Date.parse(assignment.expires_at);
    return Number.isFinite(expiresAt) ? expiresAt : 0;
}

// L1 GET runs before shape build — entries only exist when the set-side
// already cleared shapeHasExpiringAssignments, and L1 invalidation is wired
// to L2 tenant-version bumps. So a hit is always safe to serve.
export async function check(
    deps: ResolverDeps,
    req: CheckRequest
): Promise<boolean> {
    const ctxKey = requestContextCacheKey(req.context);
    const cached = deps.l1?.get(
        req.tenantId,
        req.userId,
        req.action,
        req.resource.type,
        req.resource.id,
        ctxKey
    );
    if (cached !== undefined) {
        Observability.incrementCounter('authz_l1_hits');
        return cached;
    }
    Observability.incrementCounter('authz_l1_misses');
    const t0 = performance.now();
    const shape = await getOrBuildShape(deps, req);
    const {decision, matchedAllowAssignmentIds} = actionAllowedWithTrace(
        shape,
        req.action,
        req.resource,
        req.context
    );
    if (!shapeHasExpiringAssignments(shape)) {
        deps.l1?.set(
            req.tenantId,
            req.userId,
            req.action,
            req.resource.type,
            req.resource.id,
            decision,
            ctxKey
        );
    }
    if (matchedAllowAssignmentIds.length > 0) {
        markMatchedAssignmentsUsed(deps, {
            tenantId: req.tenantId,
            assignmentIds: matchedAllowAssignmentIds
        });
    }
    Observability.recordDbTiming('authz.check', performance.now() - t0);
    return decision;
}

function markMatchedAssignmentsUsed(
    deps: ResolverDeps,
    input: {tenantId: string; assignmentIds: string[]}
): void {
    // Best-effort telemetry. The authorization decision has already been made.
    void markMatchedAssignmentsUsedAsync(deps, input);
}

async function markMatchedAssignmentsUsedAsync(
    deps: ResolverDeps,
    input: {tenantId: string; assignmentIds: string[]}
): Promise<void> {
    try {
        await deps.db.markAssignmentsUsed(input.tenantId, input.assignmentIds);
    } catch (error) {
        Observability.incrementCounter('authz_mark_used_failures');
        logger.warn('markAssignmentsUsed failed: %s', error);
    }
}

function shapeHasExpiringAssignments(shape: EffectiveShape): boolean {
    return shape.statements.some(
        (statement) => statement.assignmentExpiresAt !== undefined
    );
}

/**
 * Simulate — like check() but returns which assignments matched.
 */
export async function simulate(
    deps: ResolverDeps,
    req: CheckRequest
): Promise<SimulationResult> {
    const traces = await collectAssignmentTraces(
        deps,
        req.userId,
        req.tenantId,
        req.builtInRoles
    );
    const matched: SimulationResult['matchedBy'] = [];
    for (const t of traces) {
        if (
            statementMatches(t.statement, req.action, req.resource, req.context)
        ) {
            matched.push({
                source: t.source,
                persona: t.persona,
                scope: t.scope
            });
        }
    }
    return {
        decision: actionAllowed(
            {statements: traces.map((t) => t.statement)},
            req.action,
            req.resource,
            req.context
        ),
        matchedBy: matched
    };
}

// Determines whether a single statement applies to "device" + the given action,
// respecting actions/notActions/resourceTypes/notResourceTypes and condition.
function statementAppliesToDeviceAction(
    statement: ResolvedStatement,
    action: string,
    context: RequestContext | undefined
): boolean {
    if (!actionInStatement(action, statement.actions)) return false;
    if (
        statement.notActions &&
        statement.notActions.length > 0 &&
        actionInStatement(action, statement.notActions)
    ) {
        return false;
    }
    if (
        !statement.resourceTypes.includes('device') &&
        !statement.resourceTypes.includes('*')
    ) {
        return false;
    }
    if (
        statement.notResourceTypes &&
        statement.notResourceTypes.length > 0 &&
        statement.notResourceTypes.includes('device')
    ) {
        return false;
    }
    return conditionMatches(statement.condition, context);
}

// Mirrors scopeMatches: AND across populated selectors. Empty selector =
// "no constraint on this dimension". Two selectors set means intersection.
async function expandScopeToDeviceIds(
    deps: ResolverDeps,
    tenantId: string,
    scope: Scope
): Promise<Set<string>> {
    if (scope.all === true) {
        return new Set(await deps.db.getAllDeviceIdsForTenant(tenantId));
    }
    const sets: Set<string>[] = [];
    if (scope.device_ids?.length) sets.push(new Set(scope.device_ids));
    if (scope.location_ids?.length) {
        sets.push(
            new Set(
                await deps.db.getDeviceIdsByLocations(
                    tenantId,
                    scope.location_ids
                )
            )
        );
    }
    if (scope.device_group_ids?.length) {
        sets.push(
            new Set(
                await deps.db.getDeviceIdsByDeviceGroups(
                    tenantId,
                    scope.device_group_ids
                )
            )
        );
    }
    if (scope.device_tags?.length) {
        sets.push(
            new Set(
                await deps.db.getDeviceIdsByTags(tenantId, scope.device_tags)
            )
        );
    }
    if (sets.length === 0) return new Set();
    let result = sets[0];
    for (let i = 1; i < sets.length; i++) {
        const next = new Set<string>();
        for (const id of result) if (sets[i].has(id)) next.add(id);
        result = next;
    }
    return result;
}

/**
 * Allow-set ∪ across matching Allow statements, then Deny-set subtracted.
 * Honors actions/notActions/resourceTypes/notResourceTypes and condition.
 */
export async function listAccessibleDevices(
    deps: ResolverDeps,
    userId: string,
    tenantId: string,
    builtInRoles: string[],
    action: string,
    context?: RequestContext
): Promise<string[]> {
    const traces = await collectAssignmentTraces(
        deps,
        userId,
        tenantId,
        builtInRoles
    );

    const allowStatements: ResolvedStatement[] = [];
    const denyStatements: ResolvedStatement[] = [];
    for (const t of traces) {
        if (!statementAppliesToDeviceAction(t.statement, action, context))
            continue;
        if (!scopeIsExplicit(t.statement.scope)) continue;
        if (t.statement.effect === 'Deny') denyStatements.push(t.statement);
        else allowStatements.push(t.statement);
    }
    if (allowStatements.length === 0) return [];

    const allowed = new Set<string>();
    for (const s of allowStatements) {
        for (const id of await expandScopeToDeviceIds(
            deps,
            tenantId,
            s.scope
        )) {
            allowed.add(id);
        }
    }
    for (const s of denyStatements) {
        for (const id of await expandScopeToDeviceIds(
            deps,
            tenantId,
            s.scope
        )) {
            allowed.delete(id);
        }
    }
    return Array.from(allowed);
}

// ─── Internal: cache hierarchy for shape ──────────────────────────

// Treat a zero (Redis-flushed) counter as missing and seed it from the
// durable shadow column. Without this, all cached entries with version >= 0
// would be served as fresh after a Redis wipe.
async function resolveTenantVersion(
    deps: ResolverDeps,
    tenantId: string
): Promise<number> {
    const v = await deps.cache.getVersion(tenantId);
    if (v > 0) return v;
    const durable = await deps.db.getDurableTenantVersion(tenantId);
    if (durable <= 0) return 0;
    return deps.cache.seedVersionIfMissing(tenantId, durable);
}

async function getOrBuildShape(
    deps: ResolverDeps,
    req: CheckRequest
): Promise<EffectiveShape> {
    const rolesHash = hashRoles(req.builtInRoles);
    const cached = await deps.cache.getEffective(req.userId, req.tenantId);
    const tenantVersion = await resolveTenantVersion(deps, req.tenantId);
    // Rolehash mismatch = Zitadel grant changed without an FM authz
    // bump; rebuild instead of serving stale shape.
    if (
        cached &&
        cached.version >= tenantVersion &&
        cached.rolesHash === rolesHash
    ) {
        Observability.incrementCounter('authz_l2_hits');
        return cached.shape;
    }
    Observability.incrementCounter('authz_l2_misses');
    const shape = await buildEffectiveShape(
        deps,
        req.userId,
        req.tenantId,
        req.builtInRoles
    );
    await deps.cache.setEffective(
        req.userId,
        req.tenantId,
        tenantVersion,
        shape,
        rolesHash,
        ttlSecondsUntilEarliestExpiry(shape)
    );
    return shape;
}

function ttlSecondsUntilEarliestExpiry(
    shape: EffectiveShape
): number | undefined {
    const expiries = shape.statements
        .map((statement) => statement.assignmentExpiresAt)
        .filter((expiresAt): expiresAt is number => expiresAt !== undefined);
    if (expiries.length === 0) return undefined;
    const millisecondsUntilExpiry = Math.min(...expiries) - Date.now();
    return Math.max(1, Math.ceil(millisecondsUntilExpiry / 1000));
}
