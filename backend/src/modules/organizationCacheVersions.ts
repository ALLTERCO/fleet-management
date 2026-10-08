import {tuning} from '../config/tuning';
import {BoundedMap} from './boundedMap';

// Organization access changes and device group-metadata changes are different
// cache domains. Device inventory, ownership, location, tag, or authorization
// mutations must invalidate accessible-device shapes without discarding
// unchanged group names for every device in the organization.
//
// Bounded LRU eviction returns a missing version to zero. That can only cause a
// conservative cache rebuild because cache entries also store the version they
// observed.
const organizationAccessVersionByOrg = new BoundedMap<string, number>({
    maxSize: tuning.redis.organizationVersionCacheMax
});
const deviceGroupMetadataVersionByOrg = new BoundedMap<string, number>({
    maxSize: tuning.redis.organizationVersionCacheMax
});

export function getOrganizationAccessVersion(orgId: string): number {
    return organizationAccessVersionByOrg.get(orgId) ?? 0;
}

export function bumpOrganizationAccessVersion(orgId: string): void {
    organizationAccessVersionByOrg.set(
        orgId,
        (organizationAccessVersionByOrg.get(orgId) ?? 0) + 1
    );
}

export function getOrganizationAccessVersionOrgCount(): number {
    return organizationAccessVersionByOrg.size;
}

export function getDeviceGroupMetadataVersion(orgId: string): number {
    return deviceGroupMetadataVersionByOrg.get(orgId) ?? 0;
}

export function bumpDeviceGroupMetadataVersion(orgId: string): void {
    deviceGroupMetadataVersionByOrg.set(
        orgId,
        (deviceGroupMetadataVersionByOrg.get(orgId) ?? 0) + 1
    );
}

export function getDeviceGroupMetadataVersionOrgCount(): number {
    return deviceGroupMetadataVersionByOrg.size;
}
