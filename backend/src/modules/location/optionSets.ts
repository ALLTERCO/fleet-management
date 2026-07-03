// Option sets for location fields. Three tiers:
//   - Canonical (countryCode / currency / timezone / regionCode): validated
//     against ISO sources, no custom allowed.
//   - Env-driven extensible (siteType / roomType / complianceTag / …):
//     defaults from FM_LOCATION_* env vars, custom string accepted
//     subject to the shared enum-value safety regex.
//   - Free-form text (contactRole, buildingCode, …): regex only.

import {envCsv} from '../../config/envReader';
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
        'vertical-farm'
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
        'industrial'
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
        'lab'
    ],
    operationalTier: ['critical', 'production', 'staging', 'development'],
    complianceTag: [
        'HIPAA',
        'PCI-DSS',
        'SOC2',
        'ISO-27001',
        'GDPR-strict',
        'FDA-regulated',
        'cleanroom'
    ],
    accessProcedure: [
        'public',
        'badge',
        'biometric',
        'escort-required',
        'security-cleared'
    ],
    regulatoryZone: ['EU', 'US', 'UK', 'APAC', 'LATAM', 'MENA', 'OTHER'],
    energyCertification: [
        'LEED-Platinum',
        'LEED-Gold',
        'LEED-Silver',
        'LEED-Certified',
        'BREEAM-Outstanding',
        'BREEAM-Excellent',
        'DGNB-Platinum',
        'DGNB-Gold',
        'none'
    ],
    contactRole: [
        'Facility Manager',
        'IT Operations',
        'Security',
        'Maintenance',
        'Reception',
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
    return envCsv(ENV_KEY[key], DEFAULTS[key]);
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
