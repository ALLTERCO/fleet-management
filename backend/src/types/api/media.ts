import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';
import {EMPTY_PARAMS_SCHEMA, UPLOAD_TICKET_RESPONSE_SCHEMA} from './upload';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {
    type: 'integer',
    minimum: 0,
    description: 'Media item or favourite index'
};
const P_SHELLY_ONLY: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};
const P_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response'
};
const IMAGE_LIST_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['thumbnails', 'displays', 'originals'],
    additionalProperties: false,
    properties: {
        thumbnails: {type: 'array', items: {type: 'string', minLength: 1}},
        displays: {type: 'array', items: {type: 'string', minLength: 1}},
        originals: {type: 'array', items: {type: 'string', minLength: 1}}
    }
};
export const MEDIA_BACKGROUND_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['fileName'],
    additionalProperties: false,
    properties: {fileName: {type: 'string', minLength: 1}}
};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

export interface MediaShellyOnlyParams {
    shellyID: string;
}
export const MEDIA_SHELLY_ONLY_PARAMS_SCHEMA: JsonSchema = P_SHELLY_ONLY;

export interface MediaSetVolumeParams {
    shellyID: string;
    volume: number;
}
export const MEDIA_SET_VOLUME_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'volume'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        volume: {type: 'integer', minimum: 0, maximum: 10}
    }
};

export interface MediaPutMediaParams {
    shellyID: string;
    filename: string;
    data?: string;
    offset?: number;
    last?: boolean;
}
export const MEDIA_PUT_MEDIA_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'filename'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        filename: {type: 'string', minLength: 1, maxLength: 256},
        data: {type: 'string'},
        offset: {type: 'integer', minimum: 0},
        last: {type: 'boolean'}
    }
};

export interface MediaReloadParams {
    shellyID: string;
    name?: string;
}
export const MEDIA_RELOAD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        name: {type: 'string', minLength: 1, maxLength: 256}
    }
};

export interface MediaPlayerWithIdParams {
    shellyID: string;
    id: number;
}
export const MEDIA_PLAYER_WITH_ID_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: {type: 'integer', minimum: 0}
    }
};

export interface MediaDeleteParams {
    shellyID: string;
    id: number;
}
export const MEDIA_DELETE_PARAMS_SCHEMA = MEDIA_PLAYER_WITH_ID_PARAMS_SCHEMA;

export interface MediaListParams {
    shellyID: string;
}
export const MEDIA_LIST_PARAMS_SCHEMA = MEDIA_SHELLY_ONLY_PARAMS_SCHEMA;

export interface MediaRadioPlayFavouriteParams {
    shellyID: string;
    id: number;
}
export const MEDIA_RADIO_PLAY_FAVOURITE_PARAMS_SCHEMA =
    MEDIA_PLAYER_WITH_ID_PARAMS_SCHEMA;

export interface MediaRadioListFavouritesParams {
    shellyID: string;
}
export const MEDIA_RADIO_LIST_FAVOURITES_PARAMS_SCHEMA =
    MEDIA_SHELLY_ONLY_PARAMS_SCHEMA;

export interface MediaPlayerPlayRingtoneParams {
    shellyID: string;
    id: number;
}
export const MEDIA_PLAYER_PLAY_RINGTONE_PARAMS_SCHEMA =
    MEDIA_PLAYER_WITH_ID_PARAMS_SCHEMA;

export interface MediaPlayerPlayAudioClipParams {
    shellyID: string;
    id: number;
}
export const MEDIA_PLAYER_PLAY_AUDIO_CLIP_PARAMS_SCHEMA =
    MEDIA_PLAYER_WITH_ID_PARAMS_SCHEMA;

const b = new DescribeBuilder('media', {
    kind: 'device',
    description:
        'Relay media playback, volume, radio, and library control to a Shelly device.'
});

b.registerMethod('Background.List', {
    params: EMPTY_PARAMS_SCHEMA,
    response: IMAGE_LIST_RESPONSE,
    permission: {note: 'authenticated'},
    description: 'List visible background images with signed asset URLs.'
});
b.registerMethod('Background.CreateUploadTicket', {
    params: EMPTY_PARAMS_SCHEMA,
    response: UPLOAD_TICKET_RESPONSE_SCHEMA,
    permission: {note: 'admin-only'},
    description: 'Mint a short-lived ticket for POST /media/uploadBackground.'
});
b.registerMethod('Background.Delete', {
    params: MEDIA_BACKGROUND_DELETE_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['success'],
        additionalProperties: false,
        properties: {success: {type: 'boolean'}}
    },
    permission: {note: 'admin-only'},
    description: 'Delete a visible background image.'
});
b.registerMethod('ReportImage.List', {
    params: EMPTY_PARAMS_SCHEMA,
    response: IMAGE_LIST_RESPONSE,
    permission: {note: 'authenticated'},
    description: 'List report images with signed asset URLs.'
});
b.registerMethod('ReportImage.CreateUploadTicket', {
    params: EMPTY_PARAMS_SCHEMA,
    response: UPLOAD_TICKET_RESPONSE_SCHEMA,
    permission: {note: 'admin-only'},
    description: 'Mint a short-lived ticket for POST /media/uploadReportImage.'
});
b.registerMethod('GetConfig', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Media.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Media.GetStatus — playback state, volume, item counts.'
});
b.registerMethod('SetVolume', {
    params: MEDIA_SET_VOLUME_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.SetVolume — 0..10.'
});
b.registerMethod('IncreaseVolume', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.IncreaseVolume.'
});
b.registerMethod('DecreaseVolume', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.DecreaseVolume.'
});
b.registerMethod('Player.Play', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.MediaPlayer.Play.'
});
b.registerMethod('Player.Pause', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.MediaPlayer.Pause.'
});
b.registerMethod('Player.PlayOrPause', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.MediaPlayer.PlayOrPause.'
});
b.registerMethod('Player.Stop', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.MediaPlayer.Stop.'
});
b.registerMethod('Player.Next', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.MediaPlayer.Next.'
});
b.registerMethod('Player.Previous', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.MediaPlayer.Previous.'
});
b.registerMethod('ListAudioAlbums', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: {type: 'object', properties: {list: {type: 'array'}}},
    permission: PERM_READ,
    description: 'Media.ListAudioAlbums.'
});
b.registerMethod('ListAudioArtists', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: {type: 'object', properties: {list: {type: 'array'}}},
    permission: PERM_READ,
    description: 'Media.ListAudioArtists.'
});
b.registerMethod('Radio.Stop', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.Radio.Stop.'
});
b.registerMethod('Radio.PlayNextFavourite', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.Radio.PlayNextFavourite.'
});
b.registerMethod('Radio.PlayPreviousFavourite', {
    params: MEDIA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.Radio.PlayPreviousFavourite.'
});
b.registerMethod('PutMedia', {
    params: MEDIA_PUT_MEDIA_PARAMS_SCHEMA,
    response: {
        type: 'object',
        properties: {
            restart_required: {type: 'boolean'},
            offset: {type: 'integer'}
        }
    },
    permission: PERM_UPDATE,
    description:
        'Media.PutMedia — chunked upload, returns next offset and restart_required.'
});
b.registerMethod('Player.PlayAlert', {
    params: MEDIA_PLAYER_WITH_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.MediaPlayer.PlayAlert.'
});

b.registerMethod('Radio.PlayFavourite', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.Radio.PlayFavourite.'
});
b.registerMethod('Radio.ListFavourites', {
    params: P_SHELLY_ONLY,
    response: {type: 'object', properties: {list: {type: 'array'}}},
    permission: PERM_READ,
    description: 'Media.Radio.ListFavourites.'
});
b.registerMethod('Player.PlayRingtone', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.MediaPlayer.PlayRingtone.'
});
b.registerMethod('Player.PlayAudioClip', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Media.MediaPlayer.PlayAudioClip.'
});
b.registerMethod('Delete', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Media.Delete.'
});
b.registerMethod('Reload', {
    params: MEDIA_RELOAD_PARAMS_SCHEMA,
    response: {
        type: 'object',
        properties: {restart_required: {type: 'boolean'}}
    },
    permission: PERM_EXECUTE,
    description:
        'Media.Reload — rescan storage; optional `name` filters to one item.'
});
b.registerMethod('List', {
    params: P_SHELLY_ONLY,
    response: {
        type: 'object',
        properties: {list: {type: 'array'}, items: {type: 'array'}},
        description:
            'Frontend reads {list} or {items}; device firmware may return either.'
    },
    permission: PERM_READ,
    description: 'Media.List.'
});
export const MEDIA_DESCRIBE: DescribeOutput = b.build();
