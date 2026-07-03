// Resolves a NormalizedEvent into the membership axes used by alert scope
// matching. Takes the postgres callable as a parameter so unit tests can
// pin the no-silent-catch invariant from commit 0b96ecad without standing
// up the full AlertEngine import chain.

import {tuning} from '../../config/tuning';
import {BoundedMap} from '../boundedMap';
import {getGroupVersion} from '../groupVersion';
import {collectEntityIds} from './signals';
import type {NormalizedEvent} from './types';

export interface SubjectMemberships {
    shellyID?: string;
    entityIds?: readonly string[];
    groupIds?: readonly number[];
    locationIds?: readonly number[];
    tagIds?: readonly number[];
}

export type DbCallMethod = (
    method: string,
    params: Record<string, unknown>
) => Promise<{rows?: Array<Record<string, unknown>>} | undefined>;

interface MembershipRow {
    group_ids?: number[];
    location_ids?: number[];
    tag_ids?: number[];
}

// Cache key bakes in groupVersion(orgId) — local mutations evict; peer-
// node mutations remain stale up to alertSubjectCacheTtlMs. Scope to
// alert routing only; never feed permission decisions from this.
const membershipCache = new BoundedMap<string, MembershipRow>({
    maxSize: tuning.alert.subjectCacheMax,
    ttlMs: tuning.alert.subjectCacheTtlMs
});

function cacheKey(orgId: string, shellyID: string): string {
    return `${orgId}|${shellyID}|${getGroupVersion(orgId)}`;
}

export async function resolveSubjectForEvent(
    event: NormalizedEvent,
    pgCall: DbCallMethod
): Promise<SubjectMemberships> {
    if (!('shellyID' in event)) return {};
    const device = 'device' in event ? event.device : undefined;
    const entityIds = device ? collectEntityIds(device) : undefined;
    const orgId = event.organizationId;
    const shellyID = event.shellyID;

    const key = cacheKey(orgId, shellyID);
    let row = membershipCache.get(key);
    if (!row) {
        const res = await pgCall('device.fn_device_memberships', {
            p_org_id: orgId,
            p_shelly_id: shellyID
        });
        row = (res?.rows?.[0] as MembershipRow | undefined) ?? {};
        membershipCache.set(key, row);
    }

    return {
        shellyID,
        entityIds,
        groupIds: row.group_ids ?? undefined,
        locationIds: row.location_ids ?? undefined,
        tagIds: row.tag_ids ?? undefined
    };
}

// Test seam: drops every cached membership.
export function __resetSubjectMembershipCacheForTests(): void {
    membershipCache.clear();
}
