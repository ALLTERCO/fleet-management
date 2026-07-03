import {
    mapBTHomeKnownObjects,
    mapBTHomeKnownSensorObjects
} from '../../config/BTHomeData';
import * as DeviceCollector from '../../modules/DeviceCollector';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    BTHOME_CONTROL_CREATE_PARAMS_SCHEMA,
    BTHOME_CONTROL_DELETE_PARAMS_SCHEMA,
    BTHOME_CONTROL_ENUMERATE_PARAMS_SCHEMA,
    BTHOME_CONTROL_GET_CONFIG_PARAMS_SCHEMA,
    BTHOME_CONTROL_GET_LEARNING_STATE_PARAMS_SCHEMA,
    BTHOME_CONTROL_GET_STATUS_PARAMS_SCHEMA,
    BTHOME_CONTROL_LIST_PARAMS_SCHEMA,
    BTHOME_CONTROL_SET_CONFIG_PARAMS_SCHEMA,
    BTHOME_CONTROL_START_LEARNING_PARAMS_SCHEMA,
    BTHOME_CONTROL_STOP_LEARNING_PARAMS_SCHEMA,
    BTHOME_CONTROL_UPDATE_PARAMS_SCHEMA,
    BTHOME_DESCRIBE,
    BTHOME_DEVICE_ADD_MANUAL_PARAMS_SCHEMA,
    BTHOME_DEVICE_GET_CONFIG_PARAMS_SCHEMA,
    BTHOME_DEVICE_GET_KNOWN_OBJECTS_PARAMS_SCHEMA,
    BTHOME_DEVICE_GET_STATUS_PARAMS_SCHEMA,
    BTHOME_DEVICE_REMOVE_PARAMS_SCHEMA,
    BTHOME_DEVICE_RENAME_PARAMS_SCHEMA,
    BTHOME_DEVICE_SET_CONFIG_PARAMS_SCHEMA,
    BTHOME_DEVICE_SET_KEY_PARAMS_SCHEMA,
    BTHOME_GET_CONFIG_PARAMS_SCHEMA,
    BTHOME_GET_STATUS_PARAMS_SCHEMA,
    BTHOME_LIST_GATEWAYS_PARAMS_SCHEMA,
    BTHOME_OBJECT_LIST_INFOS_PARAMS_SCHEMA,
    BTHOME_RESET_ENCRYPTION_COUNTER_PARAMS_SCHEMA,
    BTHOME_SENSOR_ADD_PARAMS_SCHEMA,
    BTHOME_SENSOR_DELETE_PARAMS_SCHEMA,
    BTHOME_SENSOR_GET_CONFIG_PARAMS_SCHEMA,
    BTHOME_SENSOR_GET_STATUS_PARAMS_SCHEMA,
    BTHOME_SENSOR_PAIR_PARAMS_SCHEMA,
    BTHOME_SENSOR_RENAME_PARAMS_SCHEMA,
    BTHOME_SENSOR_SET_CONFIG_PARAMS_SCHEMA,
    BTHOME_SET_CONFIG_PARAMS_SCHEMA,
    BTHOME_START_DISCOVERY_PARAMS_SCHEMA,
    type BthomeControlCreateParams,
    type BthomeControlDeleteParams,
    type BthomeControlEnumerateParams,
    type BthomeControlGetConfigParams,
    type BthomeControlGetLearningStateParams,
    type BthomeControlGetStatusParams,
    type BthomeControlListParams,
    type BthomeControlSetConfigParams,
    type BthomeControlStartLearningParams,
    type BthomeControlStopLearningParams,
    type BthomeControlUpdateParams,
    type BthomeDeviceAddManualParams,
    type BthomeDeviceGetConfigParams,
    type BthomeDeviceGetKnownObjectsParams,
    type BthomeDeviceGetStatusParams,
    type BthomeDeviceRemoveParams,
    type BthomeDeviceRenameParams,
    type BthomeDeviceSetConfigParams,
    type BthomeDeviceSetKeyParams,
    type BthomeGetConfigParams,
    type BthomeGetStatusParams,
    type BthomeListGatewaysParams,
    type BthomeObjectListInfosParams,
    type BthomeResetEncryptionCounterParams,
    type BthomeSensorAddParams,
    type BthomeSensorDeleteParams,
    type BthomeSensorGetConfigParams,
    type BthomeSensorGetStatusParams,
    type BthomeSensorPairParams,
    type BthomeSensorRenameParams,
    type BthomeSensorSetConfigParams,
    type BthomeSetConfigParams,
    type BthomeStartDiscoveryParams
} from '../../types/api/bthome';
import type AbstractDevice from '../AbstractDevice';
import type CommandSender from '../CommandSender';
import {wrapDeviceRpc} from '../deviceAdminRpc';
import type ShellyDevice from '../ShellyDevice';
import Component from './Component';

function isBleCapable(device: AbstractDevice): boolean {
    const status = device.status as Record<string, unknown> | undefined;
    if (!status) return false;
    if ('ble' in status || 'blugw:0' in status) return true;
    return Object.keys(status).some((key) => key.startsWith('bthomedevice:'));
}

function getShellyDevice(shellyID: string): ShellyDevice {
    const device = DeviceCollector.getDevice(shellyID) as ShellyDevice;
    if (!device) throw RpcError.DeviceNotFound();
    return device;
}

async function renameBTHomeEntity(
    label: string,
    shellyMethod: string,
    params: {shellyID: string; id: number; name: string | null}
) {
    const {shellyID, id, name} = params;
    const device = getShellyDevice(shellyID);
    return wrapDeviceRpc(label, async () => {
        await device.sendRPC(shellyMethod, {
            id,
            config: {
                name: typeof name === 'string' ? name.trim() || null : null
            }
        });
        return {success: true as const};
    });
}

export default class BTHomeComponent extends Component<any> {
    constructor() {
        super('bthome', {
            set_config_methods: false,
            auto_apply_config: false,
            // BTHome.md → discovery flow events. Notification-only.
            events: [
                {
                    event: 'device_discovered',
                    attrs: [
                        {
                            name: 'device',
                            type: 'object',
                            desc: 'Discovered BLU {addr, local_name, rssi, shelly_mfdata}'
                        }
                    ]
                },
                {
                    event: 'discovery_done',
                    attrs: [
                        {
                            name: 'device_count',
                            type: 'number',
                            desc: 'BLU devices found this scan'
                        }
                    ]
                }
            ]
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return BTHOME_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('ListGateways')
    @Component.CrudPermission('devices', 'read')
    async listGateways(rawParams: unknown, sender: CommandSender) {
        validateOrThrow<BthomeListGatewaysParams>(
            rawParams ?? {},
            BTHOME_LIST_GATEWAYS_PARAMS_SCHEMA
        );
        const all = DeviceCollector.getAll();
        const accessibleSet = await sender.filterAccessibleDevices(
            all.map((d) => d.shellyID)
        );
        const items = all
            .filter((d) => accessibleSet.has(d.shellyID) && isBleCapable(d))
            .map((d) => ({
                shellyID: d.shellyID,
                name: String(d.info?.name ?? d.shellyID)
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return {items};
    }

    @Component.Expose('StartDiscovery')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async startDiscovery(rawParams: unknown) {
        const {shellyID, duration = 10} =
            validateOrThrow<BthomeStartDiscoveryParams>(
                rawParams,
                BTHOME_START_DISCOVERY_PARAMS_SCHEMA
            );
        const device = getShellyDevice(shellyID);
        return wrapDeviceRpc('BTHome.StartDiscovery', async () => {
            await device.sendRPC('BTHome.StartDeviceDiscovery', {duration});
            return {success: true as const, duration};
        });
    }

    @Component.Expose('Device.AddManual')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async addDeviceManual(rawParams: unknown) {
        const {shellyID, mac, name, productName, modelId} =
            validateOrThrow<BthomeDeviceAddManualParams>(
                rawParams,
                BTHOME_DEVICE_ADD_MANUAL_PARAMS_SCHEMA
            );
        const device = getShellyDevice(shellyID);
        const label = 'BTHome.Device.AddManual';
        try {
            await device.addBTHomeDeviceManual(mac, name, productName, modelId);
            return {success: true as const, alreadyPaired: false};
        } catch (err: any) {
            if (err?.code === -106) {
                return {success: true as const, alreadyPaired: true};
            }
            console.error(
                `${label} failed for shellyID=${shellyID} mac=${mac}:`,
                err
            );
            throw RpcError.DeviceFailed(label, err, shellyID);
        }
    }

    @Component.Expose('Device.Remove')
    @Component.CrudPermission('devices', 'delete', (p) => p?.shellyID)
    async removeDevice(rawParams: unknown) {
        const {shellyID, id} = validateOrThrow<BthomeDeviceRemoveParams>(
            rawParams,
            BTHOME_DEVICE_REMOVE_PARAMS_SCHEMA
        );
        const device = getShellyDevice(shellyID);
        await device.removeBTHomeDevice(id);
        return {success: true as const};
    }

    @Component.Expose('Device.Rename')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async renameDevice(rawParams: unknown) {
        const params = validateOrThrow<BthomeDeviceRenameParams>(
            rawParams,
            BTHOME_DEVICE_RENAME_PARAMS_SCHEMA
        );
        return renameBTHomeEntity(
            'BTHome.Device.Rename',
            'BTHomeDevice.SetConfig',
            params
        );
    }

    @Component.Expose('Device.GetKnownObjects')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getDeviceKnownObjects(rawParams: unknown) {
        const {shellyID, id} =
            validateOrThrow<BthomeDeviceGetKnownObjectsParams>(
                rawParams,
                BTHOME_DEVICE_GET_KNOWN_OBJECTS_PARAMS_SCHEMA
            );
        const device = getShellyDevice(shellyID);
        return wrapDeviceRpc('BTHome.Device.GetKnownObjects', async () => {
            const response = await device.sendRPC(
                'BTHomeDevice.GetKnownObjects',
                {id}
            );
            const rawObjects = Array.isArray(response?.objects)
                ? response.objects
                : [];
            const addr =
                device.config?.[`bthomedevice:${id}`]?.addr ??
                device.config?.[`bthomedevice:${id}`]?.meta?.addr;
            const uniqueObjIds = Array.from(
                new Set<number>(
                    rawObjects
                        .map((obj: any): number | null =>
                            typeof obj?.obj_id === 'number' ? obj.obj_id : null
                        )
                        .filter(
                            (objId: number | null): objId is number =>
                                typeof objId === 'number'
                        )
                )
            );
            let objectInfosById: Record<number, Record<string, any>> = {};

            if (uniqueObjIds.length > 0) {
                try {
                    const infos =
                        await device.getBTHomeObjectInfos(uniqueObjIds);
                    objectInfosById = Object.fromEntries(
                        (infos?.objects ?? [])
                            .filter(
                                (obj: any) => typeof obj?.obj_id === 'number'
                            )
                            .map((obj: any) => [obj.obj_id, obj])
                    );
                } catch {
                    // Best-effort enrichment; local registry remains the fallback.
                }
            }

            const normalizedAddr = typeof addr === 'string' ? addr : undefined;
            return {
                ...response,
                knownObjects: mapBTHomeKnownObjects(
                    device.config,
                    normalizedAddr,
                    rawObjects,
                    objectInfosById
                ),
                objects: mapBTHomeKnownSensorObjects(
                    device.config,
                    normalizedAddr,
                    rawObjects,
                    objectInfosById
                )
            };
        });
    }

    @Component.Expose('Device.SetKey')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setDeviceKey(rawParams: unknown) {
        const {shellyID, id, key} = validateOrThrow<BthomeDeviceSetKeyParams>(
            rawParams,
            BTHOME_DEVICE_SET_KEY_PARAMS_SCHEMA
        );
        const normalizedKey =
            typeof key === 'string' && key.length > 0 ? key : null;
        if (
            normalizedKey !== null &&
            !/^[0-9a-fA-F]{32}$/.test(normalizedKey)
        ) {
            throw RpcError.InvalidParams(
                'key must be a 32-character hexadecimal string (AES-128) or null to clear'
            );
        }
        const device = getShellyDevice(shellyID);
        return wrapDeviceRpc('BTHome.Device.SetKey', async () => {
            await device.sendRPC('BTHomeDevice.SetConfig', {
                id,
                config: {key: normalizedKey}
            });
            return {success: true as const};
        });
    }

    @Component.Expose('Object.ListInfos')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listObjectInfos(rawParams: unknown) {
        const {shellyID, objIds} = validateOrThrow<BthomeObjectListInfosParams>(
            rawParams,
            BTHOME_OBJECT_LIST_INFOS_PARAMS_SCHEMA
        );
        const device = getShellyDevice(shellyID);
        return wrapDeviceRpc('BTHome.Object.ListInfos', () =>
            device.getBTHomeObjectInfos(objIds ?? [])
        );
    }

    @Component.Expose('Sensor.Pair')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async pairSensor(rawParams: unknown) {
        const {shellyID, mac, productName, modelId} =
            validateOrThrow<BthomeSensorPairParams>(
                rawParams,
                BTHOME_SENSOR_PAIR_PARAMS_SCHEMA
            );
        const device = getShellyDevice(shellyID);
        return wrapDeviceRpc('BTHome.Sensor.Pair', async () => {
            const result = await device.pairBTHomeDeviceFully(
                mac,
                productName,
                modelId
            );
            return {success: true as const, ...result};
        });
    }

    @Component.Expose('Sensor.Add')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async addSensor(rawParams: unknown) {
        const {shellyID, id, addr, obj_id, idx, name, meta} =
            validateOrThrow<BthomeSensorAddParams>(
                rawParams,
                BTHOME_SENSOR_ADD_PARAMS_SCHEMA
            );
        const device = getShellyDevice(shellyID);
        const label = 'BTHome.Sensor.Add';
        try {
            await device.addBTHomeSensor(id, addr, obj_id, idx, name, meta);
            return {success: true as const};
        } catch (err: any) {
            console.error(
                `${label} failed for shellyID=${shellyID} id=${id} obj_id=${obj_id} idx=${idx}:`,
                err
            );
            throw RpcError.DeviceFailed(label, err, shellyID);
        }
    }

    @Component.Expose('Sensor.Rename')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async renameSensor(rawParams: unknown) {
        const params = validateOrThrow<BthomeSensorRenameParams>(
            rawParams,
            BTHOME_SENSOR_RENAME_PARAMS_SCHEMA
        );
        return renameBTHomeEntity(
            'BTHome.Sensor.Rename',
            'BTHomeSensor.SetConfig',
            params
        );
    }

    @Component.Expose('Sensor.Delete')
    @Component.CrudPermission('devices', 'delete', (p) => p?.shellyID)
    async deleteSensor(rawParams: unknown) {
        const {shellyID, id} = validateOrThrow<BthomeSensorDeleteParams>(
            rawParams,
            BTHOME_SENSOR_DELETE_PARAMS_SCHEMA
        );
        const device = getShellyDevice(shellyID);
        return wrapDeviceRpc('BTHome.Sensor.Delete', async () => {
            await device.removeBTHomeSensor(id);
            return {success: true as const};
        });
    }

    @Component.Expose('Control.StartLearning')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async startControlLearning(rawParams: unknown) {
        const {shellyID, inputId} =
            validateOrThrow<BthomeControlStartLearningParams>(
                rawParams,
                BTHOME_CONTROL_START_LEARNING_PARAMS_SCHEMA
            );
        const device = getShellyDevice(shellyID);
        return wrapDeviceRpc('BTHome.Control.StartLearning', async () => {
            await device.startBTHomeControlLearning(inputId);
            return {success: true as const};
        });
    }

    @Component.Expose('Control.StopLearning')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async stopControlLearning(rawParams: unknown) {
        const {shellyID} = validateOrThrow<BthomeControlStopLearningParams>(
            rawParams,
            BTHOME_CONTROL_STOP_LEARNING_PARAMS_SCHEMA
        );
        const device = getShellyDevice(shellyID);
        await device.stopBTHomeControlLearning();
        return {success: true as const};
    }

    @Component.Expose('Control.List')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listControls(rawParams: unknown) {
        const {shellyID} = validateOrThrow<BthomeControlListParams>(
            rawParams,
            BTHOME_CONTROL_LIST_PARAMS_SCHEMA
        );
        const device = getShellyDevice(shellyID);
        return wrapDeviceRpc('BTHome.Control.List', async () => {
            const bindings = await device.getBTHomeControls();
            return {bindings};
        });
    }

    @Component.Expose('Control.GetLearningState')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getControlLearningState(rawParams: unknown) {
        const {shellyID} = validateOrThrow<BthomeControlGetLearningStateParams>(
            rawParams,
            BTHOME_CONTROL_GET_LEARNING_STATE_PARAMS_SCHEMA
        );
        const device = getShellyDevice(shellyID);
        return {state: device.getBTHomeLearningState()};
    }

    @Component.Expose('Control.Delete')
    @Component.CrudPermission('devices', 'delete', (p) => p?.shellyID)
    async deleteControl(rawParams: unknown) {
        const {shellyID, id} = validateOrThrow<BthomeControlDeleteParams>(
            rawParams,
            BTHOME_CONTROL_DELETE_PARAMS_SCHEMA
        );
        const device = getShellyDevice(shellyID);
        return wrapDeviceRpc('BTHome.Control.Delete', () =>
            device.sendRPC(
                'BTHomeControl.DeleteAll',
                typeof id === 'number' ? {id} : {}
            )
        );
    }

    // ── Top-level BTHome.* component-interface methods ─────────────

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<BthomeGetConfigParams>(
            params,
            BTHOME_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHome.GetConfig', () =>
            device.sendRPC('BTHome.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<BthomeGetStatusParams>(
            params,
            BTHOME_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHome.GetStatus', () =>
            device.sendRPC('BTHome.GetStatus', {})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<BthomeSetConfigParams>(
            params,
            BTHOME_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHome.SetConfig', () =>
            device.sendRPC('BTHome.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('ResetEncryptionCounter')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async resetEncryptionCounter(params: unknown) {
        const v = validateOrThrow<BthomeResetEncryptionCounterParams>(
            params,
            BTHOME_RESET_ENCRYPTION_COUNTER_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHome.ResetEncryptionCounter', () =>
            device.sendRPC('BTHome.ResetEncryptionCounter', {})
        );
    }

    // ── BTHomeDevice per-component reads/writes ─────────────────────

    @Component.Expose('Device.GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async deviceGetConfig(params: unknown) {
        const v = validateOrThrow<BthomeDeviceGetConfigParams>(
            params,
            BTHOME_DEVICE_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHomeDevice.GetConfig', () =>
            device.sendRPC('BTHomeDevice.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('Device.GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async deviceGetStatus(params: unknown) {
        const v = validateOrThrow<BthomeDeviceGetStatusParams>(
            params,
            BTHOME_DEVICE_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHomeDevice.GetStatus', () =>
            device.sendRPC('BTHomeDevice.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('Device.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async deviceSetConfig(params: unknown) {
        const v = validateOrThrow<BthomeDeviceSetConfigParams>(
            params,
            BTHOME_DEVICE_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHomeDevice.SetConfig', () =>
            device.sendRPC('BTHomeDevice.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    // ── BTHomeSensor per-component reads/writes ─────────────────────

    @Component.Expose('Sensor.GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async sensorGetConfig(params: unknown) {
        const v = validateOrThrow<BthomeSensorGetConfigParams>(
            params,
            BTHOME_SENSOR_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHomeSensor.GetConfig', () =>
            device.sendRPC('BTHomeSensor.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('Sensor.GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async sensorGetStatus(params: unknown) {
        const v = validateOrThrow<BthomeSensorGetStatusParams>(
            params,
            BTHOME_SENSOR_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHomeSensor.GetStatus', () =>
            device.sendRPC('BTHomeSensor.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('Sensor.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async sensorSetConfig(params: unknown) {
        const v = validateOrThrow<BthomeSensorSetConfigParams>(
            params,
            BTHOME_SENSOR_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHomeSensor.SetConfig', () =>
            device.sendRPC('BTHomeSensor.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    // ── BTHomeControl per-component reads/writes ────────────────────

    @Component.Expose('Control.GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async controlGetConfig(params: unknown) {
        const v = validateOrThrow<BthomeControlGetConfigParams>(
            params,
            BTHOME_CONTROL_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHomeControl.GetConfig', () =>
            device.sendRPC('BTHomeControl.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('Control.GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async controlGetStatus(params: unknown) {
        const v = validateOrThrow<BthomeControlGetStatusParams>(
            params,
            BTHOME_CONTROL_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHomeControl.GetStatus', () =>
            device.sendRPC('BTHomeControl.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('Control.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async controlSetConfig(params: unknown) {
        const v = validateOrThrow<BthomeControlSetConfigParams>(
            params,
            BTHOME_CONTROL_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHomeControl.SetConfig', () =>
            device.sendRPC('BTHomeControl.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    @Component.Expose('Control.Create')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async controlCreate(params: unknown) {
        const v = validateOrThrow<BthomeControlCreateParams>(
            params,
            BTHOME_CONTROL_CREATE_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHomeControl.Create', () =>
            device.sendRPC('BTHomeControl.Create', {
                output: v.output,
                inputs: v.inputs
            })
        );
    }

    @Component.Expose('Control.Update')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async controlUpdate(params: unknown) {
        const v = validateOrThrow<BthomeControlUpdateParams>(
            params,
            BTHOME_CONTROL_UPDATE_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHomeControl.Update', () =>
            device.sendRPC('BTHomeControl.Update', {
                id: v.id,
                output: v.output,
                inputs: v.inputs
            })
        );
    }

    @Component.Expose('Control.Enumerate')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async controlEnumerate(params: unknown) {
        const v = validateOrThrow<BthomeControlEnumerateParams>(
            params,
            BTHOME_CONTROL_ENUMERATE_PARAMS_SCHEMA
        );
        const device = getShellyDevice(v.shellyID);
        return wrapDeviceRpc('BTHomeControl.Enumerate', () =>
            device.sendRPC('BTHomeControl.Enumerate', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
