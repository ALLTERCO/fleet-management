import {tuning} from '../config/tuning';
import {BoundedMap} from './boundedMap';
import {incrementCounter} from './observability/counters';
import {getDeviceGroupMetadataVersion} from './organizationCacheVersions';
import * as postgres from './PostgresProvider';
import {SingleFlight} from './singleFlight';
import {TickBatchLoader} from './tickBatchLoader';

// Must not exceed the cap in organization.fn_group_find_by_devices; it bounds
// how long one batch holds a pool connection.
export const DEVICE_GROUP_LOOKUP_BATCH_LIMIT = 100;
// Must not exceed the cap in organization.fn_group_device_map_page.
export const DEVICE_GROUP_MAP_PAGE_LIMIT = 1000;

export interface DeviceGroup {
    id: number;
    name: string;
}

export interface DeviceGroupSubject {
    organizationId: string;
    externalId: string;
    // device.list row id; not positive while the device has no row.
    deviceId: number;
}

export interface DeviceGroupMapRow {
    deviceId: number;
    externalId: string;
    groups: DeviceGroup[];
}

export type DeviceGroupsLookup =
    | {found: true; groups: DeviceGroup[]}
    | {found: false};

export interface OrgDeviceGroupMapsDeps {
    // Grouped devices kept over all organizations together.
    maxEntries: number;
    pageLimit: number;
    currentVersion(organizationId: string): number;
    loadPage(
        organizationId: string,
        afterDeviceId: number | null
    ): Promise<DeviceGroupMapRow[]>;
    readOne(
        organizationId: string,
        externalId: string
    ): Promise<DeviceGroupsLookup>;
}

interface MapEntry {
    // 0 when the row is not known (the id came from a change signal).
    deviceId: number;
    groups: DeviceGroup[];
}

type MapState = 'loading' | 'ready' | 'over-budget';

interface OrgGroupMap {
    version: number;
    state: MapState;
    ready: Promise<boolean>;
    entries: Map<string, MapEntry>;
    groupedRows: Set<number>;
    // Devices changed since the load; read again once, together.
    changed: Set<string>;
    changedRead?: Promise<void>;
}

// Device -> groups per org and version; a device not in it has no groups.
export class OrgDeviceGroupMaps {
    readonly #deps: OrgDeviceGroupMapsDeps;
    // Insertion order is recency: the first map is evicted first.
    readonly #maps = new Map<string, OrgGroupMap>();
    #entryCount = 0;

    constructor(deps: OrgDeviceGroupMapsDeps) {
        this.#deps = deps;
    }

    // Undefined when the organization is too large for the map.
    async read(
        subject: DeviceGroupSubject
    ): Promise<DeviceGroup[] | undefined> {
        const map = this.#current(subject.organizationId);
        if (!(await map.ready)) return undefined;
        await this.#readChanged(subject.organizationId, map);
        const known = answerFromMap(map, subject);
        if (known) {
            incrementCounter('device_group_metadata_cache_hits_total');
            return known;
        }
        return this.#verify(subject, map);
    }

    // Call right after the version moved; no ids means reload on next need.
    noteVersionChange(
        organizationId: string,
        externalIds?: readonly string[]
    ): void {
        const map = this.#maps.get(organizationId);
        if (!map) return;
        const version = this.#deps.currentVersion(organizationId);
        if (!externalIds || map.version !== version - 1) {
            this.forget(organizationId);
            return;
        }
        map.version = version;
        this.#markChanged(organizationId, map, externalIds);
    }

    // Membership of these devices may have changed with no version change.
    noteDevicesChanged(
        organizationId: string,
        externalIds: readonly string[]
    ): void {
        const map = this.#maps.get(organizationId);
        if (map) this.#markChanged(organizationId, map, externalIds);
    }

    forget(organizationId: string): void {
        const map = this.#maps.get(organizationId);
        if (!map) return;
        this.#maps.delete(organizationId);
        this.#entryCount -= map.entries.size;
    }

    has(organizationId: string): boolean {
        return this.#maps.has(organizationId);
    }

    get size(): number {
        return this.#entryCount;
    }

    #current(organizationId: string): OrgGroupMap {
        const version = this.#deps.currentVersion(organizationId);
        const existing = this.#maps.get(organizationId);
        if (existing?.version === version) {
            this.#maps.delete(organizationId);
            this.#maps.set(organizationId, existing);
            return existing;
        }
        this.forget(organizationId);
        const map: OrgGroupMap = {
            version,
            state: 'loading',
            ready: Promise.resolve(false),
            entries: new Map(),
            groupedRows: new Set(),
            changed: new Set()
        };
        map.ready = this.#load(organizationId, map);
        this.#maps.set(organizationId, map);
        return map;
    }

    async #load(organizationId: string, map: OrgGroupMap): Promise<boolean> {
        incrementCounter('device_group_metadata_cache_misses_total');
        let rows: DeviceGroupMapRow[] | null;
        try {
            rows = await this.#readAllPages(organizationId);
        } catch (error) {
            if (this.#maps.get(organizationId) === map) {
                this.forget(organizationId);
            }
            throw error;
        }
        if (!rows) {
            map.state = 'over-budget';
            return false;
        }
        for (const row of rows) {
            map.entries.set(row.externalId, {
                deviceId: row.deviceId,
                groups: row.groups
            });
            map.groupedRows.add(row.deviceId);
        }
        map.state = 'ready';
        if (this.#maps.get(organizationId) === map) {
            this.#entryCount += map.entries.size;
            this.#evictOthers(map);
        }
        return true;
    }

    // Null when the organization has more grouped devices than the budget.
    async #readAllPages(
        organizationId: string
    ): Promise<DeviceGroupMapRow[] | null> {
        const rows: DeviceGroupMapRow[] = [];
        let after: number | null = null;
        for (;;) {
            const page = await this.#deps.loadPage(organizationId, after);
            rows.push(...page);
            if (rows.length > this.#deps.maxEntries) return null;
            if (page.length < this.#deps.pageLimit) return rows;
            after = nextPageStart(page, after);
        }
    }

    #evictOthers(keep: OrgGroupMap): void {
        for (const [organizationId, map] of this.#maps) {
            if (this.#entryCount <= this.#deps.maxEntries) return;
            if (map !== keep) this.forget(organizationId);
        }
    }

    #markChanged(
        organizationId: string,
        map: OrgGroupMap,
        externalIds: readonly string[]
    ): void {
        if (map.state === 'over-budget') return;
        if (
            map.state !== 'ready' ||
            map.changed.size + externalIds.length > this.#deps.pageLimit
        ) {
            this.forget(organizationId);
            return;
        }
        for (const id of externalIds) map.changed.add(id);
    }

    // All changed devices are read once, batched, by the first device that needs the map.
    async #readChanged(
        organizationId: string,
        map: OrgGroupMap
    ): Promise<void> {
        if (map.changed.size === 0) return;
        map.changedRead ??= this.#readChangedOnce(organizationId, map).finally(
            () => {
                map.changedRead = undefined;
            }
        );
        await map.changedRead;
    }

    async #readChangedOnce(
        organizationId: string,
        map: OrgGroupMap
    ): Promise<void> {
        const ids = [...map.changed];
        map.changed.clear();
        let results: DeviceGroupsLookup[];
        try {
            incrementCounter('device_group_metadata_cache_misses_total');
            results = await Promise.all(
                ids.map((id) => this.#deps.readOne(organizationId, id))
            );
        } catch (error) {
            for (const id of ids) map.changed.add(id);
            throw error;
        }
        ids.forEach((id, index) => {
            // Changed again while this read ran: the next pass reads it.
            if (map.changed.has(id)) return;
            const result = results[index];
            this.#store(organizationId, map, {
                externalId: id,
                deviceId: map.entries.get(id)?.deviceId ?? 0,
                groups: result.found ? result.groups : []
            });
        });
    }

    // Re-admitted device or a new id on a grouped row: read once, then keep.
    async #verify(
        subject: DeviceGroupSubject,
        map: OrgGroupMap
    ): Promise<DeviceGroup[]> {
        incrementCounter('device_group_metadata_cache_misses_total');
        const version = map.version;
        const groups = await readOneGroups(subject, version);
        if (map.version === version && !map.changed.has(subject.externalId)) {
            this.#store(subject.organizationId, map, {
                externalId: subject.externalId,
                deviceId: subject.deviceId,
                groups
            });
        }
        return groups;
    }

    #store(
        organizationId: string,
        map: OrgGroupMap,
        row: DeviceGroupMapRow
    ): void {
        const counted = this.#maps.get(organizationId) === map;
        const before = map.entries.size;
        const previous = map.entries.get(row.externalId);
        if (previous && row.groups.length === 0) {
            map.groupedRows.delete(previous.deviceId);
        }
        if (row.groups.length === 0 && row.deviceId <= 0) {
            map.entries.delete(row.externalId);
        } else {
            map.entries.set(row.externalId, {
                deviceId: row.deviceId,
                groups: row.groups
            });
        }
        if (row.groups.length > 0 && row.deviceId > 0) {
            map.groupedRows.add(row.deviceId);
        }
        if (!counted) return;
        this.#entryCount += map.entries.size - before;
        this.#evictOthers(map);
    }
}

function answerFromMap(
    map: OrgGroupMap,
    subject: DeviceGroupSubject
): DeviceGroup[] | undefined {
    const entry = map.entries.get(subject.externalId);
    if (entry) {
        const sameRow =
            entry.deviceId <= 0 || entry.deviceId === subject.deviceId;
        return sameRow ? entry.groups : undefined;
    }
    return map.groupedRows.has(subject.deviceId) ? undefined : [];
}

function nextPageStart(
    page: readonly DeviceGroupMapRow[],
    after: number | null
): number {
    const last = page[page.length - 1].deviceId;
    if (after !== null && last <= after) throw invalidResponse();
    return last;
}

const loader = new TickBatchLoader<DeviceGroupsLookup>({
    maxBatchSize: DEVICE_GROUP_LOOKUP_BATCH_LIMIT,
    loadBatch: loadDeviceGroups
});

const orgMaps = new OrgDeviceGroupMaps({
    maxEntries: tuning.device.groupsCacheMax,
    pageLimit: DEVICE_GROUP_MAP_PAGE_LIMIT,
    currentVersion: getDeviceGroupMetadataVersion,
    loadPage: loadDeviceGroupMapPage,
    readOne: (organizationId, externalId) =>
        loader.load(organizationId, externalId)
});

// For devices the map cannot answer (no row id, org over budget); org and version gate it.
interface DeviceGroupsCacheEntry {
    orgId: string;
    orgVersion: number;
    groups: DeviceGroup[];
}
const deviceGroupsCache = new BoundedMap<string, DeviceGroupsCacheEntry>({
    maxSize: tuning.device.groupsCacheMax
});
const deviceGroupReads = new SingleFlight<string, DeviceGroup[]>(
    'device_groups'
);

// Groups attached to a device's events.
export async function readDeviceGroups(
    subject: DeviceGroupSubject
): Promise<DeviceGroup[]> {
    if (Number.isSafeInteger(subject.deviceId) && subject.deviceId > 0) {
        const groups = await orgMaps.read(subject);
        if (groups) return groups;
    }
    return readThroughDeviceCache(subject);
}

export function noteDeviceGroupVersionChange(
    organizationId: string,
    externalIds?: readonly string[]
): void {
    orgMaps.noteVersionChange(organizationId, externalIds);
}

export function noteDeviceGroupsChanged(
    organizationId: string,
    externalIds: readonly string[]
): void {
    orgMaps.noteDevicesChanged(organizationId, externalIds);
    for (const id of externalIds) deviceGroupsCache.delete(id);
}

export function forgetOrganizationDeviceGroups(organizationId: string): void {
    orgMaps.forget(organizationId);
}

export function hasOrganizationDeviceGroups(organizationId: string): boolean {
    return orgMaps.has(organizationId);
}

// Else a re-admitted device could read its old groups.
export function forgetDeviceGroups(externalId: string): void {
    deviceGroupsCache.delete(externalId);
}

export function deviceGroupCacheSize(): number {
    return orgMaps.size + deviceGroupsCache.size;
}

async function readThroughDeviceCache(
    subject: DeviceGroupSubject
): Promise<DeviceGroup[]> {
    const {organizationId, externalId} = subject;
    const version = getDeviceGroupMetadataVersion(organizationId);
    const cached = deviceGroupsCache.get(externalId);
    if (cached?.orgId === organizationId && cached.orgVersion === version) {
        incrementCounter('device_group_metadata_cache_hits_total');
        return cached.groups;
    }
    incrementCounter('device_group_metadata_cache_misses_total');
    const groups = await readOneGroups(subject, version);
    // Version from before the read, so a read that crossed a change is redone.
    deviceGroupsCache.set(externalId, {
        orgId: organizationId,
        orgVersion: version,
        groups
    });
    return groups;
}

// Concurrent reads of one device share a read. The version is in the key so
// a read after a group change never joins one that started before it.
function readOneGroups(
    subject: DeviceGroupSubject,
    version: number
): Promise<DeviceGroup[]> {
    const {organizationId, externalId} = subject;
    return deviceGroupReads.run(
        JSON.stringify([organizationId, externalId, version]),
        () => lookupDeviceGroups(organizationId, externalId)
    );
}

// Groups of one device, read together with every other device of the same
// organization asked for in this event-loop turn.
export async function lookupDeviceGroups(
    organizationId: string,
    externalId: string
): Promise<DeviceGroup[]> {
    const lookup = await loader.load(organizationId, externalId);
    if (!lookup.found) {
        throw Object.assign(new Error('Device not found in organization'), {
            code: 'DEVICE_GROUPS_DEVICE_NOT_FOUND'
        });
    }
    return lookup.groups;
}

export async function loadDeviceGroupMapPage(
    organizationId: string,
    afterDeviceId: number | null
): Promise<DeviceGroupMapRow[]> {
    const result = await postgres.callMethod(
        'organization.fn_group_device_map_page',
        {
            p_organization_id: organizationId,
            p_after_device_id: afterDeviceId,
            p_limit: DEVICE_GROUP_MAP_PAGE_LIMIT
        }
    );
    return parseMapRows(result?.rows);
}

async function loadDeviceGroups(
    organizationId: string,
    externalIds: readonly string[]
): Promise<ReadonlyMap<string, DeviceGroupsLookup>> {
    if (externalIds.length === 1) {
        return await loadOneDeviceGroups(organizationId, externalIds[0]);
    }
    const result = await postgres.callMethod(
        'organization.fn_group_find_by_devices',
        {p_organization_id: organizationId, p_external_ids: [...externalIds]}
    );
    return parseBatchRows(result?.rows, externalIds);
}

// One device keeps the single-member function and its errors.
async function loadOneDeviceGroups(
    organizationId: string,
    externalId: string
): Promise<ReadonlyMap<string, DeviceGroupsLookup>> {
    const result = await postgres.callMethod(
        'organization.fn_group_find_by_member',
        {
            p_organization_id: organizationId,
            p_subject_type: 'device',
            p_subject_id: externalId
        }
    );
    return new Map([
        [externalId, {found: true, groups: parseGroups(result?.rows ?? [])}]
    ]);
}

function invalidResponse(): Error {
    return Object.assign(new Error('Invalid device group lookup response'), {
        code: 'DEVICE_GROUPS_INVALID_RESPONSE'
    });
}

// Devices with the same groups share one array, which keeps a large map small.
function parseMapRows(rows: unknown): DeviceGroupMapRow[] {
    if (!Array.isArray(rows)) throw invalidResponse();
    const shared = new Map<string, DeviceGroup[]>();
    return rows.map((row) => {
        if (
            !Number.isSafeInteger(row?.device_id) ||
            row.device_id <= 0 ||
            typeof row.external_id !== 'string'
        ) {
            throw invalidResponse();
        }
        const groups = parseGroups(row.groups);
        const key = JSON.stringify(groups);
        if (!shared.has(key)) shared.set(key, groups);
        return {
            deviceId: row.device_id,
            externalId: row.external_id,
            groups: shared.get(key) as DeviceGroup[]
        };
    });
}

function parseBatchRows(
    rows: unknown,
    externalIds: readonly string[]
): Map<string, DeviceGroupsLookup> {
    const requested = new Set(externalIds);
    const result = new Map<string, DeviceGroupsLookup>();
    if (!Array.isArray(rows)) throw invalidResponse();
    for (const row of rows) {
        const id = row?.external_id;
        if (!requested.has(id) || result.has(id)) throw invalidResponse();
        result.set(id, parseBatchRow(row));
    }
    return result;
}

function parseBatchRow(row: {
    resolved?: unknown;
    groups?: unknown;
}): DeviceGroupsLookup {
    if (row.resolved === false) return {found: false};
    if (row.resolved !== true) throw invalidResponse();
    return {found: true, groups: parseGroups(row.groups)};
}

function parseGroups(groups: unknown): DeviceGroup[] {
    if (!Array.isArray(groups)) throw invalidResponse();
    return groups.map((group) => {
        if (
            !Number.isSafeInteger(group?.id) ||
            typeof group.name !== 'string'
        ) {
            throw invalidResponse();
        }
        return {id: group.id, name: group.name};
    });
}
