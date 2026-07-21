import * as DeviceCollector from '../../modules/DeviceCollector';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    CAMERA_ADD_ZONE_SCHEMA,
    CAMERA_CAPTURE_IMAGE_SCHEMA,
    CAMERA_DELETE_ZONE_SCHEMA,
    CAMERA_DESCRIBE,
    CAMERA_GET_CAPABILITIES_SCHEMA,
    CAMERA_GET_CONFIG_PARAMS_SCHEMA,
    CAMERA_GET_STATUS_PARAMS_SCHEMA,
    CAMERA_SET_CONFIG_SCHEMA,
    CAMERA_START_RECORDING_SCHEMA,
    CAMERA_STOP_RECORDING_SCHEMA,
    CAMERA_STORAGE_DELETE_SCHEMA,
    CAMERA_STORAGE_EJECT_SCHEMA,
    CAMERA_STORAGE_FORMAT_SCHEMA,
    CAMERA_STORAGE_GET_CONFIG_SCHEMA,
    CAMERA_STORAGE_GET_STATUS_PARAMS_SCHEMA,
    CAMERA_STORAGE_LIST_SCHEMA,
    CAMERA_STORAGE_SET_CONFIG_SCHEMA,
    CAMERA_STREAMER_ANSWER_PARAMS_SCHEMA,
    CAMERA_STREAMER_OFFER_PARAMS_SCHEMA,
    CAMERA_STREAMER_SET_STREAM_SOURCE_PARAMS_SCHEMA,
    CAMERA_STREAMER_STOP_PARAMS_SCHEMA,
    CAMERA_ZONE_GET_CONFIG_PARAMS_SCHEMA,
    CAMERA_ZONE_GET_STATUS_PARAMS_SCHEMA,
    CAMERA_ZONE_SET_CONFIG_SCHEMA,
    type CameraAddZoneParams,
    type CameraCaptureImageParams,
    type CameraDeleteZoneParams,
    type CameraGetCapabilitiesParams,
    type CameraGetConfigParams,
    type CameraGetStatusParams,
    type CameraSetConfigParams,
    type CameraStartRecordingParams,
    type CameraStopRecordingParams,
    type CameraStorageDeleteParams,
    type CameraStorageEjectParams,
    type CameraStorageFormatParams,
    type CameraStorageGetConfigParams,
    type CameraStorageGetStatusParams,
    type CameraStorageListParams,
    type CameraStorageSetConfigParams,
    type CameraStreamerAnswerParams,
    type CameraStreamerOfferParams,
    type CameraStreamerSetStreamSourceParams,
    type CameraStreamerStopParams,
    type CameraZoneGetConfigParams,
    type CameraZoneGetStatusParams,
    type CameraZoneSetConfigParams
} from '../../types/api/camera';
import Component from './Component';

export default class CameraComponent extends Component {
    constructor() {
        super('camera', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return CAMERA_DESCRIBE;
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

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async cameraSetConfig(params: unknown) {
        const v = validateOrThrow<CameraSetConfigParams>(
            params,
            CAMERA_SET_CONFIG_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Camera.SetConfig', {
            id: v.id,
            config: v.config
        });
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<CameraGetConfigParams>(
            params,
            CAMERA_GET_CONFIG_PARAMS_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Camera.GetConfig', {id: v.id});
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<CameraGetStatusParams>(
            params,
            CAMERA_GET_STATUS_PARAMS_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Camera.GetStatus', {id: v.id});
    }

    @Component.Expose('Zone.GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async zoneGetConfig(params: unknown) {
        const v = validateOrThrow<CameraZoneGetConfigParams>(
            params,
            CAMERA_ZONE_GET_CONFIG_PARAMS_SCHEMA
        );
        return this.callDevice(v.shellyID, 'CameraZone.GetConfig', {id: v.id});
    }

    @Component.Expose('Zone.GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async zoneGetStatus(params: unknown) {
        const v = validateOrThrow<CameraZoneGetStatusParams>(
            params,
            CAMERA_ZONE_GET_STATUS_PARAMS_SCHEMA
        );
        return this.callDevice(v.shellyID, 'CameraZone.GetStatus', {id: v.id});
    }

    @Component.Expose('Storage.GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async storageGetStatus(params: unknown) {
        const v = validateOrThrow<CameraStorageGetStatusParams>(
            params,
            CAMERA_STORAGE_GET_STATUS_PARAMS_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Storage.GetStatus', {
            id: v.id ?? 0
        });
    }

    @Component.Expose('GetCapabilities')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getCapabilities(params: unknown) {
        const v = validateOrThrow<CameraGetCapabilitiesParams>(
            params,
            CAMERA_GET_CAPABILITIES_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Camera.GetCapabilities', {
            id: v.id
        });
    }

    @Component.Expose('CaptureImage')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async captureImage(params: unknown) {
        const v = validateOrThrow<CameraCaptureImageParams>(
            params,
            CAMERA_CAPTURE_IMAGE_SCHEMA
        );
        const p: Record<string, unknown> = {id: v.id};
        if (v.stream !== undefined) p.stream = v.stream;
        return this.callDevice(v.shellyID, 'Camera.CaptureImage', p);
    }

    @Component.Expose('StartRecording')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async startRecording(params: unknown) {
        const v = validateOrThrow<CameraStartRecordingParams>(
            params,
            CAMERA_START_RECORDING_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Camera.StartRecording', {
            id: v.id,
            duration: v.duration,
            stream: v.stream
        });
    }

    @Component.Expose('StopRecording')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async stopRecording(params: unknown) {
        const v = validateOrThrow<CameraStopRecordingParams>(
            params,
            CAMERA_STOP_RECORDING_SCHEMA
        );
        const p: Record<string, unknown> = {id: v.id};
        if (v.rec_id !== undefined) p.rec_id = v.rec_id;
        return this.callDevice(v.shellyID, 'Camera.StopRecording', p);
    }

    @Component.Expose('AddZone')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async addZone(params: unknown) {
        const v = validateOrThrow<CameraAddZoneParams>(
            params,
            CAMERA_ADD_ZONE_SCHEMA
        );
        const payload: Record<string, unknown> = {
            id: v.id,
            enable: v.enable,
            type: v.type,
            coordinates: v.coordinates
        };
        if (v.color !== undefined) payload.color = v.color;
        if (v.name !== undefined) payload.name = v.name;
        return this.callDevice(v.shellyID, 'Camera.AddZone', payload);
    }

    @Component.Expose('DeleteZone')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async deleteZone(params: unknown) {
        const v = validateOrThrow<CameraDeleteZoneParams>(
            params,
            CAMERA_DELETE_ZONE_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Camera.DeleteZone', {
            id: v.id,
            zone_id: v.zone_id
        });
    }

    @Component.Expose('Zone.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async zoneSetConfig(params: unknown) {
        const v = validateOrThrow<CameraZoneSetConfigParams>(
            params,
            CAMERA_ZONE_SET_CONFIG_SCHEMA
        );
        return this.callDevice(v.shellyID, 'CameraZone.SetConfig', {
            id: v.id,
            config: v.config
        });
    }

    @Component.Expose('Storage.List')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async storageList(params: unknown) {
        const v = validateOrThrow<CameraStorageListParams>(
            params,
            CAMERA_STORAGE_LIST_SCHEMA
        );
        const p: Record<string, unknown> = {id: v.id ?? 0};
        if (v.offset !== undefined) p.offset = v.offset;
        return this.callDevice(v.shellyID, 'Storage.List', p);
    }

    @Component.Expose('Storage.Delete')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async storageDelete(params: unknown) {
        const v = validateOrThrow<CameraStorageDeleteParams>(
            params,
            CAMERA_STORAGE_DELETE_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Storage.Delete', {
            id: v.id ?? 0,
            media_id: v.media_id
        });
    }

    @Component.Expose('Storage.Format')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async storageFormat(params: unknown) {
        const v = validateOrThrow<CameraStorageFormatParams>(
            params,
            CAMERA_STORAGE_FORMAT_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Storage.Format', {id: v.id ?? 0});
    }

    @Component.Expose('Storage.Eject')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async storageEject(params: unknown) {
        const v = validateOrThrow<CameraStorageEjectParams>(
            params,
            CAMERA_STORAGE_EJECT_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Storage.Eject', {id: v.id ?? 0});
    }

    @Component.Expose('Storage.GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async storageGetConfig(params: unknown) {
        const v = validateOrThrow<CameraStorageGetConfigParams>(
            params,
            CAMERA_STORAGE_GET_CONFIG_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Storage.GetConfig', {
            id: v.id ?? 0
        });
    }

    @Component.Expose('Storage.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async storageSetConfig(params: unknown) {
        const v = validateOrThrow<CameraStorageSetConfigParams>(
            params,
            CAMERA_STORAGE_SET_CONFIG_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Storage.SetConfig', {
            id: v.id ?? 0,
            config: v.config
        });
    }

    @Component.Expose('Streamer.Offer')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async streamerOffer(params: unknown) {
        const v = validateOrThrow<CameraStreamerOfferParams>(
            params,
            CAMERA_STREAMER_OFFER_PARAMS_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Streamer.Offer', {
            ice_servers: v.ice_servers,
            stream_id: v.stream_id
        });
    }

    @Component.Expose('Streamer.Answer')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async streamerAnswer(params: unknown) {
        const v = validateOrThrow<CameraStreamerAnswerParams>(
            params,
            CAMERA_STREAMER_ANSWER_PARAMS_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Streamer.Answer', {
            session_id: v.session_id,
            sdp: v.sdp,
            candidates: v.candidates,
            end_of_candidates: v.end_of_candidates
        });
    }

    @Component.Expose('Streamer.SetStreamSource')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async streamerSetStreamSource(params: unknown) {
        const v = validateOrThrow<CameraStreamerSetStreamSourceParams>(
            params,
            CAMERA_STREAMER_SET_STREAM_SOURCE_PARAMS_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Streamer.SetStreamSource', {
            session_id: v.session_id,
            stream_id: v.stream_id
        });
    }

    @Component.Expose('Streamer.StopStream')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async streamerStop(params: unknown) {
        const v = validateOrThrow<CameraStreamerStopParams>(
            params,
            CAMERA_STREAMER_STOP_PARAMS_SCHEMA
        );
        return this.callDevice(v.shellyID, 'Streamer.StopStream', {
            session_id: v.session_id
        });
    }
}
