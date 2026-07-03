import {tuning} from '../../config/tuning';
import type AbstractDevice from '../../model/AbstractDevice';
import type {ShellyDeviceExternal} from '../../types';
import type {
    DeviceRelationshipInclude,
    RelationshipSummaryDto
} from '../../types/api/device';
import {
    type BluAssistConnection,
    listConnections
} from '../bluAssistConnectionTracker';
import * as DeviceCollector from '../DeviceCollector';
import {componentType, isComponentKey} from './componentKeys';
import {presenceStatus} from './deviceLoadingCore';
import {
    deviceSubresourceLabel,
    externalConnectionLabel,
    firmwareFamilyLabel
} from './relationshipLabels';
import {
    bluAssistantBondMeta,
    bluAssistantConnectionMeta,
    componentRefMeta,
    externalConnectionMeta,
    firmwareListItemMeta,
    firmwareListReferenceMeta,
    firmwareSnapshotMeta,
    safeFirmwareItemLabel
} from './relationshipRedaction';
import type {
    RelationshipDeviceSubresourceComponentRef,
    RelationshipDeviceSubresourceFact,
    RelationshipExternalConnectionComponentRef,
    RelationshipExternalConnectionFact
} from './types';

interface DeviceSideRelationshipInput {
    centerExternalId: string;
    includes: ReadonlySet<DeviceRelationshipInclude>;
}

interface FirmwareSubresourceListInput {
    liveDevice: AbstractDevice;
    deviceExternalId: string;
    families: ReadonlySet<string>;
    status: RelationshipDeviceSubresourceFact['status'];
}

interface FirmwareRpcListSpec {
    family: string;
    method: string;
    include: DeviceRelationshipInclude;
}

interface DeviceSideRpcInput {
    liveDevice: AbstractDevice;
    deviceExternalId: string;
    status: RelationshipDeviceSubresourceFact['status'];
}

interface ServiceResourceInput {
    liveDevice: AbstractDevice;
    deviceExternalId: string;
    status: RelationshipExternalConnectionFact['status'];
    componentKeys: readonly string[];
}

const DEVICE_SUBRESOURCE_COMPONENT_TYPES = new Set([
    'addon',
    'camera',
    'dali',
    'ledstrip',
    'lnm',
    'media',
    'presence',
    'script',
    'virtual'
]);

const EXTERNAL_CONNECTION_FAMILIES = [
    'ble',
    'cloud',
    'eth',
    'knx',
    'matter',
    'mdns',
    'modbus',
    'mqtt',
    'serial',
    'service',
    'web',
    'wifi',
    'ws',
    'zigbee'
] as const;

const FIRMWARE_RPC_LISTS: readonly FirmwareRpcListSpec[] = [
    {family: 'schedule', method: 'Schedule.List', include: 'deviceSchedules'},
    {family: 'script', method: 'Script.List', include: 'deviceScripts'},
    {family: 'webhook', method: 'Webhook.List', include: 'deviceWebhooks'},
    {
        family: 'addon_peripheral',
        method: 'SensorAddon.GetPeripherals',
        include: 'deviceSubresources'
    },
    {
        family: 'addon_pro_output_peripheral',
        method: 'ProOutputAddon.GetPeripherals',
        include: 'deviceSubresources'
    },
    {family: 'media', method: 'Media.List', include: 'deviceSubresources'},
    {
        family: 'media_album',
        method: 'Media.ListAudioAlbums',
        include: 'deviceSubresources'
    },
    {
        family: 'media_artist',
        method: 'Media.ListAudioArtists',
        include: 'deviceSubresources'
    },
    {
        family: 'radio_favourite',
        method: 'Media.Radio.ListFavourites',
        include: 'deviceSubresources'
    },
    {
        family: 'wifi_saved_network',
        method: 'Wifi.SavedNetworks.List',
        include: 'deviceSubresources'
    },
    {
        family: 'wifi_client',
        method: 'Wifi.ListAPClients',
        include: 'deviceSubresources'
    },
    {
        family: 'eth_client',
        method: 'Eth.ListClients',
        include: 'deviceSubresources'
    },
    {
        family: 'ble_paired_device',
        method: 'BLE.ListPairedDevices',
        include: 'deviceSubresources'
    },
    {
        family: 'ble_cloud_relay',
        method: 'BLE.CloudRelay.List',
        include: 'deviceSubresources'
    },
    {
        family: 'ble_cloud_relay_info',
        method: 'BLE.CloudRelay.ListInfos',
        include: 'deviceSubresources'
    },
    {family: 'xmod', method: 'XMOD.GetInfo', include: 'deviceSubresources'}
];

export async function loadDeviceSubresourceFacts(
    input: DeviceSideRelationshipInput
): Promise<RelationshipDeviceSubresourceFact[]> {
    const families = requestedSubresourceFamilies(input.includes);
    if (families.size === 0) return [];
    const liveDevice = DeviceCollector.getDevice(input.centerExternalId);
    if (!liveDevice) return [];
    const snapshot = liveDevice.toJSON();
    const status = presenceStatus(liveDevice.presence);
    return capSubresourceFacts(
        uniqueSubresourceFacts([
            ...snapshotSubresourceFacts({
                snapshot,
                families,
                status,
                deviceExternalId: input.centerExternalId
            }),
            ...(await firmwareSubresourceFacts({
                liveDevice,
                includes: input.includes,
                families,
                status,
                deviceExternalId: input.centerExternalId
            })),
            ...(await thermostatScheduleFacts({
                liveDevice,
                includes: input.includes,
                deviceExternalId: input.centerExternalId,
                status
            })),
            ...(await trvScheduleFacts({
                liveDevice,
                includes: input.includes,
                deviceExternalId: input.centerExternalId,
                status
            })),
            ...(await bluAssistantFacts({
                liveDevice,
                includes: input.includes,
                deviceExternalId: input.centerExternalId,
                status
            }))
        ])
    );
}

export async function loadExternalConnectionFacts(
    input: DeviceSideRelationshipInput
): Promise<RelationshipExternalConnectionFact[]> {
    if (!input.includes.has('externalConnections')) return [];
    const liveDevice = DeviceCollector.getDevice(input.centerExternalId);
    if (!liveDevice) return [];
    const snapshot = liveDevice.toJSON();
    const snapshotFacts = EXTERNAL_CONNECTION_FAMILIES.flatMap((family) =>
        snapshotExternalConnectionFact({
            family,
            deviceExternalId: input.centerExternalId,
            status: presenceStatus(liveDevice.presence),
            config: readRecord(snapshot.settings)[family],
            state: readRecord(snapshot.status)[family]
        })
    );
    const serviceFacts = await serviceResourceFacts({
        liveDevice,
        deviceExternalId: input.centerExternalId,
        status: presenceStatus(liveDevice.presence),
        componentKeys: componentKeysFromLiveDevice(snapshot)
    });
    return uniqueExternalConnectionFacts([...snapshotFacts, ...serviceFacts]);
}

export function loadLiveDeviceSidePartialSummaries(
    input: DeviceSideRelationshipInput
): RelationshipSummaryDto[] {
    if (!DeviceCollector.getDevice(input.centerExternalId)) return [];
    return deviceSidePartialIncludes(input.includes).map((include) => ({
        severity: 'info',
        text: `${include} relationships for ${input.centerExternalId} use safe live snapshots and bounded firmware list RPCs when available; secrets and payload bodies are omitted.`,
        reasonCode: `${include}_safe_live_enumeration`
    }));
}

export function loadDeviceSideSummaries(
    input: DeviceSideRelationshipInput
): RelationshipSummaryDto[] {
    if (DeviceCollector.getDevice(input.centerExternalId)) return [];
    const requested = deviceSideIncludes(input.includes);
    return requested.map((include) => ({
        severity: 'warning',
        text: `${include} relationships require a live device snapshot for ${input.centerExternalId}.`,
        reasonCode: `${include}_unavailable_offline`
    }));
}

function requestedSubresourceFamilies(
    includes: ReadonlySet<DeviceRelationshipInclude>
): Set<string> {
    const families = new Set<string>();
    if (includes.has('deviceSubresources')) {
        for (const family of DEVICE_SUBRESOURCE_COMPONENT_TYPES) {
            families.add(family);
        }
    }
    if (includes.has('deviceScripts')) families.add('script');
    if (includes.has('deviceSchedules')) families.add('schedule');
    if (includes.has('deviceWebhooks')) families.add('webhook');
    return families;
}

function snapshotSubresourceFacts(input: {
    snapshot: ShellyDeviceExternal;
    families: ReadonlySet<string>;
    status: RelationshipDeviceSubresourceFact['status'];
    deviceExternalId: string;
}): RelationshipDeviceSubresourceFact[] {
    return componentKeysFromLiveDevice(input.snapshot)
        .filter((componentKey) =>
            input.families.has(componentType(componentKey))
        )
        .map((componentKey) =>
            deviceSubresourceFact({
                componentKey,
                deviceExternalId: input.deviceExternalId,
                status: input.status,
                config: readRecord(input.snapshot.settings)[componentKey],
                state: readRecord(input.snapshot.status)[componentKey]
            })
        );
}

async function firmwareSubresourceFacts(
    input: FirmwareSubresourceListInput & {
        includes: ReadonlySet<DeviceRelationshipInclude>;
    }
): Promise<RelationshipDeviceSubresourceFact[]> {
    const facts = await Promise.all(
        requestedFirmwareListSpecs(input).map((spec) =>
            firmwareListFacts(input, spec)
        )
    );
    return facts.flat();
}

function requestedFirmwareListSpecs(input: {
    includes: ReadonlySet<DeviceRelationshipInclude>;
    families: ReadonlySet<string>;
}): readonly FirmwareRpcListSpec[] {
    return FIRMWARE_RPC_LISTS.filter(
        (spec) =>
            input.includes.has(spec.include) || input.families.has(spec.family)
    );
}

async function firmwareListFacts(
    input: FirmwareSubresourceListInput,
    spec: FirmwareRpcListSpec
): Promise<RelationshipDeviceSubresourceFact[]> {
    try {
        const response = await input.liveDevice.sendRPC(
            spec.method,
            {},
            true,
            AbortSignal.timeout(tuning.rpc.rpcTimeoutMs)
        );
        return capFamilyItems(
            firmwareListItems(response, spec.family),
            spec.family
        ).map((item) => firmwareSubresourceFact(input, spec, item));
    } catch {
        return [];
    }
}

function firmwareSubresourceFact(
    input: DeviceSideRpcInput,
    spec: FirmwareRpcListSpec,
    item: Record<string, unknown>
): RelationshipDeviceSubresourceFact {
    const componentKey = firmwareComponentKey(spec.family, item);
    return {
        id: componentKey,
        label: deviceSubresourceLabel({
            componentKey,
            family: spec.family,
            itemLabel: safeFirmwareItemLabel(item)
        }),
        family: spec.family,
        deviceExternalId: input.deviceExternalId,
        componentKey,
        componentRefs: firmwareSubresourceComponentRefs(item),
        nodeType: deviceSubresourceNodeType(spec.family),
        hostEdgeType: deviceSubresourceHostEdgeType(spec.family),
        status: firmwareSubresourceStatus(item, input.status),
        meta: firmwareListItemMeta({
            method: spec.method,
            enabled: readEnabled(item),
            running: readBoolean(item.running),
            item
        })
    };
}

function firmwareListItems(
    response: unknown,
    family: FirmwareRpcListSpec['family']
): Record<string, unknown>[] {
    const record = readRecord(response);
    const values = [
        readArray(response),
        readArray(record[`${family}s`]),
        readArray(record.albums),
        readArray(record.artists),
        readArray(record.clients),
        readArray(record.connections),
        readArray(record.devices),
        readArray(record.favorites),
        readArray(record.favourites),
        readArray(record.infos),
        readArray(record.items),
        readArray(record.jobs),
        readArray(record.hooks),
        readArray(record.media),
        readArray(record.networks),
        readArray(record.peripherals),
        readArray(record.profiles),
        readArray(record.relays),
        readArray(record.resources),
        readArray(record.rules),
        readArray(record.scripts),
        readArray(record.slots)
    ].flat();
    if (values.length === 0 && Object.keys(record).length > 0) {
        return [record];
    }
    return values.flatMap((item) => {
        const itemRecord = objectRecord(item);
        return itemRecord ? [itemRecord] : [];
    });
}

function capFamilyItems(
    items: Record<string, unknown>[],
    _family: string
): Record<string, unknown>[] {
    return items.slice(0, tuning.device.relationshipDeviceSideFamilyLimit);
}

function firmwareComponentKey(
    family: FirmwareRpcListSpec['family'],
    item: Record<string, unknown>
): string {
    const id = itemId(item);
    return `${family}:${id}`;
}

function itemId(item: Record<string, unknown>): string {
    const id = item.id ?? item.cid ?? item.index;
    if (typeof id === 'string' && id.trim()) return id.trim();
    if (Number.isInteger(id) && Number(id) >= 0) return String(id);
    return stableItemId(item);
}

function stableItemId(item: Record<string, unknown>): string {
    const label = itemLabel(item);
    if (label) return label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return 'unknown';
}

function itemLabel(item: Record<string, unknown>): string | null {
    const name = item.name ?? item.title;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
}

function firmwareSubresourceComponentRefs(
    item: Record<string, unknown>
): RelationshipDeviceSubresourceComponentRef[] {
    return uniqueComponentKeys(componentKeysFromStructuredValue(item)).map(
        (componentKey) => ({
            componentKey,
            edgeType: 'subresource_refs_component' as const,
            meta: firmwareListReferenceMeta()
        })
    );
}

function firmwareSubresourceStatus(
    item: Record<string, unknown>,
    fallback: RelationshipDeviceSubresourceFact['status']
): RelationshipDeviceSubresourceFact['status'] {
    const enabled = readEnabled(item);
    if (enabled === false) return 'disabled';
    return fallback;
}

async function thermostatScheduleFacts(
    input: DeviceSideRpcInput & {
        includes: ReadonlySet<DeviceRelationshipInclude>;
    }
): Promise<RelationshipDeviceSubresourceFact[]> {
    if (!input.includes.has('deviceSchedules')) return [];
    const thermostatKeys = capDeviceSideComponentKeys(
        liveComponentKeys(input.liveDevice, 'thermostat')
    );
    const facts = await Promise.all(
        thermostatKeys.map((componentKey) =>
            thermostatScheduleFactsForComponent(input, componentKey)
        )
    );
    return facts.flat();
}

async function thermostatScheduleFactsForComponent(
    input: DeviceSideRpcInput,
    componentKey: string
): Promise<RelationshipDeviceSubresourceFact[]> {
    const id = componentIdFromKey(componentKey);
    const profiles = await firmwareListRpc(input.liveDevice, {
        method: 'Thermostat.Schedule.ListProfiles',
        params: {id},
        family: 'thermostat_schedule_profile'
    });
    const rules = await Promise.all(
        profiles.map((profile) =>
            thermostatRulesForProfile(input.liveDevice, id, profile)
        )
    );
    return [
        ...profiles.map((item) =>
            firmwareSubresourceFact(
                input,
                {
                    family: 'thermostat_schedule_profile',
                    method: 'Thermostat.Schedule.ListProfiles',
                    include: 'deviceSchedules'
                },
                item
            )
        ),
        ...rules.flat().map((item) =>
            firmwareSubresourceFact(
                input,
                {
                    family: 'thermostat_schedule_rule',
                    method: 'Thermostat.Schedule.ListRules',
                    include: 'deviceSchedules'
                },
                item
            )
        )
    ];
}

async function thermostatRulesForProfile(
    liveDevice: AbstractDevice,
    thermostatId: number,
    profile: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
    return await firmwareListRpc(liveDevice, {
        method: 'Thermostat.Schedule.ListRules',
        params: {
            id: thermostatId,
            profile_id: profile.id ?? profile.profile_id
        },
        family: 'thermostat_schedule_rule'
    });
}

async function trvScheduleFacts(
    input: DeviceSideRpcInput & {
        includes: ReadonlySet<DeviceRelationshipInclude>;
    }
): Promise<RelationshipDeviceSubresourceFact[]> {
    if (!input.includes.has('deviceSchedules')) return [];
    const trvKeys = capDeviceSideComponentKeys(
        liveComponentKeys(input.liveDevice, 'trv')
    );
    const facts = await Promise.all(
        trvKeys.map((componentKey) =>
            trvScheduleFactsForComponent(input, componentKey)
        )
    );
    return facts.flat();
}

async function trvScheduleFactsForComponent(
    input: DeviceSideRpcInput,
    componentKey: string
): Promise<RelationshipDeviceSubresourceFact[]> {
    const items = await firmwareListRpc(input.liveDevice, {
        method: 'BluTrv.Call',
        params: {
            id: componentIdFromKey(componentKey),
            method: 'Trv.ListScheduleRules',
            params: {id: 0}
        },
        family: 'trv_schedule'
    });
    return items.map((item) =>
        firmwareSubresourceFact(
            input,
            {
                family: 'trv_schedule',
                method: 'BluTrv.Call',
                include: 'deviceSchedules'
            },
            item
        )
    );
}

async function bluAssistantFacts(
    input: DeviceSideRpcInput & {
        includes: ReadonlySet<DeviceRelationshipInclude>;
    }
): Promise<RelationshipDeviceSubresourceFact[]> {
    if (!input.includes.has('deviceSubresources')) return [];
    const connections = capBluAssistantConnections(
        listConnections(input.deviceExternalId)
    );
    const bonds = await Promise.all(
        connections.map((connection) => bluAssistantBondFact(input, connection))
    );
    return [
        ...connections.map((connection) =>
            bluAssistantConnectionFact(input, connection)
        ),
        ...bonds.flat()
    ];
}

function capBluAssistantConnections(
    connections: BluAssistConnection[]
): BluAssistConnection[] {
    return connections.slice(
        0,
        tuning.device.relationshipDeviceSideFamilyLimit
    );
}

function bluAssistantConnectionFact(
    input: DeviceSideRpcInput,
    connection: BluAssistConnection
): RelationshipDeviceSubresourceFact {
    const id = `bluassist_connection:${connection.conn_id}`;
    return {
        id,
        label: deviceSubresourceLabel({
            componentKey: id,
            family: 'bluassist_connection',
            itemLabel: `BLU assistant connection ${connection.conn_id}`
        }),
        family: 'bluassist_connection',
        deviceExternalId: input.deviceExternalId,
        nodeType: deviceSubresourceNodeType('bluassist_connection'),
        hostEdgeType: deviceSubresourceHostEdgeType('bluassist_connection'),
        status: input.status,
        meta: bluAssistantConnectionMeta(connection)
    };
}

async function bluAssistantBondFact(
    input: DeviceSideRpcInput,
    connection: BluAssistConnection
): Promise<RelationshipDeviceSubresourceFact[]> {
    const haveBond = await readBluAssistantBond(input, connection);
    if (haveBond === null) return [];
    const id = `bluassist_bond:${connection.conn_id}`;
    return [
        {
            id,
            label: deviceSubresourceLabel({
                componentKey: id,
                family: 'bluassist_bond',
                itemLabel: `BLU assistant bond ${connection.conn_id}`
            }),
            family: 'bluassist_bond',
            deviceExternalId: input.deviceExternalId,
            nodeType: deviceSubresourceNodeType('bluassist_bond'),
            hostEdgeType: deviceSubresourceHostEdgeType('bluassist_bond'),
            status: haveBond ? input.status : 'disabled',
            meta: bluAssistantBondMeta({haveBond})
        }
    ];
}

async function readBluAssistantBond(
    input: DeviceSideRpcInput,
    connection: BluAssistConnection
): Promise<boolean | null> {
    try {
        const response = await input.liveDevice.sendRPC(
            'GATTC.HaveBond',
            {addr: connection.addr},
            true,
            AbortSignal.timeout(tuning.rpc.rpcTimeoutMs)
        );
        return readBoolean(readRecord(response).have_bond);
    } catch (err) {
        if (isBondNotFound(err)) return false;
        return null;
    }
}

function isBondNotFound(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /bond not found/i.test(message);
}

async function firmwareListRpc(
    liveDevice: AbstractDevice,
    input: {method: string; params: Record<string, unknown>; family: string}
): Promise<Record<string, unknown>[]> {
    try {
        const response = await liveDevice.sendRPC(
            input.method,
            input.params,
            true,
            AbortSignal.timeout(tuning.rpc.rpcTimeoutMs)
        );
        return capFamilyItems(
            firmwareListItems(response, input.family),
            input.family
        );
    } catch {
        return [];
    }
}

function componentIdFromKey(componentKey: string): number {
    const id = Number(componentKey.split(':')[1]);
    return Number.isInteger(id) && id >= 0 ? id : 0;
}

function deviceSubresourceFact(input: {
    componentKey: string;
    deviceExternalId: string;
    status: RelationshipDeviceSubresourceFact['status'];
    config: unknown;
    state: unknown;
}): RelationshipDeviceSubresourceFact {
    const family = componentType(input.componentKey);
    return {
        id: input.componentKey,
        label: deviceSubresourceLabel({
            componentKey: input.componentKey,
            family
        }),
        family,
        deviceExternalId: input.deviceExternalId,
        componentKey: input.componentKey,
        componentRefs: deviceSubresourceComponentRefs(input),
        nodeType: deviceSubresourceNodeType(family),
        hostEdgeType: deviceSubresourceHostEdgeType(family),
        status: input.status,
        meta: firmwareSnapshotMeta()
    };
}

function deviceSubresourceComponentRefs(input: {
    componentKey: string;
    config: unknown;
    state: unknown;
}): RelationshipDeviceSubresourceComponentRef[] {
    return uniqueSubresourceComponentRefs([
        ...virtualGroupComponentRefs(input),
        ...ledStripScriptEffectRefs(input)
    ]);
}

function virtualGroupComponentRefs(input: {
    componentKey: string;
    config: unknown;
    state: unknown;
}): RelationshipDeviceSubresourceComponentRef[] {
    if (!input.componentKey.startsWith('virtual:')) return [];
    const keys = virtualGroupComponentKeys(input);
    return keys.map((componentKey) => ({
        componentKey,
        edgeType: 'virtual_group_contains_component' as const,
        meta: componentRefMeta('virtual_group_value')
    }));
}

function virtualGroupComponentKeys(input: {
    config: unknown;
    state: unknown;
}): string[] {
    return uniqueComponentKeys([
        ...componentKeysFromVirtualGroupRecord(readRecord(input.config)),
        ...componentKeysFromVirtualGroupRecord(readRecord(input.state))
    ]);
}

function componentKeysFromVirtualGroupRecord(
    record: Record<string, unknown>
): string[] {
    if (!recordLooksLikeVirtualGroup(record)) return [];
    return readArray(record.value).filter(isComponentKey);
}

function recordLooksLikeVirtualGroup(record: Record<string, unknown>): boolean {
    return (
        record.type === 'group' ||
        record.component === 'group' ||
        Array.isArray(record.value)
    );
}

function ledStripScriptEffectRefs(input: {
    componentKey: string;
    config: unknown;
    state: unknown;
}): RelationshipDeviceSubresourceComponentRef[] {
    if (!input.componentKey.startsWith('ledstrip:')) return [];
    return scriptComponentKeysFromLedStrip(input).map((componentKey) => ({
        componentKey,
        edgeType: 'ledstrip_effect_uses_script' as const,
        meta: componentRefMeta('ledstrip_script_effect')
    }));
}

function scriptComponentKeysFromLedStrip(input: {
    config: unknown;
    state: unknown;
}): string[] {
    return uniqueComponentKeys([
        ...scriptComponentKeysFromValue(input.config),
        ...scriptComponentKeysFromValue(input.state)
    ]);
}

function scriptComponentKeysFromValue(value: unknown): string[] {
    return scriptIdsFromValue(value).map((id) => `script:${id}`);
}

function scriptIdsFromValue(value: unknown): number[] {
    const ids: number[] = [];
    collectScriptIds({value, ids, depth: 0});
    return uniqueNumbers(ids);
}

function collectScriptIds(input: {
    value: unknown;
    ids: number[];
    depth: number;
}): void {
    if (input.depth > 4) return;
    if (Array.isArray(input.value)) {
        for (const item of input.value) {
            collectScriptIds({
                value: item,
                ids: input.ids,
                depth: input.depth + 1
            });
        }
        return;
    }
    const record = objectRecord(input.value);
    if (!record) return;
    collectRecordScriptIds(input.ids, record);
    for (const value of Object.values(record)) {
        collectScriptIds({value, ids: input.ids, depth: input.depth + 1});
    }
}

function collectRecordScriptIds(
    ids: number[],
    record: Record<string, unknown>
): void {
    for (const key of ['script_id', 'scriptId']) {
        const id = nonNegativeInteger(record[key]);
        if (id !== null) ids.push(id);
    }
}

function nonNegativeInteger(value: unknown): number | null {
    return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function uniqueSubresourceComponentRefs(
    refs: readonly RelationshipDeviceSubresourceComponentRef[]
): RelationshipDeviceSubresourceComponentRef[] {
    const seen = new Set<string>();
    return refs.filter((ref) => {
        const key = `${ref.edgeType}:${ref.componentKey}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function uniqueSubresourceFacts(
    facts: readonly RelationshipDeviceSubresourceFact[]
): RelationshipDeviceSubresourceFact[] {
    const seen = new Set<string>();
    return facts.filter((fact) => {
        const key = `${fact.deviceExternalId}:${fact.family}:${fact.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function capSubresourceFacts(
    facts: readonly RelationshipDeviceSubresourceFact[]
): RelationshipDeviceSubresourceFact[] {
    const counts = new Map<string, number>();
    return facts.filter((fact) => {
        const count = counts.get(fact.family) ?? 0;
        if (count >= tuning.device.relationshipDeviceSideFamilyLimit) {
            return false;
        }
        counts.set(fact.family, count + 1);
        return true;
    });
}

function deviceSubresourceNodeType(
    family: string
): RelationshipDeviceSubresourceFact['nodeType'] {
    if (family === 'script') return 'device.script';
    if (family === 'schedule') return 'device.schedule';
    if (family === 'webhook') return 'device.webhook';
    return 'device.subresource';
}

function deviceSubresourceHostEdgeType(
    family: string
): RelationshipDeviceSubresourceFact['hostEdgeType'] {
    if (family === 'script') return 'runs_device_script';
    if (family === 'schedule') return 'used_by_device_schedule';
    if (family === 'webhook') return 'triggers_device_webhook';
    return 'hosts_device_subresource';
}

function snapshotExternalConnectionFact(input: {
    family: (typeof EXTERNAL_CONNECTION_FAMILIES)[number];
    deviceExternalId: string;
    status: RelationshipExternalConnectionFact['status'];
    config: unknown;
    state: unknown;
}): RelationshipExternalConnectionFact[] {
    if (!input.config && !input.state) return [];
    const enabled = readEnabled(input.config);
    return [
        {
            id: input.family,
            label: externalConnectionLabel(input.family),
            family: input.family,
            deviceExternalId: input.deviceExternalId,
            status: enabled === false ? 'disabled' : input.status,
            componentRefs: externalConnectionComponentRefs(input),
            meta: externalConnectionMeta({
                enabled,
                source: 'live_config_status_snapshot'
            })
        }
    ];
}

async function serviceResourceFacts(
    input: ServiceResourceInput
): Promise<RelationshipExternalConnectionFact[]> {
    const serviceKeys = capDeviceSideComponentKeys(
        input.componentKeys.filter((key) => key.startsWith('service:'))
    );
    const facts = await Promise.all(
        serviceKeys.map((componentKey) =>
            serviceResourceFact(input, componentKey)
        )
    );
    return facts.flat();
}

function capDeviceSideComponentKeys(keys: readonly string[]): string[] {
    return keys.slice(0, tuning.device.relationshipDeviceSideFamilyLimit);
}

async function serviceResourceFact(
    input: ServiceResourceInput,
    componentKey: string
): Promise<RelationshipExternalConnectionFact[]> {
    const items = await firmwareListRpc(input.liveDevice, {
        method: 'Service.GetResources',
        params: {id: componentIdFromKey(componentKey)},
        family: 'service'
    });
    return items.map((item) => ({
        id: `${componentKey}:resources:${itemId(item)}`,
        label: `${firmwareFamilyLabel('service')} resource`,
        family: 'service',
        deviceExternalId: input.deviceExternalId,
        status: input.status,
        componentKey,
        componentRefs: uniqueComponentKeys(
            componentKeysFromStructuredValue(item)
        ).map((refComponentKey) => ({
            componentKey: refComponentKey,
            meta: componentRefMeta('service_resource_component_ref')
        })),
        meta: externalConnectionMeta({
            enabled: readEnabled(item),
            source: 'Service.GetResources',
            item
        })
    }));
}

function uniqueExternalConnectionFacts(
    facts: readonly RelationshipExternalConnectionFact[]
): RelationshipExternalConnectionFact[] {
    const seen = new Set<string>();
    return facts.filter((fact) => {
        const key = `${fact.deviceExternalId}:${fact.family}:${fact.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function externalConnectionComponentRefs(input: {
    family: (typeof EXTERNAL_CONNECTION_FAMILIES)[number];
    config: unknown;
    state: unknown;
}): RelationshipExternalConnectionComponentRef[] {
    if (!externalConnectionCanReferenceComponents(input.family)) return [];
    return componentKeysFromExternalConnection(input).map((componentKey) => ({
        componentKey,
        meta: componentRefMeta(`${input.family}_component_ref`)
    }));
}

function externalConnectionCanReferenceComponents(family: string): boolean {
    return family === 'knx' || family === 'service';
}

function componentKeysFromExternalConnection(input: {
    config: unknown;
    state: unknown;
}): string[] {
    return uniqueComponentKeys([
        ...componentKeysFromStructuredValue(input.config),
        ...componentKeysFromStructuredValue(input.state)
    ]);
}

function componentKeysFromStructuredValue(value: unknown): string[] {
    const componentKeys: string[] = [];
    collectStructuredComponentKeys({value, componentKeys, depth: 0});
    return componentKeys;
}

function collectStructuredComponentKeys(input: {
    value: unknown;
    componentKeys: string[];
    depth: number;
}): void {
    if (input.depth > 4) return;
    if (isComponentKey(input.value)) {
        input.componentKeys.push(input.value);
        return;
    }
    if (Array.isArray(input.value)) {
        collectStructuredArrayComponentKeys({
            value: input.value,
            componentKeys: input.componentKeys,
            depth: input.depth
        });
        return;
    }
    const record = objectRecord(input.value);
    if (!record) return;
    collectStructuredRecordComponentKeys({
        record,
        componentKeys: input.componentKeys,
        depth: input.depth
    });
}

function collectStructuredArrayComponentKeys(input: {
    value: unknown[];
    componentKeys: string[];
    depth: number;
}): void {
    for (const item of input.value) {
        collectStructuredComponentKeys({
            value: item,
            componentKeys: input.componentKeys,
            depth: input.depth + 1
        });
    }
}

function collectStructuredRecordComponentKeys(input: {
    record: Record<string, unknown>;
    componentKeys: string[];
    depth: number;
}): void {
    for (const [key, value] of Object.entries(input.record)) {
        if (isComponentKey(key)) input.componentKeys.push(key);
        collectStructuredComponentKeys({
            value,
            componentKeys: input.componentKeys,
            depth: input.depth + 1
        });
    }
}

function componentKeysFromLiveDevice(row: ShellyDeviceExternal): string[] {
    return [
        ...new Set([...objectKeys(row.settings), ...objectKeys(row.status)])
    ]
        .filter(isComponentKey)
        .sort();
}

function liveComponentKeys(
    liveDevice: AbstractDevice,
    family: string
): string[] {
    return componentKeysFromLiveDevice(liveDevice.toJSON()).filter(
        (componentKey) => componentType(componentKey) === family
    );
}

function objectKeys(value: unknown): string[] {
    if (!value || typeof value !== 'object') return [];
    return Object.keys(value);
}

function uniqueComponentKeys(keys: readonly string[]): string[] {
    return [...new Set(keys.filter(isComponentKey))].sort();
}

function uniqueNumbers(values: readonly number[]): number[] {
    return [...new Set(values)].sort((a, b) => a - b);
}

function deviceSidePartialIncludes(
    includes: ReadonlySet<DeviceRelationshipInclude>
): DeviceRelationshipInclude[] {
    return ['deviceSchedules', 'deviceScripts', 'deviceWebhooks'].filter(
        (include): include is DeviceRelationshipInclude =>
            includes.has(include as DeviceRelationshipInclude)
    );
}

function deviceSideIncludes(
    includes: ReadonlySet<DeviceRelationshipInclude>
): DeviceRelationshipInclude[] {
    return [
        'deviceSchedules',
        'deviceScripts',
        'deviceWebhooks',
        'deviceSubresources',
        'externalConnections'
    ].filter((include): include is DeviceRelationshipInclude =>
        includes.has(include as DeviceRelationshipInclude)
    );
}

function readEnabled(config: unknown): boolean | null {
    const record = readRecord(config);
    const enabled = record.enable ?? record.enabled;
    return typeof enabled === 'boolean' ? enabled : null;
}

function readBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function objectRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}
