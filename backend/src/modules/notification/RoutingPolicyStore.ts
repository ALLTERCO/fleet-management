import {toIso} from '../../rpc/pgRows';
import * as PostgresProvider from '../PostgresProvider';
import {readArray, readStringArray} from './rowReaders';

export interface StoredRoutingPolicy {
    id: number;
    organizationId: string;
    parentPolicyId: number | null;
    name: string;
    sortOrder: number;
    labelMatchers: unknown[];
    severityMatchers: string[];
    resourceSelectors: unknown[];
    contactPoints: unknown[];
    groupingKeys: string[];
    muteWindows: unknown[];
    runtimeSilences: unknown[];
    inhibitionRules: unknown[];
    escalationStages: unknown[];
    enabled: boolean;
    createdAt: string;
    updatedAt: string | null;
}

interface RoutingPolicyRow {
    id: number | string;
    organization_id: string;
    parent_policy_id: number | string | null;
    name: string;
    sort_order: number | string;
    label_matchers: unknown;
    severity_matchers: unknown;
    resource_selectors: unknown;
    contact_points: unknown;
    grouping_keys: unknown;
    mute_windows: unknown;
    runtime_silences: unknown;
    inhibition_rules: unknown;
    escalation_stages: unknown;
    enabled: boolean;
    created_at: Date | string;
    updated_at: Date | string | null;
}

export async function listRoutingPolicies(input: {
    organizationId: string;
    enabledOnly: boolean;
}): Promise<StoredRoutingPolicy[]> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_routing_policy_list',
        {
            p_organization_id: input.organizationId,
            p_enabled_only: input.enabledOnly
        }
    );
    return ((result?.rows ?? []) as RoutingPolicyRow[]).map(rowToPolicy);
}

export async function setRoutingPolicy(input: {
    organizationId: string;
    policyId?: number;
    parentPolicyId?: number | null;
    name: string;
    sortOrder: number;
    labelMatchers: unknown[];
    severityMatchers: string[];
    resourceSelectors: unknown[];
    contactPoints: unknown[];
    groupingKeys: string[];
    muteWindows: unknown[];
    runtimeSilences: unknown[];
    inhibitionRules: unknown[];
    escalationStages: unknown[];
    enabled: boolean;
}): Promise<StoredRoutingPolicy> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_routing_policy_upsert',
        {
            p_organization_id: input.organizationId,
            p_policy_id: input.policyId ?? null,
            p_parent_policy_id: input.parentPolicyId ?? null,
            p_name: input.name,
            p_sort_order: input.sortOrder,
            p_label_matchers: input.labelMatchers,
            p_severity_matchers: input.severityMatchers,
            p_resource_selectors: input.resourceSelectors,
            p_contact_points: input.contactPoints,
            p_grouping_keys: input.groupingKeys,
            p_mute_windows: input.muteWindows,
            p_runtime_silences: input.runtimeSilences,
            p_inhibition_rules: input.inhibitionRules,
            p_escalation_stages: input.escalationStages,
            p_enabled: input.enabled
        }
    );
    const row = result?.rows?.[0] as RoutingPolicyRow | undefined;
    if (!row) throw new Error('routing policy upsert returned no row');
    return rowToPolicy(row);
}

export async function deleteRoutingPolicy(input: {
    organizationId: string;
    policyId: number;
}): Promise<boolean> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_routing_policy_delete',
        {
            p_organization_id: input.organizationId,
            p_policy_id: input.policyId
        }
    );
    return result?.rows?.[0]?.fn_routing_policy_delete === true;
}

function rowToPolicy(row: RoutingPolicyRow): StoredRoutingPolicy {
    return {
        id: Number(row.id),
        organizationId: row.organization_id,
        parentPolicyId:
            row.parent_policy_id == null ? null : Number(row.parent_policy_id),
        name: row.name,
        sortOrder: Number(row.sort_order),
        labelMatchers: readArray(row.label_matchers),
        severityMatchers: readStringArray(row.severity_matchers),
        resourceSelectors: readArray(row.resource_selectors),
        contactPoints: readArray(row.contact_points),
        groupingKeys: readStringArray(row.grouping_keys),
        muteWindows: readArray(row.mute_windows),
        runtimeSilences: readArray(row.runtime_silences),
        inhibitionRules: readArray(row.inhibition_rules),
        escalationStages: readArray(row.escalation_stages),
        enabled: row.enabled,
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
}
