import {tuning} from '../config/tuning';
import {BoundedMap} from './boundedMap';

// Bounded LRU eviction over-invalidates, which is safer than stale group reads.
const groupVersionByOrg = new BoundedMap<string, number>({
    maxSize: tuning.redis.groupVersionCacheMax
});

export function getGroupVersion(orgId: string): number {
    return groupVersionByOrg.get(orgId) ?? 0;
}

export function invalidateGroupCache(orgId: string): void {
    groupVersionByOrg.set(orgId, (groupVersionByOrg.get(orgId) ?? 0) + 1);
}

export function getGroupVersionOrgCount(): number {
    return groupVersionByOrg.size;
}
