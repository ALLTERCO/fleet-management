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
import {tryGetAuthzRuntime} from '../modules/authz/runtime';
import type {
    AccessProvenance,
    EffectiveShape,
    Scope
} from '../modules/authz/types';
import {BoundedMap} from '../modules/boundedMap';
import {getGroupVersion} from '../modules/groupVersion';
import * as Observability from '../modules/Observability';
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
import {authzRolePriorityIndex} from '../types/api/authzCatalog';
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
    const {action, resourceType} = query;
    if (stmt.effect !== 'Allow') return false;
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
    private displayName?: string;
    private organizationId?: string;
    private tenantPinned: boolean;
    private platformAdmin: boolean;
    private userId?: string;
    private trusted: boolean;
    private mfaPresent: boolean;
    private sourceIp?: string;
    // FM-issued scoped PAT only. Narrows the effective shape at the gate.
    private credentialBoundary?: Scope;
    // Human vs automation vs internal — for slow-operation diagnostics.
    private principalType: PrincipalType;
    #accessCacheLoaded = false;
    #groupListVersion = -1;
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

    constructor(opts: {
        permissions: string[];
        roles: readonly string[];
        socket?: WebSocket;
        username?: string;
        displayName?: string;
        organizationId?: string;
        tenantPinned?: boolean;
        isPlatformAdmin?: boolean;
        userId?: string;
        trusted?: boolean;
        mfaPresent?: boolean;
        sourceIp?: string;
        v2Shape?: EffectiveShape;
        credentialBoundary?: Scope;
        principalType?: PrincipalType;
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
        this.displayName = opts.displayName;
        this.organizationId = opts.organizationId;
        this.tenantPinned = opts.tenantPinned ?? false;
        this.platformAdmin = opts.isPlatformAdmin ?? false;
        this.userId = opts.userId;
        this.trusted = opts.trusted ?? false;
        this.mfaPresent = opts.mfaPresent ?? false;
        this.sourceIp = opts.sourceIp;
        this.#v2EffectiveShape = opts.v2Shape ?? null;
        this.credentialBoundary = opts.credentialBoundary;
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
        this.#groupListVersion = this.organizationId
            ? getGroupVersion(this.organizationId)
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

    /** Effective admin within their own organization. Provider support also passes this. */
    isAdmin(): boolean {
        if (this.hasCredentialBoundary()) return false;
        return (
            this.group === 'admin' ||
            this.isPlatformAdmin() ||
            this.permissions.has('*')
        );
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
        return this.canCrossOrganizations() || this.isAdmin();
    }

    // Read access exists, write does not.
    isViewer(): boolean {
        if (this.isAdmin()) return false;
        if (this.group === 'viewer') return true;
        return (
            this.#anyAllowedAction((a) => a.endsWith(':read')) &&
            !this.canWrite()
        );
    }

    // True when user has no Allow statements (and not admin).
    hasNoPermissions(): boolean {
        if (this.isAdmin()) return false;
        return !this.#anyAllowedAction(() => true);
    }

    // True when user has any non-read Allow.
    canWrite(): boolean {
        if (this.isAdmin()) return true;
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

    hasRole(role: string): boolean {
        if (this.hasCredentialBoundary()) return false;
        return this.roles.includes(role);
    }

    getEffectiveShape(): WireEffectiveShape | null {
        if (this.trusted) return null;
        // Admin with boundary surfaces the narrowed shape; admin without
        // boundary skips the wire-shape entirely (UI shows full access).
        if (this.isAdmin() && !this.credentialBoundary) return null;
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

        if (!this.credentialBoundary && this.isAdmin()) return true;
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
            itemId
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
        itemId: string | number
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
    // invalidateAuthzTenant() bumps the group version before the awaited L2
    // invalidate, so a version mismatch means an invalidation is in flight.
    #canUseSyncShape(): boolean {
        if (this.credentialBoundary) return false;
        if (!this.#v2EffectiveShape) return false;
        if (!this.#accessCacheLoaded) return false;
        if (!this.organizationId) return false;
        return this.#groupListVersion === getGroupVersion(this.organizationId);
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

        if (component === 'devices' || component === 'locations') {
            await this.#warmGroupListCache();
        }

        // Devices: explicit org-boundary fail-closed BEFORE admin shortcut.
        if (component === 'devices' && itemId !== undefined) {
            if (!this.#orgDeviceIds?.has(String(itemId))) return false;
        }

        if (!this.credentialBoundary && this.isAdmin()) return true;

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
            itemId
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

    // SQL allowlist for `location:read`. null = no filter (admin / scope:all).
    // Returns an expanded subtree of allowed location ids.
    async getAllowedLocationIds(): Promise<number[] | null> {
        if (this.trusted) return null;
        if (!this.credentialBoundary && this.isAdmin()) return null;
        const ids = this.getAllowedIdsForResource<number>(
            'location',
            'location_ids'
        );
        if (ids === null) return null;
        await this.#warmGroupListCache();
        return expandLocationScope(ids, this.#locationParents ?? new Map());
    }

    // SQL allowlist for `device:read`, including group/location/tag scopes.
    async getAllowedDeviceIds(): Promise<string[] | null> {
        if (this.trusted) return null;
        if (this.canCrossOrganizations()) return null;
        if (!this.credentialBoundary && this.isAdmin()) return null;
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
        if (!this.credentialBoundary && this.isAdmin()) return null;
        const shape = this.#v2EffectiveShape;
        if (!shape) return [];
        const action = `${resourceType}:read`;
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
        if (!this.credentialBoundary && this.isAdmin()) return null;
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
        return this.isAdmin() || this.#hasPermissionRule(permission);
    }

    hasExactPermission(permission: string): boolean {
        if (this.hasCredentialBoundary()) return false;
        return this.isAdmin() || this.permissions.has(permission);
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
            this.#groupListVersion = 0;
            return;
        }
        const orgKey = this.organizationId;
        const currentVersion = getGroupVersion(orgKey);

        const cached = sharedAccessDataByOrg.get(orgKey);
        if (cached && cached.version === currentVersion) {
            this.#accessCacheLoaded = true;
            this.#deviceToGroups = cached.deviceToGroups;
            this.#deviceToLocation = cached.deviceToLocation;
            this.#deviceToTags = cached.deviceToTags;
            this.#deviceToTagKeys = cached.deviceToTagKeys;
            this.#locationParents = cached.locationParents;
            this.#orgDeviceIds = cached.orgDeviceIds;
            this.#groupListVersion = currentVersion;
            touchAccessCache(orgKey, cached);
            return;
        }

        if (
            !this.#accessCacheLoaded ||
            this.#groupListVersion !== currentVersion
        ) {
            if (this.#groupListVersion !== currentVersion) {
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
            this.#groupListVersion = currentVersion;
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
            const currentVersion = getGroupVersion(this.organizationId);
            if (this.#groupListVersion !== currentVersion) return null;
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
