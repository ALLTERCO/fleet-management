import {bthomeObjectInfos} from '../../config/BTHomeData';
import type {ShellyDeviceExternal} from '../../types';
import type {DeviceRelationshipInclude} from '../../types/api/device';
import * as DeviceCollector from '../DeviceCollector';
import {componentType, isComponentKey} from './componentKeys';
import {needsVirtualRelationships, presenceStatus} from './deviceLoadingCore';
import {
    finiteNumber,
    objectRecord,
    readRecord,
    stringValue
} from './relationshipShared';
import type {
    ControlRelationshipRef,
    RelationshipLoadInput
} from './relationshipTypes';
import type {
    RelationshipComponentFact,
    RelationshipControlFact,
    RelationshipDeviceFact,
    RelationshipEntityFact
} from './types';

export function loadIncludedComponentFacts(
    input: RelationshipLoadInput,
    devices: readonly RelationshipDeviceFact[]
): RelationshipComponentFact[] {
    if (!needsComponentFacts(input.includes)) return [];
    return loadComponentFacts(devices);
}

function needsComponentFacts(
    includes: ReadonlySet<DeviceRelationshipInclude>
): boolean {
    return (
        includes.has('components') ||
        needsVirtualRelationships(includes) ||
        includes.has('bluetooth')
    );
}

function loadComponentFacts(
    devices: readonly RelationshipDeviceFact[]
): RelationshipComponentFact[] {
    return devices.flatMap((device) => {
        const liveDevice = DeviceCollector.getDevice(device.externalId);
        if (!liveDevice) return [];
        const snapshot = liveDevice.toJSON();
        return componentKeysFromLiveDevice(snapshot).map((componentKey) =>
            componentFactFromSnapshot({
                deviceExternalId: device.externalId,
                componentKey,
                status: presenceStatus(liveDevice.presence),
                snapshot
            })
        );
    });
}

function componentFactFromSnapshot(input: {
    deviceExternalId: string;
    componentKey: string;
    status: RelationshipComponentFact['status'];
    snapshot: ShellyDeviceExternal;
}): RelationshipComponentFact {
    const config = readRecord(
        readRecord(input.snapshot.settings)[input.componentKey]
    );
    const state = readRecord(
        readRecord(input.snapshot.status)[input.componentKey]
    );
    return {
        deviceExternalId: input.deviceExternalId,
        componentKey: input.componentKey,
        label: componentLabel({
            componentKey: input.componentKey,
            config,
            state
        }),
        status: input.status,
        meta: {componentType: componentType(input.componentKey)}
    };
}

function componentLabel(input: {
    componentKey: string;
    config: Record<string, unknown>;
    state: Record<string, unknown>;
}): string {
    return (
        configuredComponentName(input.config, input.state) ??
        bthomeComponentLabel(input) ??
        input.componentKey
    );
}

function configuredComponentName(
    config: Record<string, unknown>,
    state: Record<string, unknown>
): string | undefined {
    return stringValue(config.name, state.name);
}

function bthomeComponentLabel(input: {
    componentKey: string;
    config: Record<string, unknown>;
    state: Record<string, unknown>;
}): string | undefined {
    if (!input.componentKey.startsWith('bthome')) return undefined;
    return bthomeObjectName(input.config, input.state);
}

function bthomeObjectName(
    config: Record<string, unknown>,
    state: Record<string, unknown>
): string | undefined {
    const attrs = objectRecord(config._attrs) ?? {};
    const objId = finiteNumber(
        attrs.obj_id ?? attrs.objId ?? config.obj_id ?? state.obj_id
    );
    return stringValue(
        attrs.obj_name,
        config.obj_name,
        state.obj_name,
        objId === undefined ? undefined : bthomeObjectInfos[objId]?.name
    );
}

function componentKeysFromLiveDevice(row: ShellyDeviceExternal): string[] {
    return [
        ...new Set([...objectKeys(row.settings), ...objectKeys(row.status)])
    ]
        .filter(isComponentKey)
        .sort();
}

function objectKeys(value: unknown): string[] {
    if (!value || typeof value !== 'object') return [];
    return Object.keys(value);
}

export async function loadIncludedControlFacts(
    input: RelationshipLoadInput
): Promise<RelationshipControlFact[]> {
    if (!input.includes.has('components')) return [];
    const refs = thermostatControlRefs(input.centerExternalId);
    if (refs.length === 0 || !input.filterAccessibleDevices) return [];
    const accessible = await input.filterAccessibleDevices(
        refs.map((ref) => ref.targetExternalId)
    );
    return refs
        .filter((ref) => accessible.has(ref.targetExternalId))
        .map(controlFact);
}

function thermostatControlRefs(
    controllerExternalId: string
): ControlRelationshipRef[] {
    const liveDevice = DeviceCollector.getDevice(controllerExternalId);
    if (!liveDevice) return [];
    return Object.entries(readRecord(liveDevice.toJSON().settings))
        .filter(([componentKey]) => componentKey.startsWith('thermostat:'))
        .flatMap(([componentKey, config]) =>
            thermostatControlRef({
                controllerExternalId,
                controllerComponentKey: componentKey,
                actuator: readRecord(config).actuator
            })
        );
}

function thermostatControlRef(input: {
    controllerExternalId: string;
    controllerComponentKey: string;
    actuator: unknown;
}): ControlRelationshipRef[] {
    if (typeof input.actuator !== 'string') return [];
    const target = parseShellyActuatorTarget(input.actuator);
    if (!target) return [];
    return [
        {
            controllerExternalId: input.controllerExternalId,
            controllerComponentKey: input.controllerComponentKey,
            targetExternalId: target.externalId,
            targetComponentKey: target.componentKey
        }
    ];
}

function parseShellyActuatorTarget(
    value: string
): {externalId: string; componentKey?: string} | null {
    const match = value.match(/^shelly:\/\/([^/]+)\/c\/([^/]+)$/);
    if (!match || match[1] === 'self' || match[1] === '') return null;
    return {
        externalId: match[1],
        componentKey: isComponentKey(match[2]) ? match[2] : undefined
    };
}

function controlFact(input: ControlRelationshipRef): RelationshipControlFact {
    return {
        controllerExternalId: input.controllerExternalId,
        controllerComponentKey: input.controllerComponentKey,
        targetExternalId: input.targetExternalId,
        targetComponentKey: input.targetComponentKey,
        status: 'unknown',
        meta: {source: 'thermostat_actuator'}
    };
}

export function loadIncludedEntityFacts(
    input: RelationshipLoadInput,
    devices: readonly RelationshipDeviceFact[]
): RelationshipEntityFact[] {
    if (!input.includes.has('components')) return [];
    return loadEntityFacts(devices);
}

function loadEntityFacts(
    devices: readonly RelationshipDeviceFact[]
): RelationshipEntityFact[] {
    return devices.flatMap((device) => {
        const liveDevice = DeviceCollector.getDevice(device.externalId);
        const entities = liveDevice?.toJSON().entities ?? [];
        return entities
            .filter((entity): entity is string => typeof entity === 'string')
            .map((entity) => ({
                deviceExternalId: device.externalId,
                entityId: entity,
                label: entity
            }));
    });
}
