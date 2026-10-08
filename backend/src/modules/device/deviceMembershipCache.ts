import {BoundedMap} from '../boundedMap';
import {getOrganizationAccessVersion} from '../organizationCacheVersions';
import * as PostgresProvider from '../PostgresProvider';

// Group, location and tag changes bump the access version; the time to live
// covers a lost cross-process signal.
const TTL_MS = 10_000;
const MAX_ORGANIZATIONS = 500;

interface Entry {
    version: number;
    readAtMs: number;
    rows: Promise<PostgresProvider.DeviceMembershipRow[]>;
}

const entries = new BoundedMap<string, Entry>({maxSize: MAX_ORGANIZATIONS});

export function readDeviceMemberships(
    organizationId: string,
    nowMs: number = Date.now()
): Promise<PostgresProvider.DeviceMembershipRow[]> {
    const version = getOrganizationAccessVersion(organizationId);
    const cached = entries.get(organizationId);
    if (
        cached &&
        cached.version === version &&
        nowMs - cached.readAtMs < TTL_MS
    ) {
        return cached.rows;
    }
    const rows = PostgresProvider.listDeviceMemberships(organizationId);
    const entry: Entry = {version, readAtMs: nowMs, rows};
    entries.set(organizationId, entry);
    rows.catch(() => {
        if (entries.get(organizationId) === entry) {
            entries.delete(organizationId);
        }
    });
    return rows;
}

export function __resetDeviceMembershipCacheForTests(): void {
    entries.clear();
}
