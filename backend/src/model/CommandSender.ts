import log4js from 'log4js';
import type {WebSocket} from 'ws';
import {tuning} from '../config/tuning';
import {authzAction, authzResourceType} from '../modules/authz/actionMap';
import {statementToAccessProvenance} from '../modules/authz/provenance';
import {
    actionAllowed as resolverActionAllowed,
    actionInStatement as resolverActionInStatement,
    applyBoundary as resolverApplyBoundary,
    buildEffectiveShape as resolverBuildEffectiveShape,
    check as resolverCheck,
    conditionMatches as resolverConditionMatches
} from '../modules/authz/resolver';
import {tryGetAuthzRuntime} from '../modules/authz/runtimeHandle';
import type {
    AccessProvenance,
    EffectiveShape,
    Scope
} from '../modules/authz/types';
import {BoundedMap} from '../modules/boundedMap';
import * as Observability from '../modules/Observability';
import {getOrganizationAccessVersion} from '../modules/organizationCacheVersions';
import {
    listDeviceMemberships,
    listGroupDeviceMemberships,
    listLocationParents,
    listOrgDevices
} from '../modules/PostgresProvider';
import {ANONYMOUS_USERNAME} from '../modules/user/anonymous';
import {withTimeout} from '../modules/util/withTimeout';
import type {PrincipalType} from '../types';
import type {EffectiveShape as WireEffectiveShape} from '../types/api/authz';
import {
    type AuthzAction,
    authzRolePriorityIndex
} from '../types/api/authzCatalog';
import {expandLocationScope} from './locationScope';
import type {ComponentName, CrudOperation} from './permissions';

// LRU per-org access cache (groups + device/location/tag indexes).
interface AccessCacheEntry {
    deviceToGroups: Map<string, Set<number>>;
    deviceToLocation: Map<string, number>;
    deviceToTags: Map<string, Set<number>>;
    deviceToTagKeys: Map<string, Set<string>>;
    locationParents: Map<number, number | null>;
    // Source-of-truth shellyID set for this org. Bounds `scope: 'ALL'`
    // and admin checks to the caller's own org.
    orgDeviceIds: ReadonlySet<string>;
    version: number;
}

interface ComponentPermissionRequest {
    component: ComponentName;
    operation: CrudOperation;
    itemId?: string | number;
    // Where the item lives, so a location grant can reach it.
    locationId?: number;
}

/** What a caller's scoped reads reach. See CommandSender.accessibleReach(). */
export interface AccessibleReach {
    deviceIds: ReadonlySet<string>;
    locationIds: ReadonlySet<number>;
    groupIds: ReadonlySet<number>;
    tagIds: ReadonlySet<number>;
}

const READ_REACH_KEY = 'read-reach';

const EMPTY_REACH: AccessibleReach = {
    deviceIds: new Set(),
    locationIds: new Set(),
    groupIds: new Set(),
    tagIds: new Set()
};

// What both reaches cover; null is unrestricted. Exact for the alert reach
// test, which checks each alert against one dimension only.
export function intersectReach(
    left: AccessibleReach | null,
    right: AccessibleReach | null
): AccessibleReach | null {
    if (left === null) return right;
    if (right === null) return left;
    return {
        deviceIds: intersectSet(left.deviceIds, right.deviceIds),
        locationIds: intersectSet(left.locationIds, right.locationIds),
        groupIds: intersectSet(left.groupIds, right.groupIds),
        tagIds: intersectSet(left.tagIds, right.tagIds)
    };
}

function intersectSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): Set<T> {
    return new Set([...left].filter((value) => right.has(value)));
}

// The shape generation and access version say when the answer went stale.
interface AccessibleReachCache {
    reach: AccessibleReach | null;
    shapeGeneration: number;
    accessVersion: number;
}

// Shape consumed by resolverActionAllowed / resolverCheck. Built per-call by
// #buildPermissionResource from the in-memory membership indexes.
interface PermissionResource {
    type: string;
    id: string | number;
    locationId?: number;
    locationIds?: number[];
    deviceGroupIds?: number[];
    tags?: string[];
}

const sharedAccessDataByOrg = new Map<string, AccessCacheEntry>();
// Dedupes concurrent rebuilds per org; capped so a stuck rebuild can't leak.
const orgRebuildPromises = new BoundedMap<string, Promise<void>>({
    maxSize: tuning.redis.groupCacheMaxOrgs,
    ttlMs: 120_000
});

const authzLogger = log4js.getLogger('authz');

// Retry cadence after a failed effective-shape rebuild (deny-all until fixed).
const SHAPE_REBUILD_RETRY_MS = 30_000;

// Every action on every resource: what an admin persona's statement grants.
const FULL_TENANT_QUERY: StatementGrantQuery = {
    action: '*',
    resourceType: '*'
};

function orgWideQuery(
    component: ComponentName,
    operation: CrudOperation
): StatementGrantQuery {
    return {
        action: authzAction(component, operation),
        resourceType: authzResourceType(component)
    };
}

const DIRECT_SCOPE_FIELDS: readonly (keyof Scope)[] = [
    'device_ids',
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

function copyDirectScope(scope: Scope): Scope {
    const out: Scope = {};
    for (const field of DIRECT_SCOPE_FIELDS) {
        const value = scope[field];
        if (Array.isArray(value)) {
            (out as Record<string, unknown>)[field] = value;
        }
    }
    return out;
}

function touchAccessCache(orgId: string, entry: AccessCacheEntry): void {
    sharedAccessDataByOrg.delete(orgId);
    sharedAccessDataByOrg.set(orgId, entry);
    while (sharedAccessDataByOrg.size > tuning.redis.groupCacheMaxOrgs) {
        const oldest = sharedAccessDataByOrg.keys().next().value;
        if (oldest === undefined) break;
        sharedAccessDataByOrg.delete(oldest);
    }
}

// Pure: does this Allow statement grant `query.action` on `query.resourceType`
// given the session context? Extracted from #hasAnyAllow so the per-statement
// check is unit-testable in isolation.
export interface StatementGrantQuery {
    action: string;
    resourceType: string;
}
export function statementGrantsAction(
    stmt: EffectiveShape['statements'][number],
    query: StatementGrantQuery,
    ctx: {mfaPresent: boolean; sourceIp?: string}
): boolean {
    return stmt.effect === 'Allow' && statementCoversAction(stmt, query, ctx);
}

export function statementDeniesAction(
    stmt: EffectiveShape['statements'][number],
    query: StatementGrantQuery,
    ctx: {mfaPresent: boolean; sourceIp?: string}
): boolean {
    return stmt.effect === 'Deny' && statementCoversAction(stmt, query, ctx);
}

// Effect-agnostic: does the statement name this action on this resource type
// under the session context? Scope is deliberately not consulted here.
function statementCoversAction(
    stmt: EffectiveShape['statements'][number],
    query: StatementGrantQuery,
    ctx: {mfaPresent: boolean; sourceIp?: string}
): boolean {
    const {action, resourceType} = query;
    if (!resolverActionInStatement(action, stmt.actions)) return false;
    if (stmt.notActions && resolverActionInStatement(action, stmt.notActions))
        return false;
    if (
        !stmt.resourceTypes.includes(resourceType) &&
        !stmt.resourceTypes.includes('*')
    )
        return false;
    if (stmt.notResourceTypes?.includes(resourceType)) return false;
    if (!resolverConditionMatches(stmt.condition, ctx)) return false;
    return true;
}

// Pure: does device `id` fall under any indirect scope (group / tag / location)?
// Extracted from #expandDeviceIds for testability. The iteration over org
// devices is still O(orgIds) — true batching would require inverted indexes
// (groupId → deviceIds, etc.) and is tracked separately as a follow-up.
export interface DeviceMembershipIndexes {
    deviceToGroups: ReadonlyMap<string, ReadonlySet<number>> | null;
    deviceToTagKeys: ReadonlyMap<string, ReadonlySet<string>> | null;
    deviceToLocation: ReadonlyMap<string, number> | null;
}
// AND across populated selectors — identical semantics to the resolver's
// scopeMatches/expandScopeToDeviceIds, so the shape sent to the frontend
// never promises devices that enforcement would deny.
export function deviceMatchesScopeSelectors(
    id: string,
    indexes: DeviceMembershipIndexes,
    groupSet: ReadonlySet<number> | null,
    tagSet: ReadonlySet<string> | null,
    grantedLocs: ReadonlySet<number> | null,
    locationAncestors: (locId: number) => number[]
): boolean {
    if (groupSet && !deviceInAnyGroup(id, indexes, groupSet)) return false;
    if (tagSet && !deviceHasAnyTag(id, indexes, tagSet)) return false;
    if (grantedLocs) {
        if (!deviceInAnyLocation(id, indexes, grantedLocs, locationAncestors)) {
            return false;
        }
    }
    return true;
}

function deviceInAnyGroup(
    id: string,
    indexes: DeviceMembershipIndexes,
    groupSet: ReadonlySet<number>
): boolean {
    const groups = indexes.deviceToGroups?.get(id);
    if (!groups) return false;
    for (const g of groups) if (groupSet.has(g)) return true;
    return false;
}

function deviceHasAnyTag(
    id: string,
    indexes: DeviceMembershipIndexes,
    tagSet: ReadonlySet<string>
): boolean {
    const tags = indexes.deviceToTagKeys?.get(id);
    if (!tags) return false;
    for (const t of tags) if (tagSet.has(t)) return true;
    return false;
}

function deviceInAnyLocation(
    id: string,
    indexes: DeviceMembershipIndexes,
    grantedLocs: ReadonlySet<number>,
    locationAncestors: (locId: number) => number[]
): boolean {
    const loc = indexes.deviceToLocation?.get(id);
    if (loc === undefined) return false;
    for (const ancestor of locationAncestors(loc)) {
        if (grantedLocs.has(ancestor)) return true;
    }
    return false;
}

export default class CommandSender {
    private permissions: Set<string>;
    private group: string;
    // All JWT roles, sorted by priority. group = roles[0].
    private roles: readonly string[];
    private socket?: WebSocket;
    private username?: string;
    private credentialId?: string;
    private displayName?: string;
    private email?: string;
    private emailVerified?: boolean;
    private organizationId?: string;
    private tenantPinned: boolean;
    private platformAdmin: boolean;
    private userId?: string;
    private trusted: boolean;
    private mfaPresent: boolean;
    private sourceIp?: string;
    // FM-issued scoped PAT only. Narrows the effective shape at the gate.
    private credentialBoundary?: Scope;
    // Surfaces a scoped credential is limited to (e.g. 'mcp:read').
    private credentialAudience: readonly string[];
    // Human vs automation vs internal — for slow-operation diagnostics.
    private principalType: PrincipalType;
    #accessCacheLoaded = false;
    #organizationAccessVersion = -1;
    // Reverse index: shellyID → Set<groupId> for O(1) membership lookups
    #deviceToGroups: Map<string, Set<number>> | null = null;
    #deviceToLocation: Map<string, number> | null = null;
    #deviceToTags: Map<string, Set<number>> | null = null;
    #deviceToTagKeys: Map<string, Set<string>> | null = null;
    #locationParents: Map<number, number | null> | null = null;
    #orgDeviceIds: ReadonlySet<string> | null = null;
    // V2 shape — populated at login by loadV2EffectiveShape() or via constructor for tests.
    #v2EffectiveShape: EffectiveShape | null;
    // Dedupes concurrent shape rebuilds — invalidations + refreshes can race.
    #shapeRebuildInFlight: Promise<void> | null = null;
    #shapeRebuildRetryTimer: ReturnType<typeof setTimeout> | null = null;
    // Bumped on every invalidation; a rebuild applies its result only if
    // unchanged since it started, so it can't restore a revoked shape.
    #shapeGeneration = 0;
    // Keyed by the grant query the reach was built from.
    #reachByGrant = new Map<string, AccessibleReachCache>();

    constructor(opts: {
        permissions: string[];
        roles: readonly string[];
        socket?: WebSocket;
        username?: string;
        displayName?: string;
        email?: string;
        emailVerified?: boolean;
        organizationId?: string;
        tenantPinned?: boolean;
        isPlatformAdmin?: boolean;
        userId?: string;
        trusted?: boolean;
        mfaPresent?: boolean;
        sourceIp?: string;
        v2Shape?: EffectiveShape;
        credentialBoundary?: Scope;
        credentialAudience?: readonly string[];
        principalType?: PrincipalType;
        /** Scoped credential this sender authenticated with, if any. */
        credentialId?: string;
    }) {
        this.permissions = new Set(opts.permissions);
        const sorted = [...opts.roles].sort(
            (a, b) => authzRolePriorityIndex(a) - authzRolePriorityIndex(b)
        );
        this.roles = Object.freeze(sorted);
        // Group = roles[0] (priority pick). No separate input means callers
        // cannot create a group/roles[0] mismatch.
        this.group = this.roles[0] ?? '';
        this.socket = opts.socket;
        this.username = opts.username;
        this.credentialId = opts.credentialId;
        this.displayName = opts.displayName;
        this.email = opts.email;
        this.emailVerified = opts.emailVerified;
        this.organizationId = opts.organizationId;
        this.tenantPinned = opts.tenantPinned ?? false;
        this.platformAdmin = opts.isPlatformAdmin ?? false;
        this.userId = opts.userId;
        this.trusted = opts.trusted ?? false;
        this.mfaPresent = opts.mfaPresent ?? false;
        this.sourceIp = opts.sourceIp;
        this.#v2EffectiveShape = opts.v2Shape ?? null;
        this.credentialBoundary = opts.credentialBoundary;
        this.credentialAudience = Object.freeze([
            ...(opts.credentialAudience ?? [])
        ]);
        this.principalType = opts.principalType ?? 'user';
    }

    // Internal FM callers (INTERNAL/PLUGIN) are trusted; everyone else is the
    // principal type resolved at login.
    getPrincipalType(): PrincipalType {
        return this.trusted ? 'system' : this.principalType;
    }

    isMfaPresent(): boolean {
        return this.mfaPresent;
    }

    // Pinned to one client org — must survive snapshot/restore (report jobs)
    // or a platform admin regains cross-org reach off the live path.
    isTenantPinned(): boolean {
        return this.tenantPinned;
    }

    // Build V2 shape + warm caches at login. Single source for sync checks.
    // Atomic swap on success; preserve last-known-good shape on failure.
    // Concurrent calls dedupe via #shapeRebuildInFlight — one DB rebuild wins.
    async loadV2EffectiveShape(): Promise<void> {
        if (this.trusted) return;
        if (!this.userId || !this.organizationId) return;
        if (this.#shapeRebuildInFlight) return this.#shapeRebuildInFlight;
        const rt = tryGetAuthzRuntime();
        if (!rt) return;
        const startGen = this.#shapeGeneration;
        this.#shapeRebuildInFlight = (async () => {
            await this.#warmGroupListCache();
            try {
                const raw = await resolverBuildEffectiveShape(
                    {cache: rt.cache, db: rt.db, l1: rt.l1},
                    this.userId!,
                    this.organizationId!,
                    [...this.roles]
                );
                // FM-issued scoped PAT narrows the shape at the gate.
                const shaped = this.credentialBoundary
                    ? resolverApplyBoundary(raw, this.credentialBoundary)
                    : raw;
                // Skip if invalidated mid-rebuild (stale state).
                if (this.#shapeGeneration === startGen) {
                    this.#v2EffectiveShape = shaped;
                    // A rebuild keeps the generation, so drop this by hand.
                    this.#reachByGrant.clear();
                }
            } catch (err) {
                // A null shape denies everything — this is availability
                // loss for an authenticated session, not a warning.
                authzLogger.error(
                    'loadV2EffectiveShape failed user=%s org=%s: %s',
                    this.userId,
                    this.organizationId,
                    err
                );
                Observability.incrementCounter('authz_shape_rebuild_failed');
                this.#scheduleShapeRebuildRetry();
            }
        })().finally(() => {
            this.#shapeRebuildInFlight = null;
        });
        return this.#shapeRebuildInFlight;
    }

    // Self-heal after a failed rebuild: without this, a transient resolver
    // outage leaves the session deny-all until an external invalidation.
    // Background shape rebuild — log on failure, never let it escape.
    #fireShapeRebuild(): void {
        void this.loadV2EffectiveShape().catch((err) =>
            authzLogger.error('shape rebuild failed: %s', err)
        );
    }

    #scheduleShapeRebuildRetry(): void {
        if (this.#shapeRebuildRetryTimer) return;
        const timer = setTimeout(() => {
            this.#shapeRebuildRetryTimer = null;
            this.#fireShapeRebuild();
        }, SHAPE_REBUILD_RETRY_MS);
        timer.unref?.();
        this.#shapeRebuildRetryTimer = timer;
    }

    // Test-only: inject org access cache without warming from DB.
    _setAccessCacheForTest(cache: {
        orgDeviceIds: ReadonlySet<string>;
        deviceToGroups?: Map<string, Set<number>>;
        deviceToLocation?: Map<string, number>;
        deviceToTagKeys?: Map<string, Set<string>>;
        locationParents?: Map<number, number | null>;
    }): void {
        this.#orgDeviceIds = cache.orgDeviceIds;
        this.#deviceToGroups = cache.deviceToGroups ?? new Map();
        this.#deviceToLocation = cache.deviceToLocation ?? new Map();
        this.#deviceToTagKeys = cache.deviceToTagKeys ?? new Map();
        this.#deviceToTags = new Map();
        this.#locationParents = cache.locationParents ?? new Map();
        this.#accessCacheLoaded = true;
        this.#organizationAccessVersion = this.organizationId
            ? getOrganizationAccessVersion(this.organizationId)
            : 0;
    }

    getSourceIp(): string | undefined {
        return this.sourceIp;
    }

    /**
     * Identity for audit/actor snapshots. userId is the stable Zitadel sub,
     * username is the email, displayName is the operator's real name (falls
     * back to email when the token carries no `name` claim).
     */
    getUser():
        | {username?: string; displayName?: string; userId?: string}
        | undefined {
        if (this.username || this.userId) {
            return {
                username: this.username,
                displayName: this.displayName,
                userId: this.userId
            };
        }
        return undefined;
    }

    /**
     * The scoped credential this sender authenticated with, or undefined for a
     * person in a browser. Stamped on audit rows so "what did this agent key
     * change?" has an answer.
     */
    getCredentialId(): string | undefined {
        return this.credentialId;
    }

    /** Caller's own email from the login token; kept out of getUser() so
     *  audit and actor snapshots do not start copying personal data. */
    getEmail(): {address: string; verified?: boolean} | undefined {
        if (!this.email) return undefined;
        return {address: this.email, verified: this.emailVerified};
    }

    /** Zitadel sub claim — stable identifier for the authz resolver.
     *  Returns undefined for legacy / unauthenticated senders. */
    getUserId(): string | undefined {
        return this.userId;
    }

    /** Single home for "is this a real principal vs the anonymous sentinel".
     *  Trusted system callers (INTERNAL/PLUGIN), any caller with a verified
     *  identity (userId), or any named non-anonymous user are authenticated;
     *  only the anonymous sentinel is not. Used by permission predicates and
     *  to pick 403 (forbidden) vs 401 (no identity) on a denial. */
    isAuthenticated(): boolean {
        if (this.trusted || this.userId !== undefined) return true;
        return (
            this.username !== undefined && this.username !== ANONYMOUS_USERNAME
        );
    }

    /** Zitadel organization id, or undefined for unauthenticated/legacy senders. */
    getOrganizationId(): string | undefined {
        return this.organizationId;
    }

    /** Backend-internal caller (INTERNAL / PLUGIN). Must supply orgId explicitly. */
    isTrusted(): boolean {
        return this.trusted;
    }

    /** FM-issued scoped PATs can only subtract access; they never retain admin shortcuts. */
    hasCredentialBoundary(): boolean {
        return this.credentialBoundary !== undefined;
    }

    // A scope-all Allow naming the action, unless a scope-all Deny wins.
    #grantsOrgWide(query: StatementGrantQuery): boolean {
        const shape = this.#v2EffectiveShape;
        if (!shape) return false;
        const ctx = {mfaPresent: this.mfaPresent, sourceIp: this.sourceIp};
        const orgWide = shape.statements.filter((s) => s.scope.all === true);
        if (orgWide.some((s) => statementDeniesAction(s, query, ctx))) {
            return false;
        }
        return orgWide.some((s) => statementGrantsAction(s, query, ctx));
    }

    // What the admin persona grants: every action, every resource, scope all.
    // No shape means no grant: authentication loads one for every principal.
    hasFullTenantAuthority(): boolean {
        if (this.hasCredentialBoundary()) return false;
        if (this.trusted || this.isPlatformAdmin()) return true;
        return this.#grantsOrgWide(FULL_TENANT_QUERY);
    }

    /** Platform-admin authority. Scoped PATs never keep admin shortcuts. */
    isPlatformAdmin(): boolean {
        if (this.hasCredentialBoundary()) return false;
        return this.platformAdmin;
    }

    /** Platform admin can cross tenants; pinned platform admins may not. */
    canCrossOrganizations(): boolean {
        return this.isPlatformAdmin() && !this.tenantPinned;
    }

    /**
     * True when the caller can read every device in its organization, so an
     * org-wide aggregate is theirs to see and a shared per-org cache of that
     * aggregate is reusable. Conservative: a non-admin holding an all-devices
     * grant returns false and takes the correct filter-then-aggregate path, just
     * without the cache fast path — never the reverse (no over-disclosure).
     */
    hasUnrestrictedDeviceRead(): boolean {
        return this.hasFullTenantAuthority();
    }

    // Org-wide grant for an operation: a statement whose scope is `all`, not
    // one that merely reaches some items. Mutations with no item to check
    // against (a new root location, detaching a subtree to the root) need
    // this so a tree-bound grant cannot act outside its tree. Deny wins.
    async hasOrgWideAllowAsync(
        component: ComponentName,
        operation: CrudOperation
    ): Promise<boolean> {
        if (this.trusted || this.canCrossOrganizations()) return true;
        if (this.credentialBoundary) return false;
        if (!this.#v2EffectiveShape) await this.loadV2EffectiveShape();
        return this.#grantsOrgWide(orgWideQuery(component, operation));
    }

    // Read access exists, write does not.
    isViewer(): boolean {
        if (this.canWrite()) return false;
        if (this.group === 'viewer') return true;
        return this.#anyAllowedAction((a) => a.endsWith(':read'));
    }

    // True when no Allow statement reaches this caller at all.
    hasNoPermissions(): boolean {
        if (this.trusted) return false;
        return !this.#anyAllowedAction(() => true);
    }

    // True when user has any non-read Allow.
    canWrite(): boolean {
        if (this.trusted) return true;
        if (this.#nodeRedLegacyActionAllowed('*')) return true;
        return this.#anyAllowedAction((action) => !action.endsWith(':read'));
    }

    // Scan V2 shape for any Allow statement matching predicate.
    #anyAllowedAction(predicate: (action: string) => boolean): boolean {
        const shape = this.#v2EffectiveShape;
        if (!shape) return false;
        for (const stmt of shape.statements) {
            if (stmt.effect !== 'Allow') continue;
            for (const action of stmt.actions) {
                if (predicate(action)) return true;
            }
        }
        return false;
    }

    // Any Allow statement granting `action` on `resourceType`. Ignores scope —
    // used for component-level "does the user have any access?" checks.
    // Component-free any-allow check for resources that have no CRUD
    // component (authz_audit). Same shape, same statement rule as the
    // component path; no scope, because the resource is tenant-wide.
    allowsAction(action: AuthzAction, resourceType: string): boolean {
        if (this.trusted) return true;
        return (
            this.#hasAnyAllow(action, resourceType) ||
            this.#nodeRedLegacyActionAllowed(action)
        );
    }

    #hasAnyAllow(action: string, resourceType: string): boolean {
        const shape = this.#v2EffectiveShape;
        if (!shape) return false;
        const ctx = {mfaPresent: this.mfaPresent, sourceIp: this.sourceIp};
        return shape.statements.some((stmt) =>
            statementGrantsAction(stmt, {action, resourceType}, ctx)
        );
    }

    getGroup(): string {
        return this.group;
    }

    getRoles(): readonly string[] {
        return this.roles;
    }

    getPermissions(): readonly string[] {
        return [...this.permissions];
    }

    getCredentialBoundary(): Scope | undefined {
        return this.credentialBoundary;
    }

    getCredentialAudience(): readonly string[] {
        return this.credentialAudience;
    }

    getEffectiveShape(): WireEffectiveShape | null {
        if (this.trusted) return null;
        // Nothing to narrow in the UI when the caller may already do it all.
        if (this.hasFullTenantAuthority()) return null;
        const shape = this.#v2EffectiveShape;
        if (!shape) return null;
        const ctx = {mfaPresent: this.mfaPresent, sourceIp: this.sourceIp};
        const out: WireEffectiveShape['statements'] = [];
        for (const s of shape.statements) {
            const cond = s.condition;
            // Session-stable conditions (mfa, ip) — evaluate now and either
            // strip them or drop the statement. time.window is dynamic; keep.
            const stableCond = cond
                ? ({mfa: cond.mfa, ip: cond.ip} as typeof cond)
                : undefined;
            if (stableCond && !resolverConditionMatches(stableCond, ctx)) {
                continue;
            }
            const dynamicCond = cond?.time
                ? ({time: cond.time} as typeof cond)
                : undefined;
            const scope = this.#expandIndirectScope(s);
            out.push({
                actions: s.actions,
                ...(s.notActions ? {notActions: s.notActions} : {}),
                resourceTypes: s.resourceTypes,
                ...(s.notResourceTypes
                    ? {notResourceTypes: s.notResourceTypes}
                    : {}),
                scope,
                effect: s.effect,
                ...(dynamicCond ? {condition: dynamicCond} : {})
            });
        }
        return {statements: out};
    }

    getEffectiveAccessProvenance(): AccessProvenance[] {
        if (this.trusted) return [];
        const shape = this.#v2EffectiveShape;
        if (!shape) return [];
        return shape.statements.map(statementToAccessProvenance);
    }

    // Resolve indirect scopes into concrete IDs the FE can match exactly.
    // - Device membership (group/tag/location) -> device_ids.
    // - Location ancestors -> descendant location_ids (for location entities).
    #expandIndirectScope(s: {scope: Scope; resourceTypes: string[]}): Scope {
        const scope = s.scope;
        if (scope.all) return scope;
        const covers = (rt: string) =>
            s.resourceTypes.includes(rt) || s.resourceTypes.includes('*');
        const out = copyDirectScope(scope);

        const hasIndirect =
            scope.device_group_ids?.length ||
            scope.device_tags?.length ||
            scope.location_ids?.length;
        if (covers('device') && hasIndirect) {
            const expanded = this.#expandDeviceIds(scope);
            if (expanded !== null) {
                out.device_ids = expanded;
            }
            // ALSO preserve the original membership scope alongside the
            // expanded device_ids. Templates that render groups as
            // user-facing entities (showrooms, stores, sites) need the
            // original group/tag list to display empty containers too,
            // not just containers that already have at least one device.
            // Without this, expanding strips the "this user is scoped to
            // groups X,Y" intent from the wire shape.
            if (scope.device_group_ids) {
                out.device_group_ids = scope.device_group_ids;
            }
            if (scope.device_tags) out.device_tags = scope.device_tags;
        } else {
            if (scope.device_group_ids) {
                out.device_group_ids = scope.device_group_ids;
            }
            if (scope.device_tags) out.device_tags = scope.device_tags;
        }

        if (covers('location') && scope.location_ids?.length) {
            const descendants = this.#expandLocationDescendants(
                scope.location_ids
            );
            out.location_ids = descendants ?? scope.location_ids;
        } else if (scope.location_ids) {
            out.location_ids = scope.location_ids;
        }

        return out;
    }

    // Devices matching the scope: AND across every populated selector,
    // the resolver's enforcement semantics. location_ids match devices
    // whose location chain (self + ancestors) hits a granted location.
    #expandDeviceIds(scope: Scope): string[] | null {
        const orgIds = this.#orgDeviceIds;
        if (!orgIds) return null;
        const groupSet = scope.device_group_ids?.length
            ? new Set(scope.device_group_ids)
            : null;
        const tagSet = scope.device_tags?.length
            ? new Set(scope.device_tags)
            : null;
        const grantedLocs = scope.location_ids?.length
            ? new Set(scope.location_ids)
            : null;
        const direct = scope.device_ids?.length
            ? new Set(scope.device_ids)
            : null;
        // No indirect selectors → the direct list stands alone.
        if (!groupSet && !tagSet && !grantedLocs) {
            return direct ? Array.from(direct) : [];
        }
        const indexes: DeviceMembershipIndexes = {
            deviceToGroups: this.#deviceToGroups,
            deviceToTagKeys: this.#deviceToTagKeys,
            deviceToLocation: this.#deviceToLocation
        };
        const matched: string[] = [];
        for (const id of direct ?? orgIds) {
            if (
                deviceMatchesScopeSelectors(
                    id,
                    indexes,
                    groupSet,
                    tagSet,
                    grantedLocs,
                    (locId) => this.#locationAncestorIds(locId)
                )
            ) {
                matched.push(id);
            }
        }
        return matched;
    }

    // Locations whose ancestor chain hits any granted location id.
    #expandLocationDescendants(grantedIds: number[]): number[] | null {
        const parents = this.#locationParents;
        if (!parents) return null;
        const granted = new Set(grantedIds);
        const out = new Set<number>(grantedIds);
        for (const locId of parents.keys()) {
            if (out.has(locId)) continue;
            for (const ancestor of this.#locationAncestorIds(locId)) {
                if (granted.has(ancestor)) {
                    out.add(locId);
                    break;
                }
            }
        }
        return Array.from(out);
    }

    // Security invalidation: clear shape → fail closed until rebuild.
    clearAuthzDecisionCaches(): void {
        this.#shapeGeneration++; // discard any in-flight (stale) rebuild
        this.#v2EffectiveShape = null;
        this.#reachByGrant.clear();
        const pending = this.#shapeRebuildInFlight;
        // If one is mid-flight, rebuild fresh only after it frees the slot.
        if (pending)
            void pending
                .then(() => this.loadV2EffectiveShape())
                .catch((err) =>
                    authzLogger.error('shape rebuild failed: %s', err)
                );
        else this.#fireShapeRebuild();
    }

    // Precautionary refresh (Redis recovery): keep old shape valid
    // until atomic swap. No deny window for infra events.
    refreshShapeInBackground(): void {
        this.#fireShapeRebuild();
    }

    // ========================================================================
    // New CRUD Permission Methods
    // ========================================================================

    // Component-level CRUD check (no item id). Single source: V2 shape.
    hasCrudPermission(
        component: ComponentName,
        operation: CrudOperation
    ): boolean {
        return this.evaluateComponentPermission({component, operation});
    }

    // Read access on a single item.
    canAccessItem(component: ComponentName, itemId: string | number): boolean {
        return this.evaluateComponentPermission({
            component,
            operation: 'read',
            itemId
        });
    }

    /**
     * Combined check: CRUD permission + item access (if applicable).
     * This is the main method to use for permission checks.
     *
     * @param component - The component being accessed
     * @param operation - The CRUD operation being performed
     * @param itemId - Optional item ID for scoped components
     */
    // Single sync permission check. V2 shape is the only source.
    evaluateComponentPermission(request: ComponentPermissionRequest): boolean {
        const {component, operation, itemId} = request;
        if (this.trusted) return true;
        // Boundary set → no admin shortcut; shape governs the decision.
        if (this.canCrossOrganizations()) return true;

        // Devices: org-boundary fail-closed BEFORE admin shortcut.
        if (component === 'devices' && itemId !== undefined) {
            if (!this.#orgDeviceIds?.has(String(itemId))) return false;
        }

        if (this.hasFullTenantAuthority()) return true;
        if (!this.userId || !this.organizationId) return false;
        const shape = this.#v2EffectiveShape;
        if (!shape) {
            return this.#nodeRedLegacyActionAllowed(
                authzAction(component, operation)
            );
        }

        const resourceType = authzResourceType(component);

        // No itemId — component-level "does any statement grant this?".
        // Skip per-id scope checks so selected-scope users still pass UI gates.
        if (itemId === undefined) {
            const action = authzAction(component, operation);
            return (
                this.#hasAnyAllow(action, resourceType) ||
                this.#nodeRedLegacyActionAllowed(action)
            );
        }

        const resource = this.#buildPermissionResource(
            component,
            resourceType,
            itemId,
            request.locationId
        );
        const action = authzAction(component, operation);
        return (
            resolverActionAllowed(shape, action, resource, {
                mfaPresent: this.mfaPresent,
                sourceIp: this.sourceIp
            }) || this.#nodeRedLegacyActionAllowed(action)
        );
    }

    // Builds the {type, id, locationId?, locationIds?, deviceGroupIds?, tags?}
    // resource consumed by the resolver. Used by both sync + async paths so
    // the per-component membership lookup logic lives in one place.
    #buildPermissionResource(
        component: ComponentName,
        resourceType: string,
        itemId: string | number,
        locationId?: number
    ): PermissionResource {
        const resource: PermissionResource = {type: resourceType, id: itemId};
        if (component === 'devices') {
            const shellyId = String(itemId);
            const locationId = this.#deviceToLocation?.get(shellyId);
            if (locationId !== undefined) {
                resource.locationId = locationId;
                resource.locationIds = this.#locationAncestorIds(locationId);
            }
            resource.deviceGroupIds = Array.from(
                this.#deviceToGroups?.get(shellyId) ?? []
            );
            resource.tags = Array.from(
                this.#deviceToTagKeys?.get(shellyId) ?? []
            );
        } else if (component === 'locations') {
            const locId = Number(itemId);
            resource.locationId = locId;
            resource.locationIds = this.#locationAncestorIds(locId);
        } else if (locationId !== undefined) {
            // A location grant reaches this item through its place, not its id.
            resource.locationId = locationId;
            resource.locationIds = this.#locationAncestorIds(locationId);
        }
        return resource;
    }

    async evaluateComponentPermissionAsync(
        request: ComponentPermissionRequest
    ): Promise<boolean> {
        return await this.#evaluateComponentPermissionAsync(request);
    }

    // In-memory shape is authoritative when present, the access cache is
    // current, and no scoped-PAT boundary needs re-application per call.
    // invalidateAuthzTenant() bumps the access version before the awaited L2
    // invalidate, so a version mismatch means an invalidation is in flight.
    #canUseSyncShape(): boolean {
        if (this.credentialBoundary) return false;
        if (!this.#v2EffectiveShape) return false;
        if (!this.#accessCacheLoaded) return false;
        if (!this.organizationId) return false;
        return (
            this.#organizationAccessVersion ===
            getOrganizationAccessVersion(this.organizationId)
        );
    }

    async #evaluateComponentPermissionAsync(
        request: ComponentPermissionRequest
    ): Promise<boolean> {
        const {component, operation, itemId} = request;
        if (this.trusted) return true;
        // Boundary set → no admin shortcut; resolver governs the decision.
        if (this.canCrossOrganizations()) return true;
        if (!this.userId || !this.organizationId) return false;

        if (this.#canUseSyncShape()) {
            Observability.incrementCounter('authz_async_sync_fast_path');
            return this.evaluateComponentPermission(request);
        }

        const rt = tryGetAuthzRuntime();
        if (!rt) return false;

        if (
            component === 'devices' ||
            component === 'locations' ||
            request.locationId !== undefined
        ) {
            await this.#warmGroupListCache();
        }

        // Devices: explicit org-boundary fail-closed BEFORE admin shortcut.
        if (component === 'devices' && itemId !== undefined) {
            if (!this.#orgDeviceIds?.has(String(itemId))) return false;
        }

        if (this.hasFullTenantAuthority()) return true;

        const resourceType = authzResourceType(component);

        // List check (no itemId): any-allow on the shape. Per-row scope
        // pushdown narrows SQL through readableResourceAllowlistsAsync.
        if (itemId === undefined) {
            const action = authzAction(component, operation);
            if (!this.#v2EffectiveShape) await this.loadV2EffectiveShape();
            return (
                this.#hasAnyAllow(action, resourceType) ||
                this.#nodeRedLegacyActionAllowed(action)
            );
        }

        const resource = this.#buildPermissionResource(
            component,
            resourceType,
            itemId,
            request.locationId
        );
        const action = authzAction(component, operation);

        // Service users (Node-RED) use static perms, not a V2 assignment.
        // Checked first; returns false for normal users.
        if (this.#nodeRedLegacyActionAllowed(action)) return true;

        try {
            // Boundary set → bypass resolverCheck cache (keyed by user/tenant
            // only) and apply boundary against a fresh shape.
            if (this.credentialBoundary) {
                const raw = await resolverBuildEffectiveShape(
                    {cache: rt.cache, db: rt.db, l1: rt.l1},
                    this.userId,
                    this.organizationId,
                    [...this.roles]
                );
                const narrowed = resolverApplyBoundary(
                    raw,
                    this.credentialBoundary
                );
                return resolverActionAllowed(narrowed, action, resource, {
                    mfaPresent: this.mfaPresent,
                    sourceIp: this.sourceIp
                });
            }
            return await resolverCheck(
                {cache: rt.cache, db: rt.db, l1: rt.l1},
                {
                    userId: this.userId,
                    tenantId: this.organizationId,
                    // Full sorted role set — additive, AWS-IAM style.
                    builtInRoles: [...this.roles],
                    action,
                    resource,
                    context: {
                        mfaPresent: this.mfaPresent,
                        sourceIp: this.sourceIp
                    }
                }
            );
        } catch (err) {
            authzLogger.warn(
                'v2 check failed user=%s org=%s component=%s item=%s: %s',
                this.userId,
                this.organizationId,
                component,
                String(itemId ?? '*'),
                err
            );
            return false;
        }
    }

    #locationAncestorIds(locationId: number): number[] {
        const ids = [locationId];
        const parents = this.#locationParents;
        if (!parents) return ids;
        const seen = new Set(ids);
        let current: number | null | undefined = locationId;
        while (current !== null && current !== undefined) {
            current = parents.get(current);
            if (
                current === null ||
                current === undefined ||
                seen.has(current)
            ) {
                break;
            }
            seen.add(current);
            ids.push(current);
        }
        return ids;
    }

    // Devices, places, groups and tags this caller's reads reach; null = no
    // narrowing. Per-item denies stay with the resolver.
    async accessibleReach(): Promise<AccessibleReach | null> {
        if (this.trusted) return null;
        if (this.hasFullTenantAuthority()) return null;
        return this.#cachedReach(READ_REACH_KEY, () =>
            this.#readScopesNarrowedByReach()
        );
    }

    // What the grants allowing this operation reach; null = tenant-wide. Only
    // the granting statements count, so one grant's reach never lends another
    // grant's rights. Scoped denies stay with the per-item resolver.
    async reachForOperation(
        component: ComponentName,
        operation: CrudOperation
    ): Promise<AccessibleReach | null> {
        if (this.trusted) return null;
        if (this.hasFullTenantAuthority()) return null;
        if (!this.#v2EffectiveShape) await this.loadV2EffectiveShape();
        const query = orgWideQuery(component, operation);
        return this.#cachedReach(query.action, () =>
            this.#scopesGranting(query)
        );
    }

    async #cachedReach(
        key: string,
        scopesOf: () => Scope[] | null
    ): Promise<AccessibleReach | null> {
        const accessVersion = this.#currentOrganizationAccessVersion();
        const cached = this.#reachByGrant.get(key);
        if (
            cached &&
            cached.shapeGeneration === this.#shapeGeneration &&
            cached.accessVersion === accessVersion
        ) {
            return cached.reach;
        }
        const shapeGeneration = this.#shapeGeneration;
        const reach = await this.#buildAccessibleReach(scopesOf());
        this.#reachByGrant.set(key, {reach, shapeGeneration, accessVersion});
        return reach;
    }

    // The places of accessibleReach(). null = unrestricted.
    async accessibleLocationIds(): Promise<number[] | null> {
        const reach = await this.accessibleReach();
        return reach === null ? null : Array.from(reach.locationIds);
    }

    // The name the authz evaluator calls; accessibleReach() is the one home.
    async getAllowedLocationIds(): Promise<number[] | null> {
        return this.accessibleLocationIds();
    }

    async #buildAccessibleReach(
        scopes: Scope[] | null
    ): Promise<AccessibleReach | null> {
        if (scopes === null) return null;
        if (scopes.length === 0) return EMPTY_REACH;
        await this.#warmGroupListCache();
        const deviceIds = new Set<string>();
        const grantedPlaces: number[] = [];
        for (const scope of scopes) {
            for (const id of scope.location_ids ?? []) grantedPlaces.push(id);
            for (const id of this.#expandDeviceIds(scope) ?? []) {
                deviceIds.add(id);
            }
        }
        // Only a granted place opens its descendants, never a device's own.
        const locationIds = new Set(
            expandLocationScope(
                grantedPlaces,
                this.#locationParents ?? new Map()
            )
        );
        const groupIds = new Set<number>();
        const tagIds = new Set<number>();
        for (const id of deviceIds) {
            const place = this.#deviceToLocation?.get(id);
            if (place !== undefined) locationIds.add(place);
            for (const g of this.#deviceToGroups?.get(id) ?? [])
                groupIds.add(g);
            for (const t of this.#deviceToTags?.get(id) ?? []) tagIds.add(t);
        }
        return {deviceIds, locationIds, groupIds, tagIds};
    }

    // null = one of these read grants has scope all, so nothing narrows.
    #readScopesNarrowedByReach(): Scope[] | null {
        if (this.#nodeRedLegacyReadsWholeTenant()) return null;
        const shape = this.#v2EffectiveShape;
        if (!shape) return [];
        const ctx = {mfaPresent: this.mfaPresent, sourceIp: this.sourceIp};
        const scopes: Scope[] = [];
        for (const stmt of shape.statements) {
            const grantsRead =
                statementGrantsAction(
                    stmt,
                    {action: 'location:read', resourceType: 'location'},
                    ctx
                ) ||
                statementGrantsAction(
                    stmt,
                    {action: 'device:read', resourceType: 'device'},
                    ctx
                );
            if (!grantsRead) continue;
            if (stmt.scope.all === true) return null;
            scopes.push(stmt.scope);
        }
        return scopes;
    }

    // null = a tenant-wide grant allows it; [] = nothing does.
    #scopesGranting(query: StatementGrantQuery): Scope[] | null {
        if (this.#nodeRedLegacyActionAllowed(query.action)) return null;
        if (this.#grantsOrgWide(query)) return null;
        const shape = this.#v2EffectiveShape;
        if (!shape) return [];
        const ctx = {mfaPresent: this.mfaPresent, sourceIp: this.sourceIp};
        const deniedTenantWide = shape.statements.some(
            (stmt) =>
                stmt.scope.all === true &&
                statementDeniesAction(stmt, query, ctx)
        );
        if (deniedTenantWide) return [];
        return shape.statements
            .filter((stmt) => statementGrantsAction(stmt, query, ctx))
            .map((stmt) => stmt.scope);
    }

    #currentOrganizationAccessVersion(): number {
        return this.organizationId
            ? getOrganizationAccessVersion(this.organizationId)
            : 0;
    }

    // SQL allowlist for `device:read`, including group/location/tag scopes.
    async getAllowedDeviceIds(): Promise<string[] | null> {
        if (this.trusted) return null;
        if (this.hasFullTenantAuthority()) return null;
        await this.#warmGroupListCache();
        const orgDeviceIds = this.#orgDeviceIds;
        if (!orgDeviceIds) return [];
        return Array.from(
            await this.filterAccessibleDevices(Array.from(orgDeviceIds))
        );
    }

    // Scan V2 shape for `${resourceType}:read` Allow statements; return the
    // union of scope.<scopeField>. Returns null (no restriction) if any
    // statement has scope.all OR uses indirect device scoping (group / tag /
    // location-mediated device access can't be enumerated synchronously).
    // Empty array = deny all.
    getAllowedIdsForResource<T extends number | string>(
        resourceType: string,
        scopeField: keyof Scope
    ): T[] | null {
        if (this.trusted) return null;
        const action = `${resourceType}:read`;
        // Service static perms are tenant-wide, like a scope.all statement.
        if (this.#nodeRedLegacyActionAllowed(action)) return null;
        const shape = this.#v2EffectiveShape;
        if (!shape) return [];
        const ids = new Set<T>();
        for (const stmt of shape.statements) {
            if (stmt.effect !== 'Allow') continue;
            if (!stmt.actions.includes(action) && !stmt.actions.includes('*'))
                continue;
            if (
                !stmt.resourceTypes.includes(resourceType) &&
                !stmt.resourceTypes.includes('*')
            )
                continue;
            if (stmt.scope.all) return null;
            if (
                resourceType === 'device' &&
                (stmt.scope.device_group_ids?.length ||
                    stmt.scope.location_ids?.length ||
                    stmt.scope.device_tags?.length)
            ) {
                return null;
            }
            const list = stmt.scope[scopeField] as T[] | undefined;
            if (list) for (const id of list) ids.add(id);
        }
        return Array.from(ids);
    }

    // SQL allowlist resolver per component. Maps component → V2 resource +
    // scope-id field. Resources without per-id scope (groups, tags) return
    // null/[] based on whether ANY read is granted.
    getAllowedIdsForComponent<T extends number | string>(
        component: ComponentName
    ): T[] | null {
        if (this.trusted) return null;
        if (this.hasFullTenantAuthority()) return null;
        const resourceType = authzResourceType(component);
        const idScope: Record<string, keyof Scope> = {
            device: 'device_ids',
            location: 'location_ids',
            dashboard: 'dashboard_ids',
            group: 'device_group_ids',
            device_group: 'device_group_ids',
            plugin: 'plugin_keys',
            waiting_room: 'waiting_room_ids',
            configuration: 'configuration_keys',
            report: 'report_ids',
            organization: 'organization_ids',
            alert: 'alert_ids',
            notification: 'notification_ids',
            integration: 'integration_keys',
            automation: 'automation_ids'
        };
        const scopeField = idScope[resourceType];
        if (scopeField) {
            return this.getAllowedIdsForResource<T>(resourceType, scopeField);
        }
        // No per-id scope (groups, tags, configurations, etc.) — all-or-nothing.
        return this.evaluateComponentPermission({
            component,
            operation: 'read'
        })
            ? null
            : [];
    }

    // ========================================================================
    // Legacy Permission Methods (kept for backward compatibility)
    // ========================================================================

    /**
     * Legacy permission check using permission strings.
     * @deprecated Use hasCrudPermission() or evaluateComponentPermission() instead
     */
    hasPermission(permission: string): boolean {
        // Boundary set -> deny legacy permission strings entirely; bounded
        // credentials must pass through V2 checks where the boundary is applied.
        if (this.hasCredentialBoundary()) return false;
        return (
            this.hasFullTenantAuthority() || this.#hasPermissionRule(permission)
        );
    }

    hasExactPermission(permission: string): boolean {
        if (this.hasCredentialBoundary()) return false;
        return (
            this.hasFullTenantAuthority() || this.permissions.has(permission)
        );
    }

    // Same reads that open the whole reach for a scope.all statement.
    #nodeRedLegacyReadsWholeTenant(): boolean {
        return (
            this.#nodeRedLegacyActionAllowed('location:read') ||
            this.#nodeRedLegacyActionAllowed('device:read')
        );
    }

    #nodeRedLegacyActionAllowed(action: string): boolean {
        // Boundary only narrows the V2 shape — legacy fallback would bypass it.
        if (this.hasCredentialBoundary()) return false;
        if (
            this.username !== 'fleet-nodered' &&
            this.group !== 'automation_service'
        )
            return false;
        if (this.permissions.has('*')) return true;
        return resolverActionInStatement(action, [...this.permissions]);
    }

    // Async path warms the per-org cache before resolving.
    async canAccessDevice(shellyId: string): Promise<boolean> {
        return this.evaluateComponentPermissionAsync({
            component: 'devices',
            operation: 'read',
            itemId: shellyId
        });
    }

    async #warmGroupListCache(): Promise<void> {
        // No org context → no group-scoped fallback is possible for this sender.
        if (!this.organizationId) {
            this.#accessCacheLoaded = true;
            this.#deviceToGroups = new Map();
            this.#deviceToLocation = new Map();
            this.#deviceToTags = new Map();
            this.#deviceToTagKeys = new Map();
            this.#locationParents = new Map();
            this.#orgDeviceIds = new Set();
            this.#organizationAccessVersion = 0;
            return;
        }
        const orgKey = this.organizationId;
        const currentVersion = getOrganizationAccessVersion(orgKey);

        const cached = sharedAccessDataByOrg.get(orgKey);
        if (cached && cached.version === currentVersion) {
            this.#accessCacheLoaded = true;
            this.#deviceToGroups = cached.deviceToGroups;
            this.#deviceToLocation = cached.deviceToLocation;
            this.#deviceToTags = cached.deviceToTags;
            this.#deviceToTagKeys = cached.deviceToTagKeys;
            this.#locationParents = cached.locationParents;
            this.#orgDeviceIds = cached.orgDeviceIds;
            this.#organizationAccessVersion = currentVersion;
            touchAccessCache(orgKey, cached);
            return;
        }

        if (
            !this.#accessCacheLoaded ||
            this.#organizationAccessVersion !== currentVersion
        ) {
            if (this.#organizationAccessVersion !== currentVersion) {
                this.#deviceToGroups = null;
                this.#deviceToLocation = null;
                this.#deviceToTags = null;
                this.#deviceToTagKeys = null;
                this.#locationParents = null;
                this.#orgDeviceIds = null;
            }

            // Coalesce concurrent rebuilds: first caller fires the DB queries,
            // rest await the same promise. Stamps version only on success so a
            // failed rebuild is retried on the next call.
            let rebuild = orgRebuildPromises.get(orgKey);
            if (!rebuild) {
                rebuild = this.#fetchAndCacheOrgAccess(
                    orgKey,
                    currentVersion
                ).finally(() => orgRebuildPromises.delete(orgKey));
                orgRebuildPromises.set(orgKey, rebuild);
            }
            await rebuild;

            this.#accessCacheLoaded = true;
            this.#organizationAccessVersion = currentVersion;
            const built = sharedAccessDataByOrg.get(orgKey);
            if (built) {
                this.#deviceToGroups = built.deviceToGroups;
                this.#deviceToLocation = built.deviceToLocation;
                this.#deviceToTags = built.deviceToTags;
                this.#deviceToTagKeys = built.deviceToTagKeys;
                this.#locationParents = built.locationParents;
                this.#orgDeviceIds = built.orgDeviceIds;
            }
        }
    }

    /** Fetches org membership data from DB and writes it into the shared access cache. */
    async #fetchAndCacheOrgAccess(
        orgKey: string,
        version: number
    ): Promise<void> {
        const groupIdx = new Map<string, Set<number>>();
        const memberships = await listGroupDeviceMemberships(orgKey);
        for (const m of memberships) {
            let s = groupIdx.get(m.subject_id);
            if (!s) {
                s = new Set();
                groupIdx.set(m.subject_id, s);
            }
            s.add(m.group_id);
        }

        const locationIdx = new Map<string, number>();
        const tagIdx = new Map<string, Set<number>>();
        const tagKeyIdx = new Map<string, Set<string>>();
        const locationParents = new Map<number, number | null>();

        const WARM_UP_TIMEOUT_MS = 30_000;
        const [deviceMemberships, parentRows, orgDeviceList] =
            await Promise.all([
                withTimeout(
                    () => listDeviceMemberships(orgKey),
                    WARM_UP_TIMEOUT_MS,
                    'listDeviceMemberships'
                ),
                withTimeout(
                    () => listLocationParents(orgKey),
                    WARM_UP_TIMEOUT_MS,
                    'listLocationParents'
                ),
                withTimeout(
                    () => listOrgDevices(orgKey),
                    WARM_UP_TIMEOUT_MS,
                    'listOrgDevices'
                )
            ]);

        for (const row of deviceMemberships) {
            if (typeof row.location_id === 'number') {
                locationIdx.set(row.subject_id, row.location_id);
            }
            if (Array.isArray(row.tag_ids) && row.tag_ids.length > 0) {
                tagIdx.set(row.subject_id, new Set(row.tag_ids));
            }
            if (Array.isArray(row.tag_keys) && row.tag_keys.length > 0) {
                tagKeyIdx.set(row.subject_id, new Set(row.tag_keys));
            }
        }
        for (const row of parentRows) {
            locationParents.set(row.id, row.parent_location_id ?? null);
        }

        touchAccessCache(orgKey, {
            deviceToGroups: groupIdx,
            deviceToLocation: locationIdx,
            deviceToTags: tagIdx,
            deviceToTagKeys: tagKeyIdx,
            locationParents,
            orgDeviceIds: new Set(orgDeviceList),
            version
        });
    }

    // Tri-state: true/false = confident, null = stale cache → defer to async.
    // trusted + global provider support ignores #orgDeviceIds.
    canAccessDeviceSync(shellyId: string): boolean | null {
        if (this.trusted) return true;
        if (this.canCrossOrganizations()) return true;
        if (this.organizationId) {
            const currentVersion = getOrganizationAccessVersion(
                this.organizationId
            );
            if (this.#organizationAccessVersion !== currentVersion) return null;
        }
        return this.evaluateComponentPermission({
            component: 'devices',
            operation: 'read',
            itemId: shellyId
        });
    }

    // Batch device-read filter. Iterates the in-memory V2 shape — no DB hits.
    // Caller must have a loaded shape (true for any post-login sender).
    async filterAccessibleDevices(shellyIDs: string[]): Promise<Set<string>> {
        if (this.trusted) return new Set(shellyIDs);
        if (this.canCrossOrganizations()) return new Set(shellyIDs);
        await this.#warmGroupListCache();
        const accessible = new Set<string>();
        for (const id of shellyIDs) {
            if (
                this.evaluateComponentPermission({
                    component: 'devices',
                    operation: 'read',
                    itemId: id
                })
            )
                accessible.add(id);
        }
        return accessible;
    }

    #hasPermissionRule(requiredPermission: string) {
        const requiredParts = requiredPermission.split('.');
        if (requiredParts.length < 2) return false;

        for (const userPermission of this.permissions) {
            const userParts = userPermission.split('.');

            let match = true;
            for (let i = 0; i < requiredParts.length; i++) {
                if (userParts[i] === '*') {
                    match = true;
                    break;
                }
                if (
                    userParts[i]?.toLowerCase() !==
                    requiredParts[i]?.toLowerCase()
                ) {
                    match = false;
                    break;
                }
            }

            if (match) return true;
        }

        return false;
    }

    getSocket() {
        return this.socket;
    }

    toString() {
        return `CommandSender(${this.group})[${Array.from(this.permissions).join(',')}]`;
    }

    static readonly INTERNAL = new CommandSender({
        permissions: ['*'],
        roles: ['admin'],
        trusted: true
    });
    // No wildcard grant: plugin calls are gated by the rpcAllowlist at dispatch
    // (Workers.isRpcAllowed). An empty set removes the latent fleet-wide grant
    // if `trusted` is ever relaxed.
    static readonly PLUGIN = new CommandSender({
        permissions: [],
        roles: ['plugins'],
        trusted: true
    });
}
