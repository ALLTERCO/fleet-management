import log4js from 'log4js';
import {tuning} from '../../config';
import {assertAssetBelongsToOrg} from '../../modules/asset/assetRepository';
import {
    canCrossOrganizationBoundary,
    canPerformComponentOperation,
    hasTenantAdminAuthority,
    isComponentPermissionAllowed,
    readableResourceAllowlistsAsync
} from '../../modules/authz/evaluator';
import {demoteAllChildren} from '../../modules/BluetoothAutoPromoter';
import {BoundedMap} from '../../modules/boundedMap';
import * as Commander from '../../modules/Commander';
import * as DeviceCollector from '../../modules/DeviceCollector';
import {
    getDeviceCostCenter,
    getDeviceKind,
    listDeviceKinds,
    setDeviceKind
} from '../../modules/device/deviceKindRepository';
import {redactDeviceResponseSecrets} from '../../modules/device/deviceResponseRedaction';
import {
    type DeviceDecoration,
    decorationConflict,
    getDeviceDecoration,
    listDeviceDecorations,
    setDeviceDecoration
} from '../../modules/device/imageOverrideRepository';
import {assertDeviceKindAllowed} from '../../modules/deviceKindValidator';
import {
    getDeviceRelationships,
    queryDeviceRelationships
} from '../../modules/deviceRelationships';
import type {DeviceRelationshipPermissions} from '../../modules/deviceRelationships/types';
import {
    buildDeviceTopology,
    type DeviceSnapshot
} from '../../modules/deviceTopology';
import * as EventDistributor from '../../modules/EventDistributor';
import {
    getGroupVersion,
    invalidateGroupCache
} from '../../modules/groupVersion';
import {incrementCounter} from '../../modules/Observability';
import * as PostgresProvider from '../../modules/PostgresProvider';
import {
    getBluetoothDevice,
    listBluetoothDevices,
    listBluetoothSourceKeysByGateway
} from '../../modules/virtualDevice/bluetoothRepository';
import {
    applyExtractedSourceHealth,
    bluetoothDeviceMatchesFilter,
    bluetoothDeviceToFullJSON,
    bluetoothDeviceToListJSON,
    extractedSourceHostExternalId,
    virtualDeviceMatchesFilter,
    virtualDeviceToFullJSON,
    virtualDeviceToListJSON
} from '../../modules/virtualDevice/deviceListEntry';
import {
    bluetoothEntryToListJSON,
    bluetoothPrimaryGatewaySnapshot,
    createDeviceCollectorSnapshotFetcher,
    enrichBluetoothDeviceWithGatewayStatus,
    projectBluetoothComponentStatus,
    serializeVirtualDeviceEntry as serializeVirtualDeviceRow
} from '../../modules/virtualDevice/deviceListIntegration';
import {listExtractedSourceKeysByHost} from '../../modules/virtualDevice/extractionRepository';
import {
    buildVirtualDeviceReadModels,
    defaultReadModelDeps,
    mergeReadModelIntoRow,
    type VirtualDeviceReadModel
} from '../../modules/virtualDevice/readModel';
import {
    getVirtualDevice,
    listVirtualDevices
} from '../../modules/virtualDevice/repository';
import * as WaitingRoom from '../../modules/WaitingRoom';
import {buildRpcRequest} from '../../rpc/builders';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {ShellyDeviceExternal} from '../../types';
import {
    DEVICE_CALL_PARAMS_SCHEMA,
    DEVICE_CHECK_REPLACEMENT_PARAMS_SCHEMA,
    DEVICE_DESCRIBE,
    DEVICE_GET_SETUP_PARAMS_SCHEMA,
    DEVICE_GET_STATUS_HISTORY_PARAMS_SCHEMA,
    DEVICE_GET_STATUS_TIMELINE_PARAMS_SCHEMA,
    DEVICE_LIST_PARAMS_SCHEMA,
    DEVICE_RELATIONSHIPS_GET_PARAMS_SCHEMA,
    DEVICE_RELATIONSHIPS_QUERY_PARAMS_SCHEMA,
    DEVICE_REPLACE_HARDWARE_PARAMS_SCHEMA,
    DEVICE_SET_IMAGE_PARAMS_SCHEMA,
    DEVICE_SHELLY_ONLY_PARAMS_SCHEMA,
    DEVICE_TOPOLOGY_PARAMS_SCHEMA,
    type DeviceCallParams,
    type DeviceCheckReplacementParams,
    type DeviceGetSetupParams,
    type DeviceListParams,
    type DeviceRelationshipsGetParams,
    type DeviceRelationshipsQueryParams,
    type DeviceReplaceHardwareParams,
    type DeviceSetImageParams,
    type DeviceSetImageResult,
    type DeviceShellyOnlyParams,
    type DeviceTimeRangeParams,
    type DeviceTopologyParams
} from '../../types/api/device';
import {
    DEVICE_KIND_SET_PARAMS_SCHEMA,
    type DeviceKindSetParams
} from '../../types/api/deviceKind';
import type {
    BluetoothDeviceDto,
    VirtualDeviceDto
} from '../../types/api/virtualdevice';
import type AbstractDevice from '../AbstractDevice';
import type CommandSender from '../CommandSender';
import {checkReplacement, replaceHardware} from '../deviceReplacement';
import {methodToCrudOperation} from '../permissions';
import {canReadPolicies, canViewAuthz} from './authzPermissions';
import {bluCacheEntryFresh} from './bluCacheFreshness';
import Component from './Component';
import {
    applyFilters,
    isNonEmptyFilters,
    parseIncludeSet,
    sliceForPage
} from './deviceListHelpers';
import {canReadDeviceFieldAsync} from './entityPermissions';

const logger = log4js.getLogger('DeviceComponent');

// Short-TTL cache for filtered device lists — avoids repeating getAll() +
// filterAccessibleDevices() for each page of a chunked device.list request.
// BoundedMap gives O(1) LRU eviction + lazy TTL purge; sizing is deferred to
// first use so tuning is ready (it is not at module-load time).
let filteredDeviceCache: BoundedMap<string, AbstractDevice[]> | undefined;

function getFilteredDeviceCache(): BoundedMap<string, AbstractDevice[]> {
    if (!filteredDeviceCache) {
        filteredDeviceCache = new BoundedMap<string, AbstractDevice[]>({
            maxSize: tuning.device.filteredCacheMaxEntries,
            ttlMs: tuning.device.cacheTtlMs
        });
    }
    return filteredDeviceCache;
}

const REDIRECT_METHODS = [
    'getpending',
    'getdenied',
    'acceptpending',
    'rejectpending',
    'acceptpendingbyid',
    'acceptpendingbyexternalid'
];

function serializedByteLength(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8');
}

function snapshotForShellyID(shellyID: string) {
    const device = DeviceCollector.getDevice(shellyID);
    if (!device) return undefined;
    return {status: device.status, config: device.config};
}

interface DeviceMemberships {
    groupIds: number[];
    locationId: number | null;
    tagIds: number[];
}

const NO_MEMBERSHIPS: DeviceMemberships = {
    groupIds: [],
    locationId: null,
    tagIds: []
};

/** shellyID → memberships index. Single SQL round-trip; empty map when
 *  the caller isn't org-scoped (unauthenticated admin tools). */
async function buildDeviceMembershipIndex(
    organizationId: string | undefined,
    shellyIDs: string[]
): Promise<Map<string, DeviceMemberships>> {
    const out = new Map<string, DeviceMemberships>();
    if (!organizationId || shellyIDs.length === 0) return out;
    const rows = await PostgresProvider.listDeviceMemberships(organizationId);
    const interesting = new Set(shellyIDs);
    for (const r of rows) {
        if (!interesting.has(r.subject_id)) continue;
        out.set(r.subject_id, {
            groupIds: r.group_ids ?? [],
            locationId: r.location_id ?? null,
            tagIds: r.tag_ids ?? []
        });
    }
    return out;
}

function redirectToWaitingRoom(method: string) {
    return async (params: any, sender: CommandSender) => {
        return await Commander.exec(sender, `WaitingRoom.${method}`, params);
    };
}

function relationshipPermissions(
    sender: CommandSender
): DeviceRelationshipPermissions {
    return {
        accessGrantsRead: canReadPolicies(sender),
        actionsRead: sender.hasCrudPermission('actions', 'read'),
        alertsRead: sender.hasCrudPermission('alerts', 'read'),
        dashboardsRead: sender.hasCrudPermission('dashboards', 'read'),
        notificationsRead: sender.hasCrudPermission('notifications', 'read'),
        operationsRead: {
            backupRead: sender.hasCrudPermission('devices', 'read'),
            certificateRead: canViewAuthz(sender),
            credentialRead: canViewAuthz(sender),
            firmwareRead: sender.hasCrudPermission('devices', 'read')
        },
        reportsRead: sender.hasCrudPermission('reports', 'read'),
        securityStateRead: canViewAuthz(sender)
    };
}

/** Returns null when permission resolution fails — caller emits empty list. */
async function loadAccessibleDevices(
    sender: CommandSender,
    filters: Record<string, unknown> | undefined,
    hasFilters: boolean
): Promise<AbstractDevice[] | null> {
    const username = sender.getUser()?.username;
    // Versioned key — bypasses stale entries on any mutation.
    const orgId = sender.getOrganizationId() ?? '';
    const cacheKey = username
        ? `${username}|${orgId}|${getGroupVersion(orgId)}|${DeviceCollector.getCollectorVersion()}`
        : '__nocache__';
    const cache = getFilteredDeviceCache();

    if (!hasFilters) {
        const cached = cache.get(cacheKey);
        if (cached) return cached;
    }

    let devices: AbstractDevice[] = DeviceCollector.getAll();
    if (hasFilters && filters) devices = applyFilters(devices, filters);

    // Only provider support sees DeviceCollector unfiltered. Org admin must
    // pass through filterAccessibleDevices so cross-org devices are
    // dropped via the per-org device-id set.
    if (!canCrossOrganizationBoundary(sender)) {
        try {
            const accessibleSet = await sender.filterAccessibleDevices(
                devices.map((d) => d.shellyID)
            );
            devices = devices.filter((d) => accessibleSet.has(d.shellyID));
        } catch (e) {
            logger.error('filterAccessibleDevices failed: %s', e);
            return null;
        }
    }

    if (!hasFilters && username) {
        cache.set(cacheKey, devices);
    }
    return devices;
}

/** Narrow accessible devices to {groupId|locationId|shellyID} scope.
 *  Filters are AND'd. Empty scope = full input. */
async function scopeDevicesForTopology(
    devices: readonly AbstractDevice[],
    params: {groupId?: number; locationId?: number; shellyID?: string},
    organizationId: string | undefined
): Promise<AbstractDevice[]> {
    const {groupId, locationId, shellyID} = params;
    if (groupId === undefined && locationId === undefined && !shellyID) {
        return [...devices];
    }
    let result = [...devices];
    if (shellyID) result = result.filter((d) => d.shellyID === shellyID);
    if (groupId === undefined && locationId === undefined) return result;

    const memberships = await buildDeviceMembershipIndex(
        organizationId,
        result.map((d) => d.shellyID)
    );
    return result.filter((d) => {
        const m = memberships.get(d.shellyID);
        if (!m) return false;
        if (groupId !== undefined && !m.groupIds.includes(groupId))
            return false;
        if (locationId !== undefined && m.locationId !== locationId)
            return false;
        return true;
    });
}

type DeviceListEntry =
    | {kind: 'physical'; device: AbstractDevice}
    | {kind: 'virtual'; device: VirtualDeviceDto}
    | {kind: 'bluetooth'; device: BluetoothDeviceDto};

async function loadAccessibleVirtualDevices(
    sender: CommandSender,
    filters: Record<string, unknown> | undefined,
    hasFilters: boolean
): Promise<VirtualDeviceDto[]> {
    const orgId = sender.getOrganizationId();
    if (!orgId) return [];
    const page = await listVirtualDevices(orgId, {limit: 0});
    let devices = page.items;
    if (hasFilters && filters) {
        const structuralFilters = omitPresenceFilter(filters);
        devices = devices.filter((device) =>
            virtualDeviceMatchesFilters(device, structuralFilters)
        );
        devices = await filterVirtualDevicesByProjectedPresence(
            orgId,
            devices,
            filters.presence
        );
    }
    if (canCrossOrganizationBoundary(sender)) return devices;
    const accessible = await sender.filterAccessibleDevices(
        devices.map((device) => device.externalId)
    );
    return devices.filter((device) => accessible.has(device.externalId));
}

function virtualDeviceMatchesFilters(
    device: VirtualDeviceDto,
    filters: Record<string, unknown>
): boolean {
    for (const [key, value] of Object.entries(filters)) {
        if (!isPrimitiveFilterValue(value)) continue;
        if (!virtualDeviceMatchesFilter(device, key, value)) return false;
    }
    return true;
}

function omitPresenceFilter(
    filters: Record<string, unknown>
): Record<string, unknown> {
    const {presence: _presence, ...rest} = filters;
    return rest;
}

async function filterVirtualDevicesByProjectedPresence(
    organizationId: string,
    devices: readonly VirtualDeviceDto[],
    presence: unknown
): Promise<VirtualDeviceDto[]> {
    if (presence !== 'online' && presence !== 'offline') return [...devices];
    const readModels = await loadVirtualReadModels(organizationId, devices);
    return devices.filter((device) => {
        return (
            projectedListPresence(device, readModels.get(device.externalId)) ===
            presence
        );
    });
}

function projectedListPresence(
    device: VirtualDeviceDto,
    model: VirtualDeviceReadModel | undefined
): 'online' | 'offline' {
    if (model) return model.presence === 'online' ? 'online' : 'offline';
    return device.enabled ? 'online' : 'offline';
}

async function loadAccessibleBluetoothDevices(
    sender: CommandSender,
    filters: Record<string, unknown> | undefined,
    hasFilters: boolean
): Promise<BluetoothDeviceDto[]> {
    const orgId = sender.getOrganizationId();
    if (!orgId) return [];
    const page = await listBluetoothDevices(orgId, {limit: 0});
    let devices = page.items;
    if (hasFilters && filters) {
        devices = devices.filter((device) =>
            bluetoothDeviceMatchesFilters(device, filters)
        );
    }
    if (canCrossOrganizationBoundary(sender)) return devices;
    const accessible = await sender.filterAccessibleDevices(
        devices.map((device) => device.externalId)
    );
    return devices.filter((device) => accessible.has(device.externalId));
}

function bluetoothDeviceMatchesFilters(
    device: BluetoothDeviceDto,
    filters: Record<string, unknown>
): boolean {
    for (const [key, value] of Object.entries(filters)) {
        if (!isPrimitiveFilterValue(value)) continue;
        if (!bluetoothDeviceMatchesFilter(device, key, value)) return false;
    }
    return true;
}

function isPrimitiveFilterValue(
    value: unknown
): value is string | number | boolean {
    return ['string', 'number', 'boolean'].includes(typeof value);
}

async function serializeDeviceListEntries(
    entries: readonly DeviceListEntry[],
    organizationId: string | undefined,
    detailSet: Set<string> | undefined
): Promise<ShellyDeviceExternal[]> {
    const ids = entries.map((entry) =>
        entry.kind === 'physical'
            ? entry.device.shellyID
            : entry.device.externalId
    );
    const memberships = await buildDeviceMembershipIndex(organizationId, ids);
    const physicalIds = entries
        .filter((entry) => entry.kind === 'physical')
        .map((entry) => entry.device.shellyID);
    const [extractedHiddenKeys, bluetoothHiddenKeys, kinds, decorations] =
        await Promise.all([
            listExtractedSourceKeysByHost(organizationId, physicalIds),
            listBluetoothSourceKeysByGateway(organizationId, physicalIds),
            listDeviceKinds(physicalIds, organizationId),
            listDeviceDecorations(organizationId, physicalIds)
        ]);
    const hiddenSourceKeys = mergeHiddenComponentKeyMaps(
        extractedHiddenKeys,
        bluetoothHiddenKeys
    );
    const readModels = await loadVirtualReadModels(
        organizationId,
        entries
            .filter(
                (entry): entry is Extract<DeviceListEntry, {kind: 'virtual'}> =>
                    entry.kind === 'virtual'
            )
            .map((entry) => entry.device)
    );
    return entries.map((entry) => {
        const row =
            entry.kind === 'physical'
                ? entry.device.toListJSON(detailSet)
                : entry.kind === 'virtual'
                  ? serializeVirtualDeviceEntry(
                        entry.device,
                        detailSet,
                        readModels.get(entry.device.externalId)
                    )
                  : bluetoothEntryToListJSON(
                        DeviceCollector,
                        entry.device,
                        detailSet
                    );
        if (entry.kind === 'physical') {
            hideExtractedSourceComponents(
                row,
                hiddenSourceKeys.get(row.shellyID)
            );
            applyDeviceOverride(row, decorations.get(row.shellyID));
        }
        return redactDeviceResponseSecrets({
            ...row,
            ...(memberships.get(row.shellyID) ?? NO_MEMBERSHIPS),
            kind:
                entry.kind === 'physical'
                    ? (kinds.get(row.shellyID) ?? null)
                    : null
        });
    });
}

// Merge the per-device visual override into the slim list row so device
// cards render a custom image or colored icon. Copies info so the override
// never mutates the device's shared in-memory #info.
function applyDeviceOverride(
    row: {
        info?: {
            imageAssetId?: string | null;
            icon?: string;
            accent?: string;
        } | null;
    },
    decoration: DeviceDecoration | undefined
): void {
    if (!decoration || !row.info) return;
    row.info = {
        ...row.info,
        imageAssetId: decoration.imageAssetId,
        ...(decoration.icon ? {icon: decoration.icon} : {}),
        ...(decoration.accent ? {accent: decoration.accent} : {})
    };
}

function mergeHiddenComponentKeyMaps(
    first: Map<string, Set<string>>,
    second: Map<string, Set<string>>
): Map<string, Set<string>> {
    if (first.size === 0) return second;
    if (second.size === 0) return first;
    const merged = new Map(first);
    for (const [externalId, keys] of second) {
        const target = merged.get(externalId) ?? new Set<string>();
        for (const key of keys) target.add(key);
        merged.set(externalId, target);
    }
    return merged;
}

function serializeVirtualDeviceEntry(
    device: VirtualDeviceDto,
    detailSet: Set<string> | undefined,
    readModel: VirtualDeviceReadModel | undefined
): ShellyDeviceExternal {
    const hostExternalId = extractedSourceHostExternalId(device);
    const host = hostExternalId
        ? DeviceCollector.getDevice(hostExternalId)
        : null;
    return serializeVirtualDeviceRow({
        device,
        detailSet,
        readModel,
        hostPresence: host?.presence ?? null
    });
}

async function loadVirtualReadModels(
    organizationId: string | undefined,
    devices: readonly VirtualDeviceDto[]
): Promise<Map<string, VirtualDeviceReadModel>> {
    if (!organizationId || devices.length === 0) return new Map();
    const bluCache = await loadBluetoothCacheForOrg(organizationId);
    return buildVirtualDeviceReadModels(
        {organizationId, devices},
        {
            ...defaultReadModelDeps,
            getSourceSnapshot: createDeviceCollectorSnapshotFetcher(
                DeviceCollector,
                (externalId) => bluCache.get(externalId)
            )
        }
    );
}

const BLU_CACHE_TTL_MS = 5_000;
// Insertion-ordered LRU: Map iteration order is insertion order, so the
// oldest entry is keys().next() and re-insertion refreshes recency.
interface BluCacheEntry {
    expiresAt: number;
    // Bluetooth-inventory version at fetch time — a promote/demote/delete busts
    // the entry immediately, not after the TTL.
    version: number;
    data: Map<string, BluetoothDeviceDto>;
}
const bluCacheByOrg = new Map<string, BluCacheEntry>();

async function loadBluetoothCacheForOrg(
    organizationId: string
): Promise<Map<string, BluetoothDeviceDto>> {
    const fresh = readFreshBluCache(organizationId);
    if (fresh) return fresh;
    const entry = await fetchBluCacheEntry(organizationId);
    storeBluCacheEntry(organizationId, entry);
    evictOldestBluCache();
    return entry.data;
}

function readFreshBluCache(
    organizationId: string
): Map<string, BluetoothDeviceDto> | null {
    const hit = bluCacheByOrg.get(organizationId);
    if (
        !hit ||
        !bluCacheEntryFresh(
            hit,
            Date.now(),
            EventDistributor.getBluetoothInventoryVersion()
        )
    ) {
        return null;
    }
    bluCacheByOrg.delete(organizationId);
    bluCacheByOrg.set(organizationId, hit);
    return hit.data;
}

async function fetchBluCacheEntry(
    organizationId: string
): Promise<BluCacheEntry> {
    const data = new Map<string, BluetoothDeviceDto>();
    const version = EventDistributor.getBluetoothInventoryVersion();
    const page = await listBluetoothDevices(organizationId, {limit: 0});
    for (const blu of page.items) data.set(blu.externalId, blu);
    return {expiresAt: Date.now() + BLU_CACHE_TTL_MS, version, data};
}

function storeBluCacheEntry(
    organizationId: string,
    entry: BluCacheEntry
): void {
    bluCacheByOrg.delete(organizationId);
    bluCacheByOrg.set(organizationId, entry);
}

function evictOldestBluCache(): void {
    while (bluCacheByOrg.size > tuning.virtualDevice.bluCacheMaxOrgs) {
        const oldest = bluCacheByOrg.keys().next().value;
        if (oldest === undefined) return;
        bluCacheByOrg.delete(oldest);
    }
}

async function loadStoredDeviceForGet(
    organizationId: string | undefined,
    shellyID: string
): Promise<ShellyDeviceExternal | null> {
    if (!organizationId) return null;
    const virtualDevice = await getVirtualDevice(organizationId, shellyID);
    if (virtualDevice) {
        const readModels = await loadVirtualReadModels(organizationId, [
            virtualDevice
        ]);
        const baseRow = virtualDeviceToFullJSON(virtualDevice);
        const enriched =
            readModels.get(virtualDevice.externalId) === undefined
                ? baseRow
                : mergeReadModelIntoRow(
                      baseRow,
                      readModels.get(virtualDevice.externalId)!
                  );
        return withMemberships(
            applyStoredVirtualDeviceHealth(enriched, virtualDevice),
            organizationId
        );
    }
    const bluetoothDevice = await getBluetoothDevice(organizationId, shellyID);
    if (bluetoothDevice) {
        const gateway = bluetoothPrimaryGatewaySnapshot(
            DeviceCollector,
            bluetoothDevice
        );
        const enrichedBluetoothDevice = enrichBluetoothDeviceWithGatewayStatus(
            bluetoothDevice,
            gateway
        );
        return withMemberships(
            bluetoothDeviceToFullJSON(
                enrichedBluetoothDevice,
                gateway?.presence ?? null,
                projectBluetoothComponentStatus({
                    device: enrichedBluetoothDevice,
                    gateway
                })
            ),
            organizationId
        );
    }
    return null;
}

function applyStoredVirtualDeviceHealth(
    row: ShellyDeviceExternal,
    device: VirtualDeviceDto
): ShellyDeviceExternal {
    const hostExternalId = extractedSourceHostExternalId(device);
    if (!hostExternalId) return row;
    const host = DeviceCollector.getDevice(hostExternalId);
    return applyExtractedSourceHealth(row, host?.presence ?? null);
}

async function withMemberships(
    row: ShellyDeviceExternal,
    organizationId: string
): Promise<ShellyDeviceExternal> {
    const memberships = await buildDeviceMembershipIndex(organizationId, [
        row.shellyID
    ]);
    return {
        ...row,
        ...(memberships.get(row.shellyID) ?? NO_MEMBERSHIPS)
    };
}

function hideExtractedSourceComponents(
    row: ShellyDeviceExternal,
    hiddenKeys: Set<string> | undefined
): void {
    if (!hiddenKeys || hiddenKeys.size === 0) return;
    for (const key of hiddenKeys) {
        delete row.status?.[key];
        delete row.settings?.[key];
    }
    if (!Array.isArray(row.entities)) return;
    const hiddenEntityIds = new Set(
        [...hiddenKeys].map((key) => sourceKeyToEntityId(row, key))
    );
    row.entities = row.entities.filter((entityId) => {
        return typeof entityId !== 'string' || !hiddenEntityIds.has(entityId);
    });
}

function sourceKeyToEntityId(row: ShellyDeviceExternal, key: string): string {
    const [type, id] = key.split(':');
    if (type === 'service') return `${row.shellyID}_${id}:service`;
    return `${row.id}_${id}:${type}`;
}

// Validate a device kind; on rejection, count it before rethrowing so the
// caller's happy path stays free of error-handling noise.
async function rejectInvalidDeviceKind(
    kind: string | null,
    organizationId: string
): Promise<void> {
    try {
        await assertDeviceKindAllowed(kind, organizationId);
    } catch (err) {
        incrementCounter('fm_device_kind_invalid_rejected');
        throw err;
    }
}

const STATUS_RANGE_FIELD = /^[a-zA-Z][\w:.-]*$/i;
const STATUS_RANGE_MAX_MS = 24 * 60 * 60 * 1000;

interface ResolvedStatusRange {
    shellyID: string;
    field: string;
    internalIds: number[];
    fromDate: Date;
    toDate: Date;
}

// Shared validation + id resolution for timeline and history reads.
async function resolveStatusRange(
    params: DeviceTimeRangeParams
): Promise<ResolvedStatusRange> {
    const {shellyID, field, from, to} = params;
    if (!STATUS_RANGE_FIELD.test(field)) {
        throw RpcError.InvalidParams('field contains invalid characters');
    }
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
        throw RpcError.InvalidParams(
            'from and to must be valid ISO date strings'
        );
    }
    if (toDate <= fromDate) {
        throw RpcError.InvalidParams('to must be after from');
    }
    if (toDate.getTime() - fromDate.getTime() > STATUS_RANGE_MAX_MS) {
        fromDate.setTime(toDate.getTime() - STATUS_RANGE_MAX_MS);
    }
    const {internalIds} = await PostgresProvider.resolveDeviceIds([shellyID]);
    return {shellyID, field, internalIds, fromDate, toDate};
}

// Empty success shape when shellyID resolves to no internal ids.
function emptyStatusRangeResponse(range: ResolvedStatusRange) {
    return {
        shellyID: range.shellyID,
        field: range.field,
        data: [] as never[],
        from: range.fromDate.toISOString(),
        to: range.toDate.toISOString()
    };
}

export default class DeviceComponent extends Component<any> {
    constructor() {
        super('device', {viewer_visible: true});

        // Setup waiting room redirects
        // Permission checks must be against 'waiting_room' component,
        // not 'devices', since these methods redirect to WaitingRoomComponent.
        // noAudit on all redirects — the inner WaitingRoom.* call is the
        // canonical audit point, so outer+inner would otherwise double-log.
        for (const method of REDIRECT_METHODS) {
            this.addMethod(method, redirectToWaitingRoom(method), {
                noAudit: true,
                checkPermissions: (sender: CommandSender) => {
                    if (hasTenantAdminAuthority(sender)) return true;
                    const operation = methodToCrudOperation(method);
                    if (!operation) return sender.canWrite();
                    return isComponentPermissionAllowed(
                        canPerformComponentOperation(
                            sender,
                            'waiting_room',
                            operation
                        )
                    );
                }
            });
        }
    }

    override getStatus(params?: any): Record<string, any> {
        const len = Object.keys(params ?? {}).length;
        if (len === 0 || typeof params.id !== 'string') {
            const keys = Array.from(DeviceCollector.getAllShellyIDs());
            return {devices_size: keys.length, devices: keys};
        }
        const device = DeviceCollector.getDevice(params.id);
        if (device) return device.status;
        return {};
    }

    override getConfig(params?: any) {
        if (typeof params?.id === 'string') {
            const device = DeviceCollector.getDevice(params.id);
            if (device) return device.config;
        }
        return {};
    }

    // Sender-aware variants — register as the actual RPC methods in
    // addDefaultMethods so the base sync signature stays intact for
    // every non-WS caller (PluginLoader, AlexaComponent override, etc).
    async #getStatusForSender(
        params: any,
        sender: CommandSender
    ): Promise<Record<string, any>> {
        if (typeof params?.id === 'string') {
            const device = DeviceCollector.getDevice(params.id);
            if (!device) return {};
            if (!(await canReadDeviceFieldAsync(sender, params.id))) {
                return {};
            }
            return device.status;
        }
        const all = Array.from(DeviceCollector.getAllShellyIDs());
        const keys = canCrossOrganizationBoundary(sender)
            ? all
            : Array.from(await sender.filterAccessibleDevices(all));
        return {devices_size: keys.length, devices: keys};
    }

    async #getConfigForSender(
        params: any,
        sender: CommandSender
    ): Promise<Record<string, any>> {
        if (typeof params?.id !== 'string') return {};
        const device = DeviceCollector.getDevice(params.id);
        if (!device) return {};
        if (!(await canReadDeviceFieldAsync(sender, params.id))) {
            return {};
        }
        return device.config;
    }

    protected override configureDefaultReadMethods(): void {
        this.replaceDefaultReadMethods({
            getStatus: (params, sender) =>
                this.#getStatusForSender(params, sender),
            getConfig: (params, sender) =>
                this.#getConfigForSender(params, sender)
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return DEVICE_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('Topology')
    @Component.CrudPermission('devices', 'read')
    async topology(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<DeviceTopologyParams>(
            rawParams ?? {},
            DEVICE_TOPOLOGY_PARAMS_SCHEMA
        );
        const devices = await loadAccessibleDevices(sender, undefined, false);
        if (devices === null) return {nodes: [], edges: []};

        const scoped = await scopeDevicesForTopology(
            devices,
            params,
            sender.getOrganizationId()
        );
        if (scoped.length === 0) return {nodes: [], edges: []};

        const snapshots: DeviceSnapshot[] = scoped.map((device) => {
            const config = device.config ?? {};
            const bthomeDevices: Record<
                string,
                {addr?: string; name?: string | null}
            > = {};
            const thermostats: Record<string, {actuator?: string}> = {};
            for (const [key, cfg] of Object.entries(config)) {
                if (!cfg || typeof cfg !== 'object') continue;
                if (key.startsWith('bthomedevice:')) {
                    const c = cfg as {addr?: unknown; name?: unknown};
                    bthomeDevices[key] = {
                        addr: typeof c.addr === 'string' ? c.addr : undefined,
                        name: typeof c.name === 'string' ? c.name : null
                    };
                } else if (key.startsWith('thermostat:')) {
                    const c = cfg as {actuator?: unknown};
                    thermostats[key] = {
                        actuator:
                            typeof c.actuator === 'string'
                                ? c.actuator
                                : undefined
                    };
                }
            }
            return {
                shellyID: device.shellyID,
                name: (device.info as {name?: string | null})?.name ?? null,
                presence: device.presence,
                bthomeDevices,
                thermostats
            };
        });

        return buildDeviceTopology(snapshots);
    }

    @Component.NoAudit
    @Component.Expose('Relationships.Get')
    @Component.CrudPermission('devices', 'read', (params) => params?.shellyID)
    async relationshipsGet(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<DeviceRelationshipsGetParams>(
            rawParams ?? {},
            DEVICE_RELATIONSHIPS_GET_PARAMS_SCHEMA
        );
        return await getDeviceRelationships({
            organizationId: sender.getOrganizationId(),
            params,
            filterAccessibleDevices: (externalIds) =>
                sender.filterAccessibleDevices([...externalIds]),
            readableResources: await readableResourceAllowlistsAsync(sender),
            permissions: relationshipPermissions(sender)
        });
    }

    @Component.NoAudit
    @Component.Expose('Relationships.Query')
    @Component.CrudPermission('devices', 'read')
    async relationshipsQuery(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<DeviceRelationshipsQueryParams>(
            rawParams ?? {},
            DEVICE_RELATIONSHIPS_QUERY_PARAMS_SCHEMA
        );
        return await queryDeviceRelationships({
            organizationId: sender.getOrganizationId(),
            params,
            filterAccessibleDevices: (externalIds) =>
                sender.filterAccessibleDevices([...externalIds]),
            readableResources: await readableResourceAllowlistsAsync(sender),
            permissions: relationshipPermissions(sender)
        });
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.NoPermissions
    async list(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<DeviceListParams>(
            rawParams ?? {},
            DEVICE_LIST_PARAMS_SCHEMA
        );
        const filters = params.filters;
        const hasFilters = isNonEmptyFilters(filters);

        const devices = await loadAccessibleDevices(
            sender,
            filters,
            hasFilters
        );
        if (devices === null) return buildListResponse([], 0, 0, 0);

        const virtualDevices = await loadAccessibleVirtualDevices(
            sender,
            filters,
            hasFilters
        );
        const bluetoothDevices = await loadAccessibleBluetoothDevices(
            sender,
            filters,
            hasFilters
        );
        const entries: DeviceListEntry[] = [
            ...devices.map((device) => ({kind: 'physical' as const, device})),
            ...virtualDevices.map((device) => ({
                kind: 'virtual' as const,
                device
            })),
            ...bluetoothDevices.map((device) => ({
                kind: 'bluetooth' as const,
                device
            }))
        ];
        const total = entries.length;
        const {sliced, rawLimit, offset} = sliceForPage(
            entries,
            total,
            params.limit,
            params.offset,
            tuning.device.listDbPageMax
        );
        const detailSet = parseIncludeSet(params.include);
        const rows = await serializeDeviceListEntries(
            sliced,
            sender.getOrganizationId(),
            detailSet
        );
        return buildListResponse(rows, total, rawLimit, offset);
    }

    @Component.NoAudit
    @Component.Expose('GetInfo')
    @Component.CrudPermission('devices', 'read', (params) => params?.shellyID)
    async getInfo(rawParams: unknown, sender: CommandSender) {
        const {shellyID} = validateOrThrow<DeviceShellyOnlyParams>(
            rawParams,
            DEVICE_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = DeviceCollector.getDevice(shellyID);
        if (device) return {...device.info, shellyID};
        const orgId = sender.getOrganizationId();
        if (orgId) {
            const virtualDevice = await getVirtualDevice(orgId, shellyID);
            if (virtualDevice) {
                return virtualDeviceToListJSON(virtualDevice).info;
            }
            const bluetoothDevice = await getBluetoothDevice(orgId, shellyID);
            if (bluetoothDevice) {
                return bluetoothDeviceToListJSON(bluetoothDevice).info;
            }
        }
        return {};
    }

    @Component.Expose('GetSetup')
    @Component.CrudPermission('devices', 'read', (params) => params?.shellyID)
    async getSetup(rawParams: unknown, sender: CommandSender) {
        const {mode = 'json'} = validateOrThrow<DeviceGetSetupParams>(
            rawParams,
            DEVICE_GET_SETUP_PARAMS_SCHEMA
        );

        // Also requires configurations.read to access config profiles
        if (
            !hasTenantAdminAuthority(sender) &&
            !sender.hasCrudPermission('configurations', 'read')
        ) {
            throw RpcError.InvalidRequest(
                'No read permission on configurations'
            );
        }

        const setup: Record<
            string,
            Record<string, any>
        > = await Commander.execInternal('Storage.GetAll', {
            registry: 'configs'
        });

        if (mode === 'rpc') {
            let id = 1000;
            const rpcs: Record<string, Record<string, string[]>> = {};
            for (const profile in setup) {
                if (rpcs[profile] === undefined) {
                    rpcs[profile] = {};
                }
                for (const configName in setup[profile]) {
                    for (const key in setup[profile][configName]) {
                        const stringReq = JSON.stringify(
                            buildRpcRequest(id++, `${key}.setconfig`, {
                                config: setup[profile][configName][key]
                            })
                        );

                        if (rpcs[profile][configName] === undefined) {
                            rpcs[profile][configName] = [];
                        }

                        rpcs[profile][configName].push(stringReq);
                    }
                }
            }
            return rpcs;
        }
        return setup;
    }

    @Component.Expose('Call')
    @Component.CrudPermission(
        'devices',
        'execute',
        (params) => params?.shellyID
    )
    async directCall(rawParams: unknown) {
        const params = validateOrThrow<DeviceCallParams>(
            rawParams,
            DEVICE_CALL_PARAMS_SCHEMA
        );
        if (params.method.length > tuning.device.callMaxMethodLength) {
            throw RpcError.InvalidParams(
                `method must be at most ${tuning.device.callMaxMethodLength} characters`
            );
        }
        if (
            serializedByteLength(params.params) >
            tuning.device.callMaxParamsBytes
        ) {
            throw RpcError.InvalidParams(
                `params must be at most ${tuning.device.callMaxParamsBytes} bytes when serialized`
            );
        }

        const device = DeviceCollector.getDevice(params.shellyID);
        if (!device) {
            throw RpcError.DeviceNotFound();
        }

        return await device.sendRPC(params.method, params.params);
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CrudPermission('devices', 'read', (params) => params?.shellyID)
    async get(rawParams: unknown, sender: CommandSender) {
        const {shellyID} = validateOrThrow<DeviceShellyOnlyParams>(
            rawParams,
            DEVICE_SHELLY_ONLY_PARAMS_SCHEMA
        );

        const orgId = sender.getOrganizationId();

        const device = DeviceCollector.getDevice(shellyID);
        if (!device) {
            const storedDevice = await loadStoredDeviceForGet(orgId, shellyID);
            if (!storedDevice) throw RpcError.DeviceNotFound();
            const [kindStored, costCenter] = await Promise.all([
                getDeviceKind(shellyID, orgId),
                getDeviceCostCenter(shellyID, orgId)
            ]);
            return redactDeviceResponseSecrets({
                ...storedDevice,
                costCenter,
                kind: kindStored
            });
        }

        const [memberships, kind, costCenter] = await Promise.all([
            buildDeviceMembershipIndex(orgId, [shellyID]),
            getDeviceKind(shellyID, orgId),
            getDeviceCostCenter(shellyID, orgId)
        ]);
        return redactDeviceResponseSecrets({
            ...device.toJSON(),
            ...(memberships.get(shellyID) ?? NO_MEMBERSHIPS),
            costCenter,
            kind
        });
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'delete')
    async delete(rawParams: unknown, sender: CommandSender) {
        const {shellyID} = validateOrThrow<DeviceShellyOnlyParams>(
            rawParams,
            DEVICE_SHELLY_ONLY_PARAMS_SCHEMA
        );

        const rec = await PostgresProvider.accessControl(shellyID);
        if (!rec?.id) {
            throw RpcError.InvalidParams(
                `Could not resolve internal id for ${shellyID}`
            );
        }

        await WaitingRoom.denyDevice(rec.id, sender.getUser()?.username);
        // Demote this gateway's promoted BLU children first, so deleting it
        // can't leave them as orphaned "online" ghost devices.
        await demoteAllChildren(shellyID);
        await PostgresProvider.deviceDelete(shellyID);
        // Bump group version so cached accessible-device sets drop the row.
        const orgId = sender.getOrganizationId();
        if (orgId) {
            invalidateGroupCache(orgId);
            EventDistributor.emitDeviceDeleted({
                externalId: shellyID,
                source: 'physical',
                orgId
            });
        }
        return {deleted: shellyID};
    }

    @Component.NoAudit
    @Component.Expose('CheckReplacement')
    @Component.CrudPermission('devices', 'read')
    async checkReplacement(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<DeviceCheckReplacementParams>(
            rawParams,
            DEVICE_CHECK_REPLACEMENT_PARAMS_SCHEMA
        );
        const orgId = sender.getOrganizationId();
        if (!orgId) throw RpcError.Unauthorized();
        return await checkReplacement({
            organizationId: orgId,
            oldShellyID: params.oldShellyID,
            newShellyID: params.newShellyID,
            snapshotForShellyID
        });
    }

    @Component.Expose('ReplaceHardware')
    @Component.CrudPermission('devices', 'update')
    async replaceHardware(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<DeviceReplaceHardwareParams>(
            rawParams,
            DEVICE_REPLACE_HARDWARE_PARAMS_SCHEMA
        );
        const orgId = sender.getOrganizationId();
        if (!orgId) throw RpcError.Unauthorized();
        try {
            return await replaceHardware({
                organizationId: orgId,
                oldShellyID: params.oldShellyID,
                newShellyID: params.newShellyID,
                confirmedMapping: params.confirmedMapping,
                confirmedBy: sender.getUser()?.username ?? null,
                snapshotForShellyID
            });
        } catch (err) {
            throw RpcError.InvalidParams((err as Error).message);
        }
    }

    @Component.Expose('GetKind')
    @Component.CrudPermission('devices', 'read', (params) => params?.shellyID)
    async getKind(rawParams: unknown, sender: CommandSender) {
        const {shellyID} = validateOrThrow<DeviceShellyOnlyParams>(
            rawParams,
            DEVICE_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const orgId = sender.getOrganizationId();
        const [kind, costCenter] = await Promise.all([
            getDeviceKind(shellyID, orgId),
            getDeviceCostCenter(shellyID, orgId)
        ]);
        return {shellyID, kind, costCenter};
    }

    @Component.Expose('SetKind')
    @Component.CrudPermission('devices', 'update', (params) => params?.shellyID)
    async setKind(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<DeviceKindSetParams>(
            rawParams,
            DEVICE_KIND_SET_PARAMS_SCHEMA
        );
        const orgId = sender.getOrganizationId();
        if (!orgId) throw RpcError.Unauthorized();
        await rejectInvalidDeviceKind(params.kind, orgId);
        const found = await setDeviceKind({
            shellyID: params.shellyID,
            kind: params.kind,
            costCenter: params.costCenter,
            organizationId: orgId
        });
        if (!found) {
            throw RpcError.NotFound('Device', params.shellyID);
        }
        incrementCounter('fm_device_kind_set');
        return {shellyID: params.shellyID, kind: params.kind};
    }

    @Component.Expose('SetImage')
    @Component.CrudPermission('devices', 'update', (params) => params?.shellyID)
    async setImage(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<DeviceSetImageResult> {
        const params = validateOrThrow<DeviceSetImageParams>(
            rawParams,
            DEVICE_SET_IMAGE_PARAMS_SCHEMA
        );
        const orgId = sender.getOrganizationId();
        if (!orgId) throw RpcError.Unauthorized();
        const requested: DeviceDecoration = {
            imageAssetId: params.imageAssetId,
            icon: params.icon ?? null,
            accent: params.accent ?? null
        };
        const conflict = decorationConflict(requested);
        if (conflict) throw RpcError.InvalidParams(conflict);
        await assertAssetBelongsToOrg(orgId, requested.imageAssetId);
        const decoration = await setDeviceDecoration({
            organizationId: orgId,
            shellyID: params.shellyID,
            decoration: requested
        });
        if (!decoration) throw RpcError.Domain('ResourceNotFound');
        return {shellyID: params.shellyID, ...decoration};
    }

    @Component.NoAudit
    @Component.Expose('GetImage')
    @Component.CrudPermission('devices', 'read', (params) => params?.shellyID)
    async getImage(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<DeviceSetImageResult> {
        const {shellyID} = validateOrThrow<DeviceShellyOnlyParams>(
            rawParams,
            DEVICE_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const orgId = sender.getOrganizationId();
        if (!orgId) throw RpcError.Unauthorized();
        const decoration = await getDeviceDecoration(orgId, shellyID);
        return {shellyID, ...decoration};
    }

    @Component.NoAudit
    @Component.Expose('GetDeviceChannels')
    @Component.CrudPermission('devices', 'read', (params) => params?.shellyID)
    getDeviceChannels(rawParams: unknown) {
        const {shellyID} = validateOrThrow<DeviceShellyOnlyParams>(
            rawParams,
            DEVICE_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = DeviceCollector.getDevice(shellyID);
        if (!device) return {emChannels: [], em1Channels: []};

        const status = device.status || {};
        const emChannels: {
            channel: number;
            act_power: number | null;
            voltage: number | null;
            current: number | null;
        }[] = [];
        const em1Channels: {
            channel: number;
            act_power: number | null;
            voltage: number | null;
            current: number | null;
        }[] = [];

        for (let i = 0; i < 5; i++) {
            const em = status[`em:${i}`];
            if (em) {
                emChannels.push({
                    channel: i,
                    act_power:
                        typeof em.act_power === 'number' ? em.act_power : null,
                    voltage: typeof em.voltage === 'number' ? em.voltage : null,
                    current: typeof em.current === 'number' ? em.current : null
                });
            }
            const em1 = status[`em1:${i}`];
            if (em1) {
                em1Channels.push({
                    channel: i,
                    act_power:
                        typeof em1.act_power === 'number'
                            ? em1.act_power
                            : null,
                    voltage:
                        typeof em1.voltage === 'number' ? em1.voltage : null,
                    current:
                        typeof em1.current === 'number' ? em1.current : null
                });
            }
        }
        return {emChannels, em1Channels};
    }

    @Component.NoAudit
    @Component.Expose('GetStatusTimeline')
    @Component.CrudPermission('devices', 'read', (params) => params?.shellyID)
    async getStatusTimeline(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<DeviceTimeRangeParams>(
            rawParams,
            DEVICE_GET_STATUS_TIMELINE_PARAMS_SCHEMA
        );
        const range = await resolveStatusRange(params);
        if (range.internalIds.length === 0) {
            return emptyStatusRangeResponse(range);
        }
        // Let errors propagate — a DB outage must surface, not read as "no data".
        const res = await PostgresProvider.callMethod(
            'device.fn_status_timeline',
            {
                p_organization_id: sender.getOrganizationId() ?? null,
                p_device_ids: range.internalIds,
                p_field: range.field,
                p_from: range.fromDate.toISOString(),
                p_to: range.toDate.toISOString()
            }
        );
        const data = (res?.rows || []).map((r: any) => ({
            ts: r.ts,
            value: r.value != null ? +r.value : null,
            prevValue: r.prev_value != null ? +r.prev_value : null
        }));
        return {
            shellyID: range.shellyID,
            field: range.field,
            data,
            from: range.fromDate.toISOString(),
            to: range.toDate.toISOString()
        };
    }

    @Component.NoAudit
    @Component.Expose('GetStatusHistory')
    @Component.CrudPermission('devices', 'read', (params) => params?.shellyID)
    async getStatusHistory(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<DeviceTimeRangeParams>(
            rawParams,
            DEVICE_GET_STATUS_HISTORY_PARAMS_SCHEMA
        );
        const range = await resolveStatusRange(params);
        if (range.internalIds.length === 0) {
            return emptyStatusRangeResponse(range);
        }
        // Let errors propagate — a DB outage must surface, not read as "no data".
        const res = await PostgresProvider.callMethod(
            'device.fn_status_chart',
            {
                p_organization_id: sender.getOrganizationId() ?? null,
                p_device_ids: range.internalIds,
                p_field: range.field,
                p_from: range.fromDate.toISOString(),
                p_to: range.toDate.toISOString(),
                p_granularity: 'hour'
            }
        );
        // Aggregate across device IDs: average the avg, min of mins, max of maxes.
        // A single shellyID can resolve to multiple internal IDs (e.g. after migration),
        // which would produce interleaved duplicate bucket rows without this step.
        const bucketMap = new Map<
            string,
            {
                sumAvg: number;
                count: number;
                min: number | null;
                max: number | null;
            }
        >();
        for (const r of res?.rows || []) {
            const key =
                r.bucket instanceof Date
                    ? r.bucket.toISOString()
                    : String(r.bucket);
            const avg = r.avg_val != null ? +r.avg_val : null;
            const min = r.min_val != null ? +r.min_val : null;
            const max = r.max_val != null ? +r.max_val : null;
            const entry = bucketMap.get(key);
            if (!entry) {
                bucketMap.set(key, {
                    sumAvg: avg ?? 0,
                    count: avg != null ? 1 : 0,
                    min,
                    max
                });
            } else {
                if (avg != null) {
                    entry.sumAvg += avg;
                    entry.count++;
                }
                if (min != null)
                    entry.min =
                        entry.min != null ? Math.min(entry.min, min) : min;
                if (max != null)
                    entry.max =
                        entry.max != null ? Math.max(entry.max, max) : max;
            }
        }
        const data = Array.from(bucketMap.entries())
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([bucket, agg]) => ({
                bucket,
                avgVal: agg.count > 0 ? agg.sumAvg / agg.count : null,
                minVal: agg.min,
                maxVal: agg.max
            }));
        return {
            shellyID: range.shellyID,
            field: range.field,
            data,
            from: range.fromDate.toISOString(),
            to: range.toDate.toISOString()
        };
    }

    protected override getDefaultConfig() {
        return {};
    }
}
