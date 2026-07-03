import * as DeviceCollector from '../../modules/DeviceCollector';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    PRESENCE_ADD_ZONE_SCHEMA,
    PRESENCE_DELETE_ZONE_SCHEMA,
    PRESENCE_DESCRIBE,
    PRESENCE_GET_CONFIG_SCHEMA,
    PRESENCE_GET_STATUS_SCHEMA,
    PRESENCE_LIVE_TRACK_SCHEMA,
    PRESENCE_SET_CONFIG_SCHEMA,
    PRESENCE_SET_SENSOR_SCHEMA,
    PRESENCE_TILT_CALIBRATE_SCHEMA,
    PRESENCE_ZONE_SET_CONFIG_SCHEMA,
    type PresenceAddZoneParams,
    type PresenceDeleteZoneParams,
    type PresenceGetConfigParams,
    type PresenceGetStatusParams,
    type PresenceLiveTrackParams,
    type PresenceSetConfigParams,
    type PresenceSetSensorParams,
    type PresenceTiltCalibrateParams,
    type PresenceZoneSetConfigParams
} from '../../types/api/presence';
import Component from './Component';

export default class PresenceComponent extends Component {
    constructor() {
        super('presence', {
            set_config_methods: false,
            auto_apply_config: false,
            // Presence.mdx → Notifications. Notification-only.
            events: [
                {
                    event: 'track',
                    attrs: [
                        {
                            name: 'object',
                            type: 'array',
                            desc: 'Objects: id, x, y, z, minz, maxz'
                        }
                    ]
                },
                {event: 'no_track'}
            ]
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return PRESENCE_DESCRIBE;
    }

    private async callDevice<T>(
        shellyID: string,
        method: string,
        params: Record<string, unknown>
    ): Promise<T> {
        const device = DeviceCollector.getDevice(shellyID);
        if (!device) throw RpcError.DeviceNotFound();
        try {
            return (await device.sendRPC(method, params)) as T;
        } catch (err: unknown) {
            throw RpcError.DeviceFailed(method, err, shellyID);
        }
    }

    @Component.Expose('LiveTrack')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async liveTrack(params: unknown) {
        const v = validateOrThrow<PresenceLiveTrackParams>(
            params,
            PRESENCE_LIVE_TRACK_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Presence.LiveTrack', {});
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async presenceSetConfig(params: unknown) {
        const v = validateOrThrow<PresenceSetConfigParams>(
            params,
            PRESENCE_SET_CONFIG_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Presence.SetConfig', {
            config: v.config
        });
    }

    @Component.Expose('SetSensor')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setSensor(params: unknown) {
        const v = validateOrThrow<PresenceSetSensorParams>(
            params,
            PRESENCE_SET_SENSOR_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Presence.SetSensor', {
            enable: v.enable
        });
    }

    @Component.Expose('AddZone')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async addZone(params: unknown) {
        const v = validateOrThrow<PresenceAddZoneParams>(
            params,
            PRESENCE_ADD_ZONE_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Presence.AddZone', {
            config: v.config
        });
    }

    @Component.Expose('DeleteZone')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async deleteZone(params: unknown) {
        const v = validateOrThrow<PresenceDeleteZoneParams>(
            params,
            PRESENCE_DELETE_ZONE_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Presence.DeleteZone', {id: v.id});
    }

    @Component.Expose('Zone.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async zoneSetConfig(params: unknown) {
        const v = validateOrThrow<PresenceZoneSetConfigParams>(
            params,
            PRESENCE_ZONE_SET_CONFIG_SCHEMA
        );
        return this.callDevice(v.shellyID, 'PresenceZone.SetConfig', {
            id: v.id,
            config: v.config
        });
    }

    @Component.Expose('TiltCalibrate')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async tiltCalibrate(params: unknown) {
        const v = validateOrThrow<PresenceTiltCalibrateParams>(
            params,
            PRESENCE_TILT_CALIBRATE_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Presence.TiltCalibrate', {});
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<PresenceGetConfigParams>(
            params,
            PRESENCE_GET_CONFIG_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Presence.GetConfig', {});
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<PresenceGetStatusParams>(
            params,
            PRESENCE_GET_STATUS_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Presence.GetStatus', {});
    }
}
