import {FLEET_MANAGER_HTTP} from '@/constants';
import {sendRPC} from '@/tools/websocket';

export const PROFILE_PICTURE_FALLBACK =
    '/images/branding/shelly_logo_black.jpg';

export async function getProfilePictureUrl(username: string): Promise<string> {
    if (!username.trim()) return PROFILE_PICTURE_FALLBACK;
    try {
        const res = await sendRPC<{url: string}>(
            'FLEET_MANAGER',
            'User.ProfilePicture.GetUrl',
            {username}
        );
        if (typeof res.url !== 'string' || res.url.length === 0) {
            return PROFILE_PICTURE_FALLBACK;
        }
        return res.url.startsWith('/')
            ? `${FLEET_MANAGER_HTTP}${res.url}`
            : res.url;
    } catch {
        return PROFILE_PICTURE_FALLBACK;
    }
}
