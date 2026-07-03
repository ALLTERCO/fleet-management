import * as log4js from 'log4js';
import {tuning} from '../config';
import {groupPolicy} from '../config/groupPolicy';
import {
    GROUP_MEMBER_SUBJECT_TYPES,
    GROUP_TYPE_LABELS,
    GROUP_TYPES
} from '../types/api/group';
import {
    LOCATION_KIND_LABELS,
    LOCATION_KINDS,
    LOCATION_SUBJECT_TYPES
} from '../types/api/location';
import type {
    OrganizationProfile,
    OrganizationScopeModel
} from '../types/api/organization';
import {TAG_SUBJECT_TYPES} from '../types/api/tag';
import * as postgres from './PostgresProvider';

const logger = log4js.getLogger('organization-model');

interface ProfileRow {
    id: string;
    name: string | null;
    display_name: string | null;
    timezone_default: string | null;
    locale_default: string | null;
    currency_default: string | null;
    unit_system_default: string | null;
    metadata: Record<string, unknown> | null;
}

export function rowToOrganizationProfile(row: ProfileRow): OrganizationProfile {
    return {
        id: row.id,
        name: row.name,
        displayName: row.display_name,
        timezoneDefault: row.timezone_default,
        localeDefault: row.locale_default,
        currencyDefault: row.currency_default,
        unitSystemDefault: normalizeUnitSystem(row.unit_system_default),
        metadata: row.metadata ?? {}
    };
}

function normalizeUnitSystem(
    value: string | null
): 'metric' | 'imperial' | null {
    return value === 'metric' || value === 'imperial' ? value : null;
}

export async function readOrganizationProfile(
    orgId: string
): Promise<OrganizationProfile | null> {
    const result = await postgres.callMethod('organization.fn_profile_get', {
        p_id: orgId
    });
    const row = result?.rows?.[0] as ProfileRow | undefined;
    return row ? rowToOrganizationProfile(row) : null;
}

export async function ensureOrganizationProfile(orgId: string): Promise<void> {
    try {
        await postgres.callMethod('organization.fn_profile_ensure', {
            p_id: orgId,
            p_default_dashboard_name: tuning.dashboard.dashboardName,
            p_default_dashboard_type: tuning.dashboard.dashboardType
        });
    } catch (err) {
        logger.warn('organization.profile lazy-insert failed: %s', err);
    }
}

export async function getOrganizationProfile(
    orgId: string
): Promise<OrganizationProfile> {
    const existing = await readOrganizationProfile(orgId);
    if (existing) return existing;
    await ensureOrganizationProfile(orgId);
    return {
        id: orgId,
        name: null,
        displayName: null,
        timezoneDefault: null,
        localeDefault: null,
        currencyDefault: null,
        unitSystemDefault: null,
        metadata: {}
    };
}

export function buildOrganizationScopeModel(): OrganizationScopeModel {
    const policy = groupPolicy();
    return {
        version: 1,
        locationKinds: LOCATION_KINDS.map((key, i) => ({
            key,
            label: LOCATION_KIND_LABELS[key],
            sortRank: i,
            allowRoot: true
        })),
        groupTypes: GROUP_TYPES.map((key) => ({
            key,
            label: GROUP_TYPE_LABELS[key],
            severityFloorDefault: policy.severityFloorByType[key],
            retentionDaysDefault: policy.retentionDaysByType[key],
            auditRetentionDaysDefault: policy.auditRetentionDaysByType[key]
        })),
        membershipModes: [{key: 'manual', label: 'Manual', enabled: true}],
        groupMemberTypes: [...GROUP_MEMBER_SUBJECT_TYPES],
        tagAssignmentTypes: [...TAG_SUBJECT_TYPES],
        locationAssignmentTypes: [...LOCATION_SUBJECT_TYPES],
        capabilities: {
            customLocationKinds: false,
            dynamicGroups: false,
            nestedGroups: false,
            entityLocationOverride: false
        },
        legacyTransition: {
            canonicalPhysicalScope: 'location',
            canonicalDashboardLocationParam: 'locationId',
            deprecatedDashboardLocationParams: ['siteId'],
            rootGroupImportMode: 'site-only'
        }
    };
}
