import type {
    VirtualDeviceProfileDto,
    VirtualDeviceVisual
} from '../../types/api/virtualdevice';
import {getProfileById} from './profileRepository';

type ProfileLookup = (
    organizationId: string,
    profileId: string
) => Promise<VirtualDeviceProfileDto | null>;

// Any create-shape that can inherit visual defaults from a profile.
// Both virtualdevice.Create and Extraction.Create satisfy this.
interface ProfileVisualInheritable {
    profileId?: string;
    visual?: VirtualDeviceVisual;
}

// Fills `visual` from the source profile's metadata.defaultVisual when the
// caller didn't supply one. User-supplied visuals win — no merging, so the
// user's deliberate omissions are honored. `lookup` is injected to keep this
// pure for unit tests.
// Convention: an empty defaultVisual object ({}) is treated as "no defaults",
// equivalent to the field being absent. The edit modal writes {} when the
// user clears all picker values; readers must use Object.keys-length, not
// `defaultVisual !== undefined`, to detect "user set defaults".
export async function applyProfileVisualDefaults<
    T extends ProfileVisualInheritable
>(
    organizationId: string,
    params: T,
    lookup: ProfileLookup = getProfileById
): Promise<T> {
    if (!params.profileId) return params;
    if (params.visual && Object.keys(params.visual).length > 0) return params;
    const profile = await lookup(organizationId, params.profileId);
    const defaultVisual = profile?.metadata?.defaultVisual;
    if (!defaultVisual || Object.keys(defaultVisual).length === 0) {
        return params;
    }
    return {...params, visual: defaultVisual};
}
