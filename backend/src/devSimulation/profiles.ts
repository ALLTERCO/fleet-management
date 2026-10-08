import {
    BLU_GATEWAY_GEN2,
    BLU_GATEWAY_GEN3,
    BLU_PROFILES,
    bluAddressTokens
} from './profiles/blu';
import {GEN3_PROFILES} from './profiles/gen3';
import {GEN4_PROFILES} from './profiles/gen4';
import {PLUS_PROFILES} from './profiles/plus';
import {PRO_PROFILES} from './profiles/pro';
import {DEVICE_ID, DEVICE_MAC, DEVICE_NAME} from './profiles/shared';
import {VIRTUAL_PROFILES} from './profiles/virtual';
import type {
    DeviceProfile,
    ExpandedDeviceProfile,
    ExpandProfileOptions,
    JsonObject
} from './types';

export const DEFAULT_COPIES_PER_PROFILE = 2;

export const PROFILE_GROUPS = Object.freeze({
    gen3: Object.freeze([...GEN3_PROFILES, BLU_GATEWAY_GEN3]),
    gen4: GEN4_PROFILES,
    plus: PLUS_PROFILES,
    pro: PRO_PROFILES,
    blu: BLU_PROFILES,
    virtual: VIRTUAL_PROFILES
});

const ALL_PROFILES = Object.freeze([
    ...PROFILE_GROUPS.gen3,
    ...GEN4_PROFILES,
    ...PLUS_PROFILES,
    ...PRO_PROFILES,
    BLU_GATEWAY_GEN2,
    ...VIRTUAL_PROFILES
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

function bluExternalId(address: unknown): string {
    if (typeof address !== 'string') {
        throw new Error('simulated BLU child is missing its address');
    }
    return `blu_${address.replaceAll(':', '').toLowerCase()}`;
}

function isBluChildKey(key: string): boolean {
    return key.startsWith('bthomedevice:') || key.startsWith('blutrv:');
}

export function bluChildDeviceIds(
    profiles: readonly ExpandedDeviceProfile[]
): string[] {
    const ids = profiles.flatMap((profile) =>
        Object.entries(profile.config)
            .filter(([key]) => isBluChildKey(key))
            .map(([, config]) => bluExternalId(config.addr))
    );
    return [...new Set(ids)];
}

function objectValue(value: unknown): JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as JsonObject)
        : {};
}

/** The gateway name goes to config, status and info together: firmware reports
 *  one device name, so a fleet that renames only the config would announce the
 *  factory name on its very first NotifyFullStatus. */
function renameGateway(
    profile: ExpandedDeviceProfile,
    name: string
): ExpandedDeviceProfile {
    const named = (component: JsonObject): JsonObject => ({
        ...component,
        device: {...objectValue(component.device), name}
    });
    return {
        ...profile,
        info: {...profile.info, name},
        config: {...profile.config, sys: named(profile.config.sys ?? {})},
        status: {...profile.status, sys: named(profile.status.sys ?? {})}
    };
}

function renameBluChildren(
    profile: ExpandedDeviceProfile,
    names: Readonly<Record<string, string>>,
    used: Set<string>
): ExpandedDeviceProfile {
    const config: Record<string, JsonObject> = {};
    let renamed = false;
    for (const [key, component] of Object.entries(profile.config)) {
        if (!isBluChildKey(key)) continue;
        const name = names[bluExternalId(component.addr)];
        if (name === undefined) continue;
        used.add(bluExternalId(component.addr));
        config[key] = {...component, name};
        renamed = true;
    }
    return renamed
        ? {...profile, config: {...profile.config, ...config}}
        : profile;
}

export interface NamedProfiles {
    profiles: ExpandedDeviceProfile[];
    /** Keys that matched no device in the fleet, in the order they were given. */
    unknownIds: string[];
}

/** Display names the seeder chose, keyed by the external id `--print-ids` and
 *  `--print-blu-ids` print. A later Sys.SetConfig or BTHomeDevice.SetConfig
 *  merges over these, so an operator rename still wins. */
export function applyDeviceNames(
    profiles: readonly ExpandedDeviceProfile[],
    names: Readonly<Record<string, string>>
): NamedProfiles {
    const used = new Set<string>();
    const named = profiles.map((profile) => {
        const withChildren = renameBluChildren(profile, names, used);
        const gatewayName = names[profile.shellyID];
        if (gatewayName === undefined) return withChildren;
        used.add(profile.shellyID);
        return renameGateway(withChildren, gatewayName);
    });
    return {
        profiles: named,
        unknownIds: Object.keys(names).filter((id) => !used.has(id))
    };
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

const MAX_ORDINAL = 0xfffe;

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

// A repeated key asks for more of that device. Deduplicating here gave every
// profile an equal share of the fleet, so a fixture could not describe five
// villa meters and one gateway — only "one of everything, over and over".
function selectedProfiles(keys: readonly string[]): DeviceProfile[] {
    return keys.map((key) => {
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

    const firstOrdinal = options.firstOrdinal ?? 0;
    const lastOrdinal = firstOrdinal + Math.ceil(count / profiles.length) - 1;
    // The MAC carries ordinal + 1 in four hex digits.
    if (
        !Number.isSafeInteger(firstOrdinal) ||
        firstOrdinal < 0 ||
        lastOrdinal > MAX_ORDINAL
    ) {
        throw new Error(
            `firstOrdinal must keep ordinals within 0..${MAX_ORDINAL}`
        );
    }
    const ordinals = new Map<string, number>();
    return Array.from({length: count}, (_, index) => {
        const profile = profiles[index % profiles.length];
        const ordinal = ordinals.get(profile.key) ?? firstOrdinal;
        ordinals.set(profile.key, ordinal + 1);
        return expandProfile(profile, ordinal);
    });
}
