import {tuning} from '../../config/tuning';
import {
    deleteBackground,
    listBackgrounds,
    listReportImages,
    MediaAssetNotFoundError,
    MediaAssetPermissionError,
    MediaAssetValidationError
} from '../../modules/mediaAssetLibrary';
import {
    issueUploadTicket,
    uploadTicketResponse,
    uploadTicketUserFromSender
} from '../../modules/uploadTickets';
import {appendUploadAssetToken} from '../../modules/web/utils/uploadAssetTokens';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    MEDIA_BACKGROUND_DELETE_PARAMS_SCHEMA,
    MEDIA_DELETE_PARAMS_SCHEMA,
    MEDIA_DESCRIBE,
    MEDIA_LIST_PARAMS_SCHEMA,
    MEDIA_PLAYER_PLAY_AUDIO_CLIP_PARAMS_SCHEMA,
    MEDIA_PLAYER_PLAY_RINGTONE_PARAMS_SCHEMA,
    MEDIA_PLAYER_WITH_ID_PARAMS_SCHEMA,
    MEDIA_PUT_MEDIA_PARAMS_SCHEMA,
    MEDIA_RADIO_LIST_FAVOURITES_PARAMS_SCHEMA,
    MEDIA_RADIO_PLAY_FAVOURITE_PARAMS_SCHEMA,
    MEDIA_RELOAD_PARAMS_SCHEMA,
    MEDIA_SET_VOLUME_PARAMS_SCHEMA,
    MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    type MediaDeleteParams,
    type MediaListParams,
    type MediaPlayerPlayAudioClipParams,
    type MediaPlayerPlayRingtoneParams,
    type MediaPlayerWithIdParams,
    type MediaPutMediaParams,
    type MediaRadioListFavouritesParams,
    type MediaRadioPlayFavouriteParams,
    type MediaReloadParams,
    type MediaSetVolumeParams,
    type MediaShellyOnlyParams
} from '../../types/api/media';
import {EMPTY_PARAMS_SCHEMA} from '../../types/api/upload';
import type CommandSender from '../CommandSender';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import {
    canManageSharedMediaAssets,
    canViewSharedMediaAssets
} from './authzPermissions';
import Component from './Component';

function _requireId(id?: number): number {
    if (typeof id !== 'number') {
        throw RpcError.InvalidParams(
            'Expected { shellyID: string, id: number }'
        );
    }
    return id;
}

function mediaAssetUserFromSender(sender: CommandSender) {
    return {
        organizationId: sender.getOrganizationId(),
        group: sender.getGroup(),
        roles: sender.getRoles()
    };
}

function mediaAssetErrorToRpc(err: unknown): RpcError {
    if (err instanceof MediaAssetValidationError) {
        return RpcError.InvalidParams(err.message);
    }
    if (err instanceof MediaAssetPermissionError) {
        return RpcError.Unauthorized();
    }
    if (err instanceof MediaAssetNotFoundError) {
        return RpcError.NotFound('background');
    }
    return RpcError.OperationFailed('media asset operation', err);
}

function signMediaImageList(
    kind: 'background' | 'reportImage',
    list: {thumbnails: string[]; originals: string[]}
) {
    const ttlSec = tuning.upload.assetUrlTtlSec;
    return {
        thumbnails: list.thumbnails.map((file) =>
            appendUploadAssetToken(kind, file, ttlSec)
        ),
        originals: list.originals.map((file) =>
            appendUploadAssetToken(kind, file, ttlSec)
        )
    };
}

export default class MediaComponent extends Component<any> {
    constructor() {
        super('media', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return MEDIA_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('Background.List')
    @Component.CheckPermissions(canViewSharedMediaAssets)
    async backgroundList(params: unknown, sender: CommandSender) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            EMPTY_PARAMS_SCHEMA
        );
        const list = await listBackgrounds(mediaAssetUserFromSender(sender));
        return signMediaImageList('background', list);
    }

    @Component.NoAudit
    @Component.Expose('Background.CreateUploadTicket')
    @Component.CheckPermissions(canManageSharedMediaAssets)
    async backgroundCreateUploadTicket(params: unknown, sender: CommandSender) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            EMPTY_PARAMS_SCHEMA
        );
        return uploadTicketResponse(
            await issueUploadTicket({
                kind: 'background',
                user: uploadTicketUserFromSender(sender)
            })
        );
    }

    @Component.Expose('Background.Delete')
    @Component.CheckPermissions(canManageSharedMediaAssets)
    async backgroundDelete(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{fileName: string}>(
            params,
            MEDIA_BACKGROUND_DELETE_PARAMS_SCHEMA
        );
        try {
            return await deleteBackground(
                mediaAssetUserFromSender(sender),
                p.fileName
            );
        } catch (err) {
            throw mediaAssetErrorToRpc(err);
        }
    }

    @Component.NoAudit
    @Component.Expose('ReportImage.List')
    @Component.CheckPermissions(canViewSharedMediaAssets)
    async reportImageList(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            EMPTY_PARAMS_SCHEMA
        );
        const list = await listReportImages();
        return signMediaImageList('reportImage', list);
    }

    @Component.NoAudit
    @Component.Expose('ReportImage.CreateUploadTicket')
    @Component.CheckPermissions(canManageSharedMediaAssets)
    async reportImageCreateUploadTicket(
        params: unknown,
        sender: CommandSender
    ) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            EMPTY_PARAMS_SCHEMA
        );
        return uploadTicketResponse(
            await issueUploadTicket({
                kind: 'report_image',
                user: uploadTicketUserFromSender(sender)
            })
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.GetConfig', () =>
            device.sendRPC('Media.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.GetStatus', () =>
            device.sendRPC('Media.GetStatus', {})
        );
    }

    @Component.Expose('SetVolume')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async setVolume(params: unknown) {
        const v = validateOrThrow<MediaSetVolumeParams>(
            params,
            MEDIA_SET_VOLUME_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.SetVolume', () =>
            device.sendRPC('Media.SetVolume', {volume: v.volume})
        );
    }

    @Component.Expose('IncreaseVolume')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async increaseVolume(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.IncreaseVolume', () =>
            device.sendRPC('Media.IncreaseVolume', {})
        );
    }

    @Component.Expose('DecreaseVolume')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async decreaseVolume(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.DecreaseVolume', () =>
            device.sendRPC('Media.DecreaseVolume', {})
        );
    }

    @Component.Expose('Player.Play')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async play(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Player.Play', () =>
            device.sendRPC('Media.MediaPlayer.Play', {})
        );
    }

    @Component.Expose('Player.Pause')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async pause(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Player.Pause', () =>
            device.sendRPC('Media.MediaPlayer.Pause', {})
        );
    }

    @Component.Expose('Player.PlayOrPause')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async playOrPause(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Player.PlayOrPause', () =>
            device.sendRPC('Media.MediaPlayer.PlayOrPause', {})
        );
    }

    @Component.Expose('Player.Stop')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async stop(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Player.Stop', () =>
            device.sendRPC('Media.MediaPlayer.Stop', {})
        );
    }

    @Component.Expose('Player.Next')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async next(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Player.Next', () =>
            device.sendRPC('Media.MediaPlayer.Next', {})
        );
    }

    @Component.Expose('Player.Previous')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async previous(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Player.Previous', () =>
            device.sendRPC('Media.MediaPlayer.Previous', {})
        );
    }

    @Component.Expose('ListAudioAlbums')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listAudioAlbums(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.ListAudioAlbums', () =>
            device.sendRPC('Media.ListAudioAlbums', {})
        );
    }

    @Component.Expose('ListAudioArtists')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listAudioArtists(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.ListAudioArtists', () =>
            device.sendRPC('Media.ListAudioArtists', {})
        );
    }

    @Component.Expose('Radio.Stop')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async radioStop(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Radio.Stop', () =>
            device.sendRPC('Media.Radio.Stop', {})
        );
    }

    @Component.Expose('Radio.PlayNextFavourite')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async radioNext(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Radio.PlayNextFavourite', () =>
            device.sendRPC('Media.Radio.PlayNextFavourite', {})
        );
    }

    @Component.Expose('Radio.PlayPreviousFavourite')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async radioPrevious(params: unknown) {
        const v = validateOrThrow<MediaShellyOnlyParams>(
            params,
            MEDIA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Radio.PlayPreviousFavourite', () =>
            device.sendRPC('Media.Radio.PlayPreviousFavourite', {})
        );
    }

    @Component.Expose('PutMedia')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async putMedia(params: unknown) {
        const v = validateOrThrow<MediaPutMediaParams>(
            params,
            MEDIA_PUT_MEDIA_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {filename: v.filename};
        if (v.data !== undefined) payload.data = v.data;
        if (v.offset !== undefined) payload.offset = v.offset;
        if (v.last !== undefined) payload.last = v.last;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.PutMedia', () =>
            device.sendRPC('Media.PutMedia', payload)
        );
    }

    @Component.Expose('Player.PlayAlert')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async playAlert(params: unknown) {
        const v = validateOrThrow<MediaPlayerWithIdParams>(
            params,
            MEDIA_PLAYER_WITH_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Player.PlayAlert', () =>
            device.sendRPC('Media.MediaPlayer.PlayAlert', {id: v.id})
        );
    }

    @Component.Expose('Radio.PlayFavourite')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async playFavourite(params: unknown) {
        const v = validateOrThrow<MediaRadioPlayFavouriteParams>(
            params,
            MEDIA_RADIO_PLAY_FAVOURITE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Radio.PlayFavourite', () =>
            device.sendRPC('Media.Radio.PlayFavourite', {id: v.id})
        );
    }

    @Component.Expose('Radio.ListFavourites')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listFavourites(params: unknown) {
        const v = validateOrThrow<MediaRadioListFavouritesParams>(
            params,
            MEDIA_RADIO_LIST_FAVOURITES_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Radio.ListFavourites', () =>
            device.sendRPC('Media.Radio.ListFavourites', {})
        );
    }

    @Component.Expose('Player.PlayRingtone')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async playRingtone(params: unknown) {
        const v = validateOrThrow<MediaPlayerPlayRingtoneParams>(
            params,
            MEDIA_PLAYER_PLAY_RINGTONE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Player.PlayRingtone', () =>
            device.sendRPC('Media.MediaPlayer.PlayRingtone', {id: v.id})
        );
    }

    @Component.Expose('Player.PlayAudioClip')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async playAudioClip(params: unknown) {
        const v = validateOrThrow<MediaPlayerPlayAudioClipParams>(
            params,
            MEDIA_PLAYER_PLAY_AUDIO_CLIP_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Player.PlayAudioClip', () =>
            device.sendRPC('Media.MediaPlayer.PlayAudioClip', {id: v.id})
        );
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async deleteMedia(params: unknown) {
        const v = validateOrThrow<MediaDeleteParams>(
            params,
            MEDIA_DELETE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Delete', () =>
            device.sendRPC('Media.Delete', {id: v.id})
        );
    }

    @Component.Expose('Reload')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async reload(params: unknown) {
        const v = validateOrThrow<MediaReloadParams>(
            params,
            MEDIA_RELOAD_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {};
        if (v.name !== undefined) payload.name = v.name;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.Reload', () =>
            device.sendRPC('Media.Reload', payload)
        );
    }

    @Component.Expose('List')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async list(params: unknown) {
        const v = validateOrThrow<MediaListParams>(
            params,
            MEDIA_LIST_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Media.List', () =>
            device.sendRPC('Media.List', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
