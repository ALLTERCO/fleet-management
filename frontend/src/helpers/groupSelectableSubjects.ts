import type {GroupMemberRef} from '@api/group';
import type {SensorDevice} from '@/stores/sensors';
import type {entity_t, shelly_device_t} from '@/types';

export type GroupSelectableSubject =
    | {
          kind: 'device';
          key: string;
          ref: GroupMemberRef;
          shellyID: string;
          name: string;
          searchText: string;
      }
    | {
          kind: 'ble_device';
          key: string;
          ref: GroupMemberRef;
          sensor: SensorDevice;
          gatewayId: string;
          searchText: string;
      };

const BLE_DEVICE_ENTITY_TYPES = new Set(['bthomedevice', 'blutrv']);

export function buildGroupSelectableSubjects(input: {
    devices: shelly_device_t[];
    entities: entity_t[];
    deviceName: (device: shelly_device_t) => string;
}): GroupSelectableSubject[] {
    return [
        ...input.devices.map((device) =>
            deviceSubject(device, input.deviceName(device))
        ),
        ...input.entities.flatMap((entity) => bleDeviceSubject(entity) ?? [])
    ].sort(compareSubjects);
}

export function isGroupDeviceLikeMember(member: GroupMemberRef): boolean {
    return member.subjectType === 'device' || member.subjectType === 'entity';
}

function deviceSubject(
    device: shelly_device_t,
    name: string
): GroupSelectableSubject {
    const ref: GroupMemberRef = {
        subjectType: 'device',
        subjectId: device.shellyID
    };
    return {
        kind: 'device',
        key: subjectKey(ref),
        ref,
        shellyID: device.shellyID,
        name,
        searchText: `${name} ${device.shellyID}`.toLowerCase()
    };
}

function bleDeviceSubject(entity: entity_t): GroupSelectableSubject | null {
    if (!BLE_DEVICE_ENTITY_TYPES.has(entity.type)) return null;
    const ref: GroupMemberRef = {subjectType: 'entity', subjectId: entity.id};
    const sensor = sensorFromEntity(entity);
    return {
        kind: 'ble_device',
        key: subjectKey(ref),
        ref,
        sensor,
        gatewayId: entity.source,
        searchText: `${sensor.name} ${sensor.id} ${entity.source}`.toLowerCase()
    };
}

function sensorFromEntity(entity: entity_t): SensorDevice {
    const properties = entity.properties as Record<string, any>;
    return {
        id: entity.id,
        name:
            entity.name ||
            properties.productName ||
            properties.modelId ||
            properties.addr ||
            entity.id,
        kind: entity.type === 'blutrv' ? 'trv' : 'sensor',
        online:
            entity.type === 'blutrv'
                ? properties.connected !== false
                : properties.paired !== false,
        battery:
            typeof properties.battery === 'number'
                ? properties.battery
                : undefined,
        modelId:
            typeof properties.modelId === 'string'
                ? properties.modelId
                : undefined,
        productName:
            typeof properties.productName === 'string'
                ? properties.productName
                : undefined
    };
}

function compareSubjects(
    a: GroupSelectableSubject,
    b: GroupSelectableSubject
): number {
    if (a.kind !== b.kind) return a.kind === 'device' ? -1 : 1;
    return a.searchText.localeCompare(b.searchText);
}

function subjectKey(ref: GroupMemberRef): string {
    return `${ref.subjectType}:${ref.subjectId}`;
}
