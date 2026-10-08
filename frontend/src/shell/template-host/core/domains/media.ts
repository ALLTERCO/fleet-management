// The Wall Display's media player, and background images.
//
// Not device pictures — those arrive on every device as `logo`. This is real
// audio playback on a display, plus the backgrounds a customer uploads.
//
// `playAlert` and `playRingtone` are separated from `play` because they
// interrupt whatever is playing and are heard by whoever is in the room.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type MediaMethod = Extract<HostMethod, `media.${string}`>;

export type FleetMediaDomain = ReturnType<typeof createMediaDomain>;

export function createMediaDomain(access: FleetRpcAccess) {
    const media = namespaceCaller<MediaMethod>(access);

    return {
        list: (params: HostParams<'media.list'>) => media('media.list', params),
        status: (params: HostParams<'media.getstatus'>) =>
            media('media.getstatus', params),
        /** Read-only: the media component exposes no SetConfig. */
        config: (params: HostParams<'media.getconfig'>) =>
            media('media.getconfig', params),
        /** Chunked upload onto the display's own storage. Keep sending from
         *  the returned offset, then send the final chunk with `last: true`. */
        put: (params: HostParams<'media.putmedia'>) =>
            media('media.putmedia', params),
        /** Removes one stored item from the display. Not a background. */
        delete: (params: HostParams<'media.delete'>) =>
            media('media.delete', params),
        /** Rescans storage after an upload; may ask for a restart. */
        reload: (params: HostParams<'media.reload'>) =>
            media('media.reload', params),
        player: {
            play: (params: HostParams<'media.player.play'>) =>
                media('media.player.play', params),
            pause: (params: HostParams<'media.player.pause'>) =>
                media('media.player.pause', params),
            playOrPause: (params: HostParams<'media.player.playorpause'>) =>
                media('media.player.playorpause', params),
            /** Ends playback. `pause` keeps the position, this does not. */
            stop: (params: HostParams<'media.player.stop'>) =>
                media('media.player.stop', params),
            next: (params: HostParams<'media.player.next'>) =>
                media('media.player.next', params),
            previous: (params: HostParams<'media.player.previous'>) =>
                media('media.player.previous', params),
            /** Interrupts what is playing. Someone in the room hears this. */
            playAlert: (params: HostParams<'media.player.playalert'>) =>
                media('media.player.playalert', params),
            playRingtone: (params: HostParams<'media.player.playringtone'>) =>
                media('media.player.playringtone', params),
            playClip: (params: HostParams<'media.player.playaudioclip'>) =>
                media('media.player.playaudioclip', params)
        },
        volume: {
            up: (params: HostParams<'media.increasevolume'>) =>
                media('media.increasevolume', params),
            down: (params: HostParams<'media.decreasevolume'>) =>
                media('media.decreasevolume', params),
            /** Absolute, 0..10. Heard by whoever is in the room, at once. */
            set: (params: HostParams<'media.setvolume'>) =>
                media('media.setvolume', params)
        },
        /** Internet radio. Its own transport, separate from `player` above. */
        radio: {
            stop: (params: HostParams<'media.radio.stop'>) =>
                media('media.radio.stop', params),
            favourites: (params: HostParams<'media.radio.listfavourites'>) =>
                media('media.radio.listfavourites', params),
            playFavourite: (params: HostParams<'media.radio.playfavourite'>) =>
                media('media.radio.playfavourite', params),
            playNextFavourite: (
                params: HostParams<'media.radio.playnextfavourite'>
            ) => media('media.radio.playnextfavourite', params),
            playPreviousFavourite: (
                params: HostParams<'media.radio.playpreviousfavourite'>
            ) => media('media.radio.playpreviousfavourite', params)
        },
        library: {
            albums: (params: HostParams<'media.listaudioalbums'>) =>
                media('media.listaudioalbums', params),
            artists: (params: HostParams<'media.listaudioartists'>) =>
                media('media.listaudioartists', params)
        },
        /** Customer-uploaded backgrounds, not device product photos. */
        backgrounds: {
            list: (params: HostParams<'media.background.list'>) =>
                media('media.background.list', params),
            uploadTicket: (
                params: HostParams<'media.background.createuploadticket'>
            ) => media('media.background.createuploadticket', params),
            delete: (params: HostParams<'media.background.delete'>) =>
                media('media.background.delete', params)
        },
        /** Images a report embeds. Separate store, separate upload ticket. */
        reportImages: {
            list: (params: HostParams<'media.reportimage.list'>) =>
                media('media.reportimage.list', params),
            uploadTicket: (
                params: HostParams<'media.reportimage.createuploadticket'>
            ) => media('media.reportimage.createuploadticket', params)
        }
    };
}
