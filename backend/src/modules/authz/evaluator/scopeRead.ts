import type {ComponentName} from '../../../model/permissions';
import RpcError from '../../../rpc/RpcError';
import type {DashboardScope, ScopeKind} from '../../../types/api/fleet';
import {scopeId, scopeKind} from '../../../types/api/fleet';

export interface ScopeReadSender {
    getAllowedIdsForComponent(
        component: ComponentName
    ): Array<string | number> | null;
    filterAccessibleDevices(ids: string[]): Promise<Set<string>>;
}

export type ScopeDeviceResolver = (
    orgId: string,
    kind: ScopeKind,
    id: number | null
) => Promise<string[]>;

interface ScopeReadOptions {
    resolve: ScopeDeviceResolver;
    requireFullAccess?: boolean;
}

export async function requireScopeRead(
    sender: ScopeReadSender,
    scope: DashboardScope | undefined | null,
    orgId: string,
    resolveOrOptions: ScopeDeviceResolver | ScopeReadOptions
): Promise<void> {
    const options = normalizeScopeReadOptions(resolveOrOptions);
    const kind = scopeKind(scope);
    const id = scopeId(scope);

    if (kind === 'group') {
        await requireReadableGroup(sender, orgId, id, options);
        return;
    }

    if (kind === 'fleet') {
        await requireReadableFleet(sender, orgId, id, options);
        return;
    }

    await requireReadableResolvedDeviceScope(sender, orgId, kind, id, options);
}

export async function readableScopeDevices(
    sender: ScopeReadSender,
    scope: DashboardScope | undefined | null,
    orgId: string,
    resolve: ScopeDeviceResolver
): Promise<Set<string>> {
    const shellyIDs = await resolve(orgId, scopeKind(scope), scopeId(scope));
    return sender.filterAccessibleDevices(shellyIDs);
}

function normalizeScopeReadOptions(
    resolveOrOptions: ScopeDeviceResolver | ScopeReadOptions
): Required<ScopeReadOptions> {
    if (typeof resolveOrOptions === 'function') {
        return {resolve: resolveOrOptions, requireFullAccess: false};
    }
    return {
        resolve: resolveOrOptions.resolve,
        requireFullAccess: resolveOrOptions.requireFullAccess === true
    };
}

async function requireReadableGroup(
    sender: ScopeReadSender,
    orgId: string,
    id: number | null,
    options: Required<ScopeReadOptions>
): Promise<void> {
    if (!canReadComponentItem(sender, 'groups', id ?? undefined)) {
        throw RpcError.Domain('PermissionDenied');
    }
    if (options.requireFullAccess && typeof id === 'number') {
        await requireFullDeviceOverlap(sender, orgId, 'group', id, options);
    }
}

async function requireReadableFleet(
    sender: ScopeReadSender,
    orgId: string,
    id: number | null,
    options: Required<ScopeReadOptions>
): Promise<void> {
    if (!canReadComponentCollection(sender, 'dashboards')) {
        throw RpcError.Domain('PermissionDenied');
    }
    if (options.requireFullAccess) {
        await requireFullDeviceOverlap(sender, orgId, 'fleet', id, options);
    }
}

async function requireReadableResolvedDeviceScope(
    sender: ScopeReadSender,
    orgId: string,
    kind: ScopeKind,
    id: number | null,
    options: Required<ScopeReadOptions>
): Promise<void> {
    const shellyIDs = await options.resolve(orgId, kind, id);
    if (shellyIDs.length === 0) return;

    const accessible = await sender.filterAccessibleDevices(shellyIDs);
    if (accessible.size === 0) throw RpcError.Domain('PermissionDenied');
    if (options.requireFullAccess && accessible.size < shellyIDs.length) {
        throw RpcError.Domain('PermissionDenied');
    }
}

async function requireFullDeviceOverlap(
    sender: ScopeReadSender,
    orgId: string,
    kind: ScopeKind,
    id: number | null,
    options: Required<ScopeReadOptions>
): Promise<void> {
    const shellyIDs = await options.resolve(orgId, kind, id);
    const accessible = await sender.filterAccessibleDevices(shellyIDs);
    if (accessible.size < shellyIDs.length) {
        throw RpcError.Domain('PermissionDenied');
    }
}

function canReadComponentCollection(
    sender: ScopeReadSender,
    component: ComponentName
): boolean {
    const ids = sender.getAllowedIdsForComponent(component);
    return ids === null || ids.length > 0;
}

function canReadComponentItem(
    sender: ScopeReadSender,
    component: ComponentName,
    id: string | number | undefined
): boolean {
    const ids = sender.getAllowedIdsForComponent(component);
    if (ids === null) return true;
    if (id === undefined) return ids.length > 0;
    return ids.includes(id);
}
