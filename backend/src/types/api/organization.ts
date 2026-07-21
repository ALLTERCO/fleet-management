/** Public API types for the `organization.*` namespace. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {METADATA_SCHEMA} from './_shared';
import {ALERT_SEVERITIES, type AlertSeverity} from './alert';
import {GROUP_MEMBER_SUBJECT_TYPES, GROUP_TYPES} from './group';
import {
    LOCATION_KINDS,
    LOCATION_SUBJECT_TYPES,
    type LocationKind
} from './location';
import {TAG_SUBJECT_TYPES} from './tag';

export interface OrganizationProfile {
    id: string;
    name: string | null;
    displayName: string | null;
    timezoneDefault: string | null;
    localeDefault: string | null;
    currencyDefault: string | null;
    unitSystemDefault: 'metric' | 'imperial' | null;
    /** 1-3 letters/digits shown as the sidebar mark; null = product default. */
    brandInitials: string | null;
    /** Palette token key (e.g. 'teal') or #RRGGBB hex; null = default accent. */
    brandColor: string | null;
    metadata: Record<string, unknown>;
}

export interface OrganizationDefaults {
    timezoneDefault: string | null;
    localeDefault: string | null;
}

export interface LocationKindDescriptor {
    key: LocationKind;
    label: string;
    sortRank: number;
    allowRoot: boolean;
}

export interface GroupTypeDescriptor {
    key: (typeof GROUP_TYPES)[number];
    label: string;
    /** Env default for this type. Per-group override: `metadata.policy.severityFloor`. */
    severityFloorDefault: AlertSeverity | null;
    /** Env default for this type. Per-group override: `metadata.policy.retentionDays`. */
    retentionDaysDefault: number | null;
    /** Env default for this type. Per-group override: `metadata.policy.auditRetentionDays`. */
    auditRetentionDaysDefault: number | null;
}

export interface MembershipModeDescriptor {
    key: 'manual';
    label: string;
    enabled: boolean;
}

export interface OrganizationScopeModel {
    version: 1;
    locationKinds: LocationKindDescriptor[];
    groupTypes: GroupTypeDescriptor[];
    membershipModes: MembershipModeDescriptor[];
    groupMemberTypes: Array<(typeof GROUP_MEMBER_SUBJECT_TYPES)[number]>;
    tagAssignmentTypes: Array<(typeof TAG_SUBJECT_TYPES)[number]>;
    locationAssignmentTypes: Array<(typeof LOCATION_SUBJECT_TYPES)[number]>;
    capabilities: {
        customLocationKinds: false;
        dynamicGroups: false;
        nestedGroups: false;
        entityLocationOverride: false;
    };
    legacyTransition: {
        canonicalPhysicalScope: 'location';
        canonicalDashboardLocationParam: 'locationId';
        deprecatedDashboardLocationParams: ['siteId'];
        rootGroupImportMode: 'site-only';
    };
}

// ISO 4217 currency code (three upper-case letters) or null.
const CURRENCY_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    pattern: '^[A-Z]{3}$'
};
const UNIT_SYSTEM_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    enum: ['metric', 'imperial', null]
};
// Sidebar mark: 1-3 letters/digits, or null for the product default.
const BRAND_INITIALS_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    pattern: '^[A-Za-z0-9]{1,3}$'
};
// Palette token key (e.g. 'teal') or #RRGGBB hex — same rule as tag color.
const BRAND_COLOR_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    pattern: '^(#[0-9a-fA-F]{6}|[a-z][a-z0-9_-]{0,63})$'
};

// Exported so system.Bootstrap reuses the exact same org-profile shape instead
// of keeping a second copy that drifts.
export const PROFILE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'name',
        'displayName',
        'timezoneDefault',
        'localeDefault',
        'currencyDefault',
        'unitSystemDefault',
        'brandInitials',
        'brandColor',
        'metadata'
    ],
    properties: {
        id: {type: 'string'},
        name: {type: ['string', 'null']},
        displayName: {type: ['string', 'null']},
        timezoneDefault: {type: ['string', 'null']},
        localeDefault: {type: ['string', 'null']},
        currencyDefault: CURRENCY_SCHEMA,
        unitSystemDefault: UNIT_SYSTEM_SCHEMA,
        brandInitials: BRAND_INITIALS_SCHEMA,
        brandColor: BRAND_COLOR_SCHEMA,
        metadata: METADATA_SCHEMA
    }
};

const DISPLAY_NAME_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    maxLength: 300
};
const TIMEZONE_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    maxLength: 120
};
const LOCALE_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    maxLength: 32
};

const DEFAULTS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['timezoneDefault', 'localeDefault'],
    properties: {
        timezoneDefault: {type: ['string', 'null']},
        localeDefault: {type: ['string', 'null']}
    }
};

const LOCATION_KIND_DESCRIPTOR_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['key', 'label', 'sortRank', 'allowRoot'],
    properties: {
        key: {type: 'string', enum: [...LOCATION_KINDS]},
        label: {type: 'string'},
        sortRank: {type: 'integer'},
        allowRoot: {type: 'boolean'}
    }
};

const GROUP_TYPE_DESCRIPTOR_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'key',
        'label',
        'severityFloorDefault',
        'retentionDaysDefault',
        'auditRetentionDaysDefault'
    ],
    properties: {
        key: {type: 'string', enum: [...GROUP_TYPES]},
        label: {type: 'string'},
        severityFloorDefault: {
            type: ['string', 'null'],
            enum: [...ALERT_SEVERITIES, null]
        },
        retentionDaysDefault: {type: ['integer', 'null'], minimum: 1},
        auditRetentionDaysDefault: {type: ['integer', 'null'], minimum: 1}
    }
};

const MEMBERSHIP_MODE_DESCRIPTOR_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['key', 'label', 'enabled'],
    properties: {
        key: {type: 'string', enum: ['manual']},
        label: {type: 'string'},
        enabled: {type: 'boolean'}
    }
};

const SCOPE_MODEL_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'version',
        'locationKinds',
        'groupTypes',
        'membershipModes',
        'groupMemberTypes',
        'tagAssignmentTypes',
        'locationAssignmentTypes',
        'capabilities',
        'legacyTransition'
    ],
    properties: {
        version: {type: 'integer', enum: [1]},
        locationKinds: {type: 'array', items: LOCATION_KIND_DESCRIPTOR_SCHEMA},
        groupTypes: {type: 'array', items: GROUP_TYPE_DESCRIPTOR_SCHEMA},
        membershipModes: {
            type: 'array',
            items: MEMBERSHIP_MODE_DESCRIPTOR_SCHEMA
        },
        groupMemberTypes: {
            type: 'array',
            items: {type: 'string', enum: [...GROUP_MEMBER_SUBJECT_TYPES]}
        },
        tagAssignmentTypes: {
            type: 'array',
            items: {type: 'string', enum: [...TAG_SUBJECT_TYPES]}
        },
        locationAssignmentTypes: {
            type: 'array',
            items: {type: 'string', enum: [...LOCATION_SUBJECT_TYPES]}
        },
        capabilities: {
            type: 'object',
            required: [
                'customLocationKinds',
                'dynamicGroups',
                'nestedGroups',
                'entityLocationOverride'
            ],
            properties: {
                customLocationKinds: {type: 'boolean'},
                dynamicGroups: {type: 'boolean'},
                nestedGroups: {type: 'boolean'},
                entityLocationOverride: {type: 'boolean'}
            }
        },
        legacyTransition: {
            type: 'object',
            required: [
                'canonicalPhysicalScope',
                'canonicalDashboardLocationParam',
                'deprecatedDashboardLocationParams',
                'rootGroupImportMode'
            ],
            properties: {
                canonicalPhysicalScope: {type: 'string'},
                canonicalDashboardLocationParam: {type: 'string'},
                deprecatedDashboardLocationParams: {
                    type: 'array',
                    items: {type: 'string'}
                },
                rootGroupImportMode: {type: 'string'}
            }
        }
    }
};

const EMPTY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export const ORGANIZATION_GET_PROFILE_PARAMS = EMPTY_PARAMS;
export const ORGANIZATION_GET_DEFAULTS_PARAMS = EMPTY_PARAMS;
export const ORGANIZATION_GET_SCOPE_MODEL_PARAMS = EMPTY_PARAMS;

export const ORGANIZATION_SET_PROFILE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['patch'],
    additionalProperties: false,
    properties: {
        patch: {
            type: 'object',
            additionalProperties: false,
            properties: {
                displayName: DISPLAY_NAME_SCHEMA,
                timezoneDefault: TIMEZONE_SCHEMA,
                localeDefault: LOCALE_SCHEMA,
                currencyDefault: CURRENCY_SCHEMA,
                unitSystemDefault: UNIT_SYSTEM_SCHEMA,
                brandInitials: BRAND_INITIALS_SCHEMA,
                brandColor: BRAND_COLOR_SCHEMA,
                metadata: METADATA_SCHEMA
            }
        }
    }
};

export const ORGANIZATION_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'organization',
    {
        kind: 'fleet-manager',
        description:
            'Read and update the caller organization profile, defaults, and scope model.'
    }
)
    .registerMethod('GetProfile', {
        safety: {operation: 'read'},
        params: ORGANIZATION_GET_PROFILE_PARAMS,
        response: PROFILE_SCHEMA,
        permission: {note: 'authenticated — scoped to caller organization'},
        description: "Return the caller's organization profile."
    })
    .registerMethod('SetProfile', {
        params: ORGANIZATION_SET_PROFILE_PARAMS,
        response: PROFILE_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Partial-update the caller organization profile. Null field = clear.'
    })
    .registerMethod('GetDefaults', {
        safety: {operation: 'read'},
        params: ORGANIZATION_GET_DEFAULTS_PARAMS,
        response: DEFAULTS_SCHEMA,
        permission: {note: 'authenticated — scoped to caller organization'},
        description:
            "Return the caller organization's default timezone + locale."
    })
    .registerMethod('GetScopeModel', {
        safety: {operation: 'read'},
        params: ORGANIZATION_GET_SCOPE_MODEL_PARAMS,
        response: SCOPE_MODEL_SCHEMA,
        permission: {note: 'authenticated'},
        description:
            'Single source of truth for frontend form construction — location kinds, group types, membership modes, subject-type enums, phase-1 capabilities, and legacy-transition flags.'
    })
    .build();
