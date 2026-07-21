import {
    BLU_GATEWAY_GEN2,
    BLU_GATEWAY_GEN3,
    BLU_PROFILES,
    bluAddressTokens
} from './profiles/blu';
import {GEN3_PROFILES} from './profiles/gen3';
import {GEN4_PROFILES} from './profiles/gen4';
import {PRO_PROFILES} from './profiles/pro';
import {DEVICE_ID, DEVICE_MAC, DEVICE_NAME} from './profiles/shared';
import type {
    DeviceProfile,
    ExpandedDeviceProfile,
    ExpandProfileOptions
} from './types';

export const DEFAULT_COPIES_PER_PROFILE = 2;

export const PROFILE_GROUPS = Object.freeze({
    gen3: Object.freeze([...GEN3_PROFILES, BLU_GATEWAY_GEN3]),
    gen4: GEN4_PROFILES,
    pro: PRO_PROFILES,
    blu: BLU_PROFILES
});

const ALL_PROFILES = Object.freeze([
    ...PROFILE_GROUPS.gen3,
    ...GEN4_PROFILES,
    ...PRO_PROFILES,
    BLU_GATEWAY_GEN2
]);

function buildCatalog(
    profiles: readonly DeviceProfile[]
): Readonly<Record<string, DeviceProfile>> {
    const catalog: Record<string, DeviceProfile> = {};
    for (const profile of profiles) {
        if (catalog[profile.key]) {
            throw new Error(`duplicate simulator profile: ${profile.key}`);
        }
        catalog[profile.key] = profile;
    }
    return Object.freeze(catalog);
}

export const PROFILE_CATALOG = buildCatalog(ALL_PROFILES);
export const DEFAULT_PROFILE_KEYS = Object.freeze(
    ALL_PROFILES.map((profile) => profile.key)
);

export function bluChildDeviceIds(
    profiles: readonly ExpandedDeviceProfile[]
): string[] {
    const ids = profiles.flatMap((profile) =>
        Object.entries(profile.config)
            .filter(
                ([key]) =>
                    key.startsWith('bthomedevice:') || key.startsWith('blutrv:')
            )
            .map(([, config]) => {
                const address = config.addr;
                if (typeof address !== 'string') {
                    throw new Error(
                        'simulated BLU child is missing its address'
                    );
                }
                return `blu_${address.replaceAll(':', '').toLowerCase()}`;
            })
    );
    return [...new Set(ids)];
}

function replaceTokens(
    value: unknown,
    tokens: Readonly<Record<string, string>>
): unknown {
    if (typeof value === 'string') return tokens[value] ?? value;
    if (Array.isArray(value)) {
        return value.map((entry) => replaceTokens(entry, tokens));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
                key,
                replaceTokens(entry, tokens)
            ])
        );
    }
    return value;
}

function macFor(profile: DeviceProfile, ordinal: number): string {
    const suffix = (ordinal + 1).toString(16).toUpperCase().padStart(4, '0');
    return `${profile.macPrefix}${suffix}`;
}

function expandProfile(
    profile: DeviceProfile,
    ordinal: number
): ExpandedDeviceProfile {
    const mac = macFor(profile, ordinal);
    const shellyID = `${profile.idPrefix}-${mac.toLowerCase()}`;
    const tokens = {
        [DEVICE_ID]: shellyID,
        [DEVICE_MAC]: mac,
        [DEVICE_NAME]: `Simulated ${profile.displayName} ${ordinal + 1}`,
        ...bluAddressTokens(mac)
    };
    const expanded = replaceTokens(profile, tokens) as DeviceProfile;
    return {...expanded, ordinal, shellyID, mac};
}

function selectedProfiles(keys: readonly string[]): DeviceProfile[] {
    const uniqueKeys = [...new Set(keys)];
    return uniqueKeys.map((key) => {
        const profile = PROFILE_CATALOG[key];
        if (!profile) throw new Error(`unknown simulator profile: ${key}`);
        return profile;
    });
}

export function expandDeviceProfiles(
    options: ExpandProfileOptions = {}
): ExpandedDeviceProfile[] {
    const profiles = selectedProfiles(options.profiles ?? DEFAULT_PROFILE_KEYS);
    if (profiles.length === 0) {
        throw new Error('at least one profile is required');
    }
    const count = options.count ?? profiles.length * DEFAULT_COPIES_PER_PROFILE;
    if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error('count must be a positive integer');
    }

    const ordinals = new Map<string, number>();
    return Array.from({length: count}, (_, index) => {
        const profile = profiles[index % profiles.length];
        const ordinal = ordinals.get(profile.key) ?? 0;
        ordinals.set(profile.key, ordinal + 1);
        return expandProfile(profile, ordinal);
    });
}
