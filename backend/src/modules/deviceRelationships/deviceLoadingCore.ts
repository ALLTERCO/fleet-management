import type {ShellyDeviceExternal} from '../../types';
import type {DeviceRelationshipInclude} from '../../types/api/device';
import type {
    BluetoothDeviceDto,
    VirtualDeviceDto,
    VirtualDeviceProfileDto
} from '../../types/api/virtualdevice';
import * as DeviceCollector from '../DeviceCollector';
import * as postgres from '../PostgresProvider';
import {listBluetoothDevices} from '../virtualDevice/bluetoothRepository';
import {getProfileById} from '../virtualDevice/profileRepository';
import {listVirtualDevices} from '../virtualDevice/repository';
import {
    filterAccessibleExternalIds,
    readRecord,
    stringArray,
    stringValue
} from './relationshipShared';
import type {
    BluetoothTransportRelationshipRow,
    OrganizationRelationshipLoadInput,
    RelationshipLoadInput,
    VirtualBindingRow,
    VirtualProfileRoleFact
} from './relationshipTypes';
import type {
    RelationshipDeviceFact,
    RelationshipVirtualBindingFact
} from './types';

export async function loadBluetoothDevices(
    input: OrganizationRelationshipLoadInput
): Promise<BluetoothDeviceDto[]> {
    if (!input.cache) {
        const page = await listBluetoothDevices(input.organizationId, {
            limit: 0
        });
        return page.items;
    }
    input.cache.bluetoothDevices ??= listBluetoothDevices(
        input.organizationId,
        {limit: 0}
    ).then((page) => page.items);
    return await input.cache.bluetoothDevices;
}

export async function loadVirtualDevices(
    input: OrganizationRelationshipLoadInput
): Promise<VirtualDeviceDto[]> {
    if (!input.cache) {
        const page = await listVirtualDevices(input.organizationId, {limit: 0});
        return page.items;
    }
    input.cache.virtualDevices ??= listVirtualDevices(input.organizationId, {
        limit: 0
    }).then((page) => page.items);
    return await input.cache.virtualDevices;
}

export async function loadVirtualBindingRows(
    input: OrganizationRelationshipLoadInput
): Promise<VirtualBindingRow[]> {
    if (!input.cache) return await queryVirtualBindingRows(input);
    input.cache.virtualBindingRows ??= queryVirtualBindingRows(input);
    return await input.cache.virtualBindingRows;
}

async function queryVirtualBindingRows(
    input: OrganizationRelationshipLoadInput
): Promise<VirtualBindingRow[]> {
    return await postgres.queryRows<VirtualBindingRow>(
        `SELECT
            virtual_dl.external_id AS virtual_external_id,
            vd.kind AS virtual_kind,
            b.role_key,
            source_dl.external_id AS source_external_id,
            b.source_component_key,
            b.mode,
            b.value_type,
            b.writable,
            b.required,
            b.unit,
            b.role_metadata_json
           FROM device.virtual_device_binding b
           JOIN device.virtual_device vd
             ON vd.device_list_id = b.virtual_device_list_id
            AND vd.organization_id = b.organization_id
            AND vd.deleted_at IS NULL
           JOIN device.list virtual_dl
             ON virtual_dl.id = b.virtual_device_list_id
            AND virtual_dl.organization_id = b.organization_id
           JOIN device.list source_dl
             ON source_dl.id = b.source_device_list_id
            AND source_dl.organization_id = b.organization_id
          WHERE b.organization_id = $1
            AND b.effective_to IS NULL
            AND b.effective_from <= NOW()
            AND (
                virtual_dl.external_id = $2
                OR source_dl.external_id = $2
            )
          ORDER BY virtual_dl.external_id, b.role_key`,
        [input.organizationId, input.centerExternalId]
    );
}

export function dedupeVirtualRoles(
    rows: readonly VirtualBindingRow[]
): VirtualBindingRow[] {
    const seen = new Set<string>();
    return rows.filter((row) => {
        const key = `${row.virtual_external_id}:${row.role_key}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export async function loadProfileVirtualRoleFacts(
    input: OrganizationRelationshipLoadInput
): Promise<VirtualProfileRoleFact[]> {
    if (!input.cache) return await queryProfileVirtualRoleFacts(input);
    input.cache.virtualProfileRoleFacts ??= queryProfileVirtualRoleFacts(input);
    return await input.cache.virtualProfileRoleFacts;
}

async function queryProfileVirtualRoleFacts(
    input: OrganizationRelationshipLoadInput
): Promise<VirtualProfileRoleFact[]> {
    const devices = await relatedProfileVirtualDevices(input);
    const profiles = await loadVirtualProfilesById({
        organizationId: input.organizationId,
        profileIds: devices.map((device) => device.profileId)
    });
    return devices.flatMap((device) =>
        profileRoleFacts({
            device,
            profile: profiles.get(device.profileId)
        })
    );
}

async function relatedProfileVirtualDevices(
    input: OrganizationRelationshipLoadInput
): Promise<Array<VirtualDeviceDto & {profileId: string}>> {
    const [devices, relatedIds] = await Promise.all([
        loadVirtualDevices(input),
        relatedVirtualExternalIds(input)
    ]);
    const visibleIds = await filterAccessibleExternalIds(input, relatedIds);
    return devices
        .filter((device) => relatedIds.has(device.externalId))
        .filter(
            (device) =>
                device.externalId === input.centerExternalId ||
                visibleIds.has(device.externalId)
        )
        .filter(hasProfileId);
}

function hasProfileId(
    device: VirtualDeviceDto
): device is VirtualDeviceDto & {profileId: string} {
    return typeof device.profileId === 'string' && device.profileId.length > 0;
}

async function loadVirtualProfilesById(input: {
    organizationId: string;
    profileIds: readonly string[];
}): Promise<Map<string, VirtualDeviceProfileDto>> {
    const ids = uniqueProfileIds(input.profileIds);
    const profiles = await Promise.all(
        ids.map((id) => getProfileById(input.organizationId, id))
    );
    return profileMap(ids, profiles);
}

function uniqueProfileIds(ids: readonly string[]): string[] {
    return Array.from(new Set(ids)).sort();
}

function profileMap(
    ids: readonly string[],
    profiles: readonly (VirtualDeviceProfileDto | null)[]
): Map<string, VirtualDeviceProfileDto> {
    const byId = new Map<string, VirtualDeviceProfileDto>();
    profiles.forEach((profile, index) => {
        if (profile) byId.set(ids[index], profile);
    });
    return byId;
}

function profileRoleFacts(input: {
    device: VirtualDeviceDto & {profileId: string};
    profile: VirtualDeviceProfileDto | undefined;
}): VirtualProfileRoleFact[] {
    if (!input.profile) return [];
    return input.profile.roles.map((role) => ({
        virtualExternalId: input.device.externalId,
        profileId: input.device.profileId,
        role
    }));
}

export async function relatedVirtualExternalIds(
    input: OrganizationRelationshipLoadInput
): Promise<Set<string>> {
    const rows = await loadVirtualBindingRows(input);
    const ids = new Set<string>();
    for (const row of rows) ids.add(row.virtual_external_id);
    const devices = await loadVirtualDevices(input);
    for (const device of devices) {
        if (virtualDeviceRelatesToCenter({input, device})) {
            ids.add(device.externalId);
        }
    }
    return ids;
}

export async function relatedConnectorExternalIds(
    input: OrganizationRelationshipLoadInput
): Promise<Set<string>> {
    const rows = await loadVirtualBindingRows(input);
    const externalIds = new Set<string>([input.centerExternalId]);
    for (const row of rows) {
        externalIds.add(row.virtual_external_id);
        externalIds.add(row.source_external_id);
    }
    return externalIds;
}

export function bluetoothDeviceRelatesToCenter(data: {
    input: OrganizationRelationshipLoadInput;
    device: BluetoothDeviceDto;
}): boolean {
    return (
        data.device.externalId === data.input.centerExternalId ||
        data.device.primaryTransport?.shellyDeviceExternalId ===
            data.input.centerExternalId
    );
}

export function virtualDeviceRelatesToCenter(data: {
    input: RelationshipLoadInput;
    device: VirtualDeviceDto;
}): boolean {
    return (
        data.device.externalId === data.input.centerExternalId ||
        extractionSourceHost(data.device) === data.input.centerExternalId
    );
}

export function extractionDeviceRelatesToCenter(data: {
    input: RelationshipLoadInput;
    device: VirtualDeviceDto;
}): boolean {
    if (data.device.kind !== 'extracted') return false;
    return virtualDeviceRelatesToCenter(data);
}

export function extractionSourceHost(device: VirtualDeviceDto): string | null {
    return extractionMetadata(device)?.sourceHostExternalId ?? null;
}

export function extractionMetadata(device: VirtualDeviceDto): {
    sourceHostExternalId: string;
    sourceKey: string;
    sourceType: string;
    capturedAt?: string;
    hiddenSourceComponentKeys?: string[];
} | null {
    const extraction = readRecord(device.metadata.extraction);
    const snapshot = readRecord(extraction.sourceSnapshot);
    const sourceHostExternalId = stringValue(
        extraction.sourceHostExternalId,
        snapshot.hostExternalId
    );
    const sourceKey = stringValue(extraction.sourceKey, snapshot.sourceKey);
    const sourceType = stringValue(extraction.sourceType, snapshot.sourceType);
    if (!sourceHostExternalId || !sourceKey || !sourceType) return null;
    return {
        sourceHostExternalId,
        sourceKey,
        sourceType,
        capturedAt: stringValue(snapshot.capturedAt),
        hiddenSourceComponentKeys: stringArray(
            extraction.hiddenSourceComponentKeys
        )
    };
}

export function virtualBindingStatus(
    row: VirtualBindingRow
): RelationshipVirtualBindingFact['status'] {
    const source = DeviceCollector.getDevice(row.source_external_id);
    if (!source) return 'healthy';
    if (source.presence === 'offline') return requiredRoleSeverity(row);
    if (source.presence === 'pending') return 'warning';
    return 'healthy';
}

export function requiredRoleSeverity(
    row: Pick<VirtualBindingRow, 'required'>
): 'warning' | 'critical' {
    return row.required === false ? 'warning' : 'critical';
}

export function virtualRoleKey(
    virtualExternalId: string,
    roleKey: string
): string {
    return `${virtualExternalId}:${roleKey}`;
}

export async function visibleVirtualBindingRows(
    input: OrganizationRelationshipLoadInput
): Promise<VirtualBindingRow[]> {
    const rows = await loadVirtualBindingRows(input);
    const relatedIds = rows.flatMap((row) => [
        row.virtual_external_id,
        row.source_external_id
    ]);
    const visibleIds = await filterAccessibleExternalIds(input, relatedIds);
    return rows.filter((row) =>
        virtualBindingRowIsVisible({row, input, visibleIds})
    );
}

function virtualBindingRowIsVisible(data: {
    row: VirtualBindingRow;
    input: RelationshipLoadInput;
    visibleIds: ReadonlySet<string>;
}): boolean {
    return (
        relationshipEndpointIsVisible(data.row.virtual_external_id, data) &&
        relationshipEndpointIsVisible(data.row.source_external_id, data)
    );
}

export function relationshipEndpointIsVisible(
    externalId: string,
    data: {input: RelationshipLoadInput; visibleIds: ReadonlySet<string>}
): boolean {
    return (
        externalId === data.input.centerExternalId ||
        data.visibleIds.has(externalId)
    );
}

export function visibleDeviceRef(
    externalId: string | null,
    input: RelationshipLoadInput,
    visibleIds: ReadonlySet<string>
): string | null {
    if (!externalId) return null;
    if (externalId === input.centerExternalId) return externalId;
    return visibleIds.has(externalId) ? externalId : null;
}

export async function queryBluetoothTransportRelationshipRows(input: {
    organizationId: string;
    externalIds: readonly string[];
}): Promise<BluetoothTransportRelationshipRow[]> {
    if (input.externalIds.length === 0) return [];
    return await postgres.queryRows<BluetoothTransportRelationshipRow>(
        `SELECT
            blu_dl.external_id AS bluetooth_external_id,
            bt.id::text,
            bt.mode,
            bt.is_primary,
            bt.can_write,
            bt.enabled,
            shelly.external_id AS shelly_device_external_id,
            assistant.external_id AS assistant_device_external_id,
            bt.host_adapter_id,
            bt.serial_port_ref,
            bt.last_seen_at,
            bt.last_rssi
           FROM device.blu_transport bt
           JOIN device.blu_device bd
             ON bd.device_list_id = bt.blu_device_list_id
            AND bd.organization_id = bt.organization_id
           JOIN device.list blu_dl
             ON blu_dl.id = bd.device_list_id
            AND blu_dl.organization_id = bd.organization_id
      LEFT JOIN device.list shelly
             ON shelly.id = bt.shelly_device_list_id
            AND shelly.organization_id = bt.organization_id
      LEFT JOIN device.list assistant
             ON assistant.id = bt.assistant_device_list_id
            AND assistant.organization_id = bt.organization_id
          WHERE bt.organization_id = $1
            AND blu_dl.external_id = ANY($2::text[])
          ORDER BY blu_dl.external_id ASC, bt.is_primary DESC, bt.created_at ASC`,
        [input.organizationId, input.externalIds]
    );
}

export function needsVirtualRelationships(
    includes: ReadonlySet<DeviceRelationshipInclude>
): boolean {
    return (
        includes.has('virtualBindings') ||
        includes.has('virtualDependents') ||
        includes.has('extraction')
    );
}

export function presenceStatus(
    presence: ShellyDeviceExternal['presence']
): RelationshipDeviceFact['status'] {
    const statuses = {
        online: 'healthy',
        offline: 'offline',
        pending: 'warning'
    } as const;
    return statuses[presence] ?? 'unknown';
}
