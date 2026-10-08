// Option sets for location fields. Three tiers:
//   - Canonical (countryCode / currency / timezone / regionCode): validated
//     against ISO sources, no custom allowed.
//   - Env-driven extensible (siteType / roomType / complianceTag / …):
//     defaults from FM_LOCATION_* env vars, custom string accepted
//     subject to the shared enum-value safety regex.
//   - Free-form text (contactRole, buildingCode, …): regex only.

import {envCsv, envOptionalStr} from '../../config/envReader';
import {IANA_TIMEZONES, ISO_COUNTRY_CODES, ISO_CURRENCY_CODES} from './isoData';

/** Keys passed to listKinds() so the frontend knows which option set to show. */
export type ExtensibleOptionSetKey =
    | 'siteType'
    | 'buildingType'
    | 'roomType'
    | 'operationalTier'
    | 'complianceTag'
    | 'accessProcedure'
    | 'regulatoryZone'
    | 'energyCertification'
    | 'contactRole';

/** Safe shape for free-form / custom-added enum values. */
export const ENUM_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9 \-_./]{0,63}$/;

export function isValidEnumValue(value: string): boolean {
    return ENUM_VALUE_RE.test(value);
}

/** Extensible option set defaults — one reader per key so every option
 *  source stays a pure env lookup (deploy-time editable). */
const DEFAULTS: Record<ExtensibleOptionSetKey, readonly string[]> = {
    siteType: [
        'office',
        'warehouse',
        'retail',
        'data-center',
        'manufacturing',
        'hospitality',
        'healthcare',
        'education',
        'residential',
        'common-area',
        'mixed-use',
        // Site / business types — what a place is, not what it consumes.
        // Moved off the device-kind catalog; a combobox so custom is allowed.
        'cinema',
        'theater',
        'concert-hall',
        'casino',
        'nightclub',
        'bowling-alley',
        'arcade',
        'museum',
        'art-gallery',
        'opera-house',
        'planetarium',
        'science-center',
        'place-of-worship',
        'government-office',
        'courthouse',
        'post-office',
        'library',
        'funeral-home',
        'cemetery',
        'military-base',
        'veterinary-clinic',
        'animal-shelter',
        'pet-grooming',
        'zoo',
        'aquarium',
        'cannabis-facility',
        'dispensary',
        'vertical-farm',
        // Everyday commercial + civic places customers classify sites as.
        'bakery',
        'restaurant',
        'cafe',
        'bar',
        'supermarket',
        'grocery-store',
        'convenience-store',
        'shopping-mall',
        'hotel',
        'motel',
        'gym',
        'spa',
        'salon',
        'pharmacy',
        'hospital',
        'clinic',
        'bank',
        'school',
        'university',
        'gas-station',
        'car-wash',
        'auto-repair',
        'parking-garage',
        'stadium',
        'arena',
        'fire-station',
        'police-station',
        'airport',
        'train-station',
        'tv-tower',
        'farm',
        'greenhouse',
        'cold-storage',
        'distribution-center',
        'laundromat'
    ],
    buildingType: [
        'office',
        'warehouse',
        'retail',
        'data-center',
        'manufacturing',
        'hospitality',
        'healthcare',
        'education',
        'residential',
        'common-area',
        'industrial',
        // Common building uses beyond the industrial / office core.
        'mixed-use',
        'hotel',
        'hospital',
        'school',
        'parking'
    ],
    roomType: [
        'office',
        'meeting',
        'server',
        'mechanical',
        'storage',
        'kitchen',
        'bathroom',
        'lobby',
        'cleanroom',
        'lab',
        // Everyday room uses across retail, hospitality, healthcare, homes.
        'reception',
        'waiting-room',
        'break-room',
        'dining',
        'retail-floor',
        'classroom',
        'ward',
        'gym',
        'electrical-room',
        'telecom-room',
        'freezer',
        'cold-room',
        'garage',
        'utility'
    ],
    operationalTier: [
        'critical',
        'production',
        'staging',
        'development',
        'disaster-recovery',
        'decommissioned'
    ],
    complianceTag: [
        'HIPAA',
        'PCI-DSS',
        'SOC1',
        'SOC2',
        'ISO-27001',
        'ISO-9001',
        'ISO-14001',
        'GDPR',
        'GDPR-strict',
        'CCPA',
        'NIS2',
        'SOX',
        'FISMA',
        'FedRAMP',
        'NIST-800-53',
        'NERC-CIP',
        'FDA-regulated',
        'cleanroom',
        // Regional data-protection + regulatory frameworks, by continent.
        // The global standards above (ISO/SOC/PCI) already cover every region;
        // these are the national laws that lead each market.
        'DORA',
        'EIDAS',
        'EN-303645',
        'UK-GDPR',
        'DPA-2018',
        'PSTI',
        'Cyber-Essentials',
        'GLBA',
        'FERPA',
        'PIPEDA',
        'Quebec-Law-25',
        'LGPD',
        'LFPDPPP',
        'UAE-PDPL',
        'Saudi-PDPL',
        'DIFC-DP',
        'NCA-ECC',
        'POPIA',
        'NDPA',
        'Kenya-DPA',
        'PIPL',
        'APPI',
        'PDPA-Singapore',
        'DPDPA',
        'PIPA-Korea',
        'AU-Privacy-Act',
        'NZ-Privacy-Act',
        'Essential-Eight'
    ],
    accessProcedure: [
        'public',
        'badge',
        'key',
        'pin-code',
        'mobile-credential',
        'biometric',
        'appointment-only',
        'visitor-log',
        'escort-required',
        'security-cleared'
    ],
    regulatoryZone: [
        'EU',
        'US',
        'UK',
        'CA',
        'APAC',
        'ANZ',
        'LATAM',
        'MENA',
        'AFRICA',
        'OTHER'
    ],
    energyCertification: [
        'LEED-Platinum',
        'LEED-Gold',
        'LEED-Silver',
        'LEED-Certified',
        'BREEAM-Outstanding',
        'BREEAM-Excellent',
        'BREEAM-Very-Good',
        'BREEAM-Good',
        'DGNB-Platinum',
        'DGNB-Gold',
        'WELL-Platinum',
        'WELL-Gold',
        'WELL-Silver',
        'Energy-Star',
        'ISO-50001',
        'Passive-House',
        'NABERS',
        'EDGE',
        'Green-Star',
        // Regional leaders, by continent. EPC is legally mandatory across the
        // EU and UK, so it is the single most common European rating.
        'EPC',
        'HQE',
        'Minergie',
        'Green-Globes',
        'BOMA-BEST',
        'AQUA-HQE',
        'Selo-Casa-Azul',
        'Estidama-Pearl',
        'GSAS',
        'Mostadam',
        'Green-Star-SA',
        'Green-Mark',
        'China-Three-Star',
        'IGBC',
        'GRIHA',
        'CASBEE',
        'BEAM-Plus',
        'NatHERS',
        'Homestar',
        'none'
    ],
    contactRole: [
        'Facility Manager',
        'Property Manager',
        'Regional Manager',
        'Energy Manager',
        'IT Operations',
        'Security',
        'Maintenance',
        'Electrician',
        'HVAC Technician',
        'Fire Safety Officer',
        'Reception',
        'On-Site Contact',
        'Owner',
        'Tenant',
        'Emergency'
    ]
};

const ENV_KEY: Record<ExtensibleOptionSetKey, string> = {
    siteType: 'FM_LOCATION_SITE_TYPES',
    buildingType: 'FM_LOCATION_BUILDING_TYPES',
    roomType: 'FM_LOCATION_ROOM_TYPES',
    operationalTier: 'FM_LOCATION_OPERATIONAL_TIERS',
    complianceTag: 'FM_LOCATION_COMPLIANCE_TAGS',
    accessProcedure: 'FM_LOCATION_ACCESS_PROCEDURES',
    regulatoryZone: 'FM_LOCATION_REGULATORY_ZONES',
    energyCertification: 'FM_LOCATION_ENERGY_CERTIFICATIONS',
    contactRole: 'FM_LOCATION_CONTACT_ROLES'
};

/** Snapshot of the effective option list for a key. */
export function extensibleOptions(
    key: ExtensibleOptionSetKey
): readonly string[] {
    const envKey = ENV_KEY[key];
    if (envOptionalStr(envKey) === undefined) return DEFAULTS[key];
    return envCsv(envKey, DEFAULTS[key]);
}

/** Descriptor returned via Location.ListKinds so the UI renders
 *  the right picker (combobox vs strict dropdown vs free text). */
export interface OptionSetDescriptor {
    /** Field key on the form. */
    field: string;
    /** 'enum' = strict dropdown, 'combobox' = pick or type, 'iso' = canonical list. */
    kind: 'enum' | 'combobox' | 'iso';
    /** Populated values. For very large ISO lists ('timezone', 'currency'),
     *  the frontend fetches separately via a lightweight RPC — we ship
     *  only the length so the UI can decide. */
    values: readonly string[];
    /** If true, the UI may offer "Add custom" at type time. Custom values
     *  must match ENUM_VALUE_RE on submit. */
    allowCustom: boolean;
    /** True when the field takes an array of values (multi-select). */
    multi: boolean;
}

/** Build the full option-set descriptor map for the frontend. */
export function allOptionSetDescriptors(): Record<string, OptionSetDescriptor> {
    return {
        countryCode: {
            field: 'countryCode',
            kind: 'iso',
            values: ISO_COUNTRY_CODES,
            allowCustom: false,
            multi: false
        },
        currency: {
            field: 'currency',
            kind: 'iso',
            values: ISO_CURRENCY_CODES,
            allowCustom: false,
            multi: false
        },
        timezone: {
            field: 'timezone',
            kind: 'iso',
            values: IANA_TIMEZONES,
            // Custom entry allowed: the picker list omits live aliases (UTC,
            // Asia/Kolkata, Europe/Kyiv) that are valid; isValidTimezone gates.
            allowCustom: true,
            multi: false
        },
        siteType: comboboxFor('siteType', false),
        buildingType: comboboxFor('buildingType', false),
        roomType: comboboxFor('roomType', false),
        operationalTier: comboboxFor('operationalTier', false),
        complianceTag: comboboxFor('complianceTag', true),
        accessProcedure: comboboxFor('accessProcedure', false),
        regulatoryZone: comboboxFor('regulatoryZone', false),
        energyCertification: comboboxFor('energyCertification', false),
        contactRole: comboboxFor('contactRole', false)
    };
}

function comboboxFor(
    key: ExtensibleOptionSetKey,
    multi: boolean
): OptionSetDescriptor {
    return {
        field: key,
        kind: 'combobox',
        values: extensibleOptions(key),
        allowCustom: true,
        multi
    };
}

/** Validate a single value against an extensible option set. */
export function isValidExtensibleValue(
    key: ExtensibleOptionSetKey,
    value: string
): boolean {
    if (extensibleOptions(key).includes(value)) return true;
    // Custom values are allowed but must be safe per ENUM_VALUE_RE.
    return isValidEnumValue(value);
}
