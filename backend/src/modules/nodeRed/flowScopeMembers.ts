// Turns a node's groups, places, tags or "whole fleet" into device ids, so a
// flow scoped by group shows on each member's page and in automation.List.
// Places include the places inside them, as the event nodes do. Membership is
// read once per organization per flow cache window.

import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import {readDeviceMemberships} from '../device/deviceMembershipCache';
import * as PostgresProvider from '../PostgresProvider';
import {
    directScopeDevices,
    type NodeTargetScope,
    type ScopeResolver
} from './flowDeviceIds';

const logger = log4js.getLogger('node-red-flow-scope');

export interface MemberDevice {
    deviceId: string;
    groupIds: readonly number[];
    locationId: number | null;
    tagKeys: readonly string[];
}

/** Everything needed to expand a scope inside one organization. */
export interface FleetMembership {
    members: readonly MemberDevice[];
    locationParents: ReadonlyMap<number, number | null>;
    allDeviceIds: readonly string[];
}

type MembershipLoader = (organizationId: string) => Promise<FleetMembership>;

interface CacheEntry {
    value: Promise<FleetMembership>;
    expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
let loader: MembershipLoader = loadFleetMembership;

/** Device ids the scope reaches, sorted once. */
export function devicesInScope(
    scope: NodeTargetScope,
    membership: FleetMembership
): string[] {
    const ids = new Set(scope.deviceIds);
    for (const id of membersByScope(scope, membership)) ids.add(id);
    return [...ids].sort((a, b) => a.localeCompare(b));
}

/** A resolver for these scopes; loads membership only when one needs it. */
export async function scopeResolverFor(input: {
    organizationId: string | undefined;
    scopes: readonly NodeTargetScope[];
}): Promise<ScopeResolver> {
    const organizationId = input.organizationId;
    if (!organizationId || !input.scopes.some(needsMembership)) {
        return directScopeDevices;
    }
    const membership = await readMembershipSafely(organizationId);
    if (!membership) return directScopeDevices;
    return (scope) => devicesInScope(scope, membership);
}

function needsMembership(scope: NodeTargetScope): boolean {
    return (
        scope.fleet ||
        scope.groupIds.length > 0 ||
        scope.locationIds.length > 0 ||
        scope.tagKeys.length > 0
    );
}

function membersByScope(
    scope: NodeTargetScope,
    membership: FleetMembership
): readonly string[] {
    if (scope.fleet) return membership.allDeviceIds;
    const groups = new Set(scope.groupIds);
    const places = placesWithin(scope.locationIds, membership.locationParents);
    const tags = new Set(scope.tagKeys);
    return membership.members
        .filter(
            (member) =>
                member.groupIds.some((id) => groups.has(id)) ||
                (member.locationId !== null && places.has(member.locationId)) ||
                member.tagKeys.some((key) => tags.has(key))
        )
        .map((member) => member.deviceId);
}

function placesWithin(
    roots: readonly number[],
    parents: ReadonlyMap<number, number | null>
): Set<number> {
    const children = childIndex(parents);
    const found = new Set<number>();
    const pending = [...roots];
    while (pending.length > 0) {
        const place = pending.pop() as number;
        if (found.has(place)) continue;
        found.add(place);
        pending.push(...(children.get(place) ?? []));
    }
    return found;
}

function childIndex(
    parents: ReadonlyMap<number, number | null>
): Map<number, number[]> {
    const children = new Map<number, number[]>();
    for (const [place, parent] of parents) {
        if (parent === null) continue;
        children.set(parent, [...(children.get(parent) ?? []), place]);
    }
    return children;
}

// A failed read must not break a device page; direct ids still show.
async function readMembershipSafely(
    organizationId: string
): Promise<FleetMembership | null> {
    try {
        return await cachedMembership(organizationId);
    } catch (error) {
        logger.warn(
            'Could not read group, place and tag members for Node-RED flows; only devices named directly are shown: %s',
            error
        );
        return null;
    }
}

function cachedMembership(organizationId: string): Promise<FleetMembership> {
    const hit = cache.get(organizationId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const entry: CacheEntry = {
        value: loader(organizationId),
        expiresAt: Date.now() + tuning.nodeRed.flowCacheMs
    };
    cache.set(organizationId, entry);
    entry.value.catch(() => forgetFailedEntry(organizationId, entry));
    return entry.value;
}

function forgetFailedEntry(organizationId: string, entry: CacheEntry): void {
    if (cache.get(organizationId) === entry) cache.delete(organizationId);
}

async function loadFleetMembership(
    organizationId: string
): Promise<FleetMembership> {
    const [rows, parents, allDeviceIds] = await Promise.all([
        readDeviceMemberships(organizationId),
        PostgresProvider.listLocationParents(organizationId),
        PostgresProvider.listOrgDevices(organizationId)
    ]);
    return {
        members: rows.map((row) => ({
            deviceId: row.subject_id,
            groupIds: row.group_ids ?? [],
            locationId: row.location_id ?? null,
            tagKeys: row.tag_keys ?? []
        })),
        locationParents: new Map(
            parents.map((row) => [row.id, row.parent_location_id])
        ),
        allDeviceIds
    };
}

/** Test seam: swap the membership reader and forget cached answers. */
export function _setMembershipLoaderForTest(
    next: MembershipLoader | null
): void {
    loader = next ?? loadFleetMembership;
    cache.clear();
}
