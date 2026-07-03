import {PROFILE_PICTURE_FALLBACK} from '@/helpers/profilePicture';

export function versionedProfilePictureUrl(
    url: string,
    version: number
): string {
    if (!url || url === PROFILE_PICTURE_FALLBACK) return url;
    const joiner = url.includes('?') ? '&' : '?';
    return `${url}${joiner}v=${version}`;
}

export function profilePictureFormData(input: {
    file: File;
    username: string;
    ticket: string;
}): FormData {
    const formData = new FormData();
    formData.append('image', input.file);
    formData.append('username', input.username);
    formData.append('ticket', input.ticket);
    return formData;
}
