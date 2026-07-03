// User notification preferences, on-call schedules, and routing policies.

import {resolveOnCallSchedule} from '../../../modules/notification/OnCallScheduleResolver';
import {
    deleteOnCallSchedule,
    getOnCallSchedule,
    listOnCallSchedules,
    setOnCallSchedule
} from '../../../modules/notification/OnCallScheduleStore';
import {evaluateRoutingPolicies} from '../../../modules/notification/RoutingPolicyEvaluator';
import {
    deleteRoutingPolicy,
    listRoutingPolicies,
    setRoutingPolicy
} from '../../../modules/notification/RoutingPolicyStore';
import {
    listUserNotificationPreferences,
    setUserNotificationPreference
} from '../../../modules/notification/UserNotificationPreferences';
import RpcError from '../../../rpc/RpcError';
import {requireOrganizationId} from '../../../rpc/scope';
import {validateOrThrow} from '../../../rpc/validateOrThrow';
import {
    NOTIFICATION_ON_CALL_DELETE_PARAMS_SCHEMA,
    NOTIFICATION_ON_CALL_LIST_PARAMS_SCHEMA,
    NOTIFICATION_ON_CALL_RESOLVE_PARAMS_SCHEMA,
    NOTIFICATION_ON_CALL_SET_PARAMS_SCHEMA,
    NOTIFICATION_PREFERENCE_LIST_PARAMS_SCHEMA,
    NOTIFICATION_PREFERENCE_SET_PARAMS_SCHEMA,
    NOTIFICATION_ROUTING_DELETE_PARAMS_SCHEMA,
    NOTIFICATION_ROUTING_EVALUATE_PARAMS_SCHEMA,
    NOTIFICATION_ROUTING_LIST_PARAMS_SCHEMA,
    NOTIFICATION_ROUTING_SET_PARAMS_SCHEMA
} from '../../../types/api/notification';
import type CommandSender from '../../CommandSender';
import {requireAuthenticatedUser} from './notificationHandlerContext';

function parseResolveTime(value: string | undefined): Date {
    if (!value) return new Date();
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
        throw RpcError.InvalidParams('Invalid on-call resolve time');
    }
    return new Date(parsed);
}

export async function listPreferences(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{organizationId?: string}>(
        params,
        NOTIFICATION_PREFERENCE_LIST_PARAMS_SCHEMA
    );
    const orgId = requireOrganizationId(sender, p);
    const userId = requireAuthenticatedUser(sender);

    return {
        items: await listUserNotificationPreferences({
            organizationId: orgId,
            userId
        })
    };
}

export async function setPreference(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        channelType: string;
        severityFilters: string[];
        quietHours: Record<string, unknown>;
        digestPreference: Record<string, unknown>;
        disabled: boolean;
    }>(params, NOTIFICATION_PREFERENCE_SET_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    const userId = requireAuthenticatedUser(sender);

    return setUserNotificationPreference({
        organizationId: orgId,
        userId,
        channelType: p.channelType,
        severityFilters: p.severityFilters,
        quietHours: p.quietHours,
        digestPreference: p.digestPreference,
        disabled: p.disabled
    });
}

export async function listOnCall(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        enabledOnly?: boolean;
    }>(params, NOTIFICATION_ON_CALL_LIST_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);

    return {
        items: await listOnCallSchedules({
            organizationId: orgId,
            enabledOnly: p.enabledOnly === true
        })
    };
}

export async function setOnCall(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        scheduleId?: number;
        name: string;
        timezone: string;
        rotationRules: unknown[];
        overrides: unknown[];
        target: Record<string, unknown>;
        enabled?: boolean;
    }>(params, NOTIFICATION_ON_CALL_SET_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);

    return setOnCallSchedule({
        organizationId: orgId,
        scheduleId: p.scheduleId,
        name: p.name,
        timezone: p.timezone,
        rotationRules: p.rotationRules,
        overrides: p.overrides,
        target: p.target,
        enabled: p.enabled !== false
    });
}

export async function deleteOnCall(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        scheduleId: number;
    }>(params, NOTIFICATION_ON_CALL_DELETE_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);

    return {
        deleted: await deleteOnCallSchedule({
            organizationId: orgId,
            scheduleId: p.scheduleId
        })
    };
}

export async function resolveOnCall(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        scheduleId: number;
        at?: string;
    }>(params, NOTIFICATION_ON_CALL_RESOLVE_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    const schedule = await getOnCallSchedule({
        organizationId: orgId,
        scheduleId: p.scheduleId
    });
    if (!schedule) {
        throw RpcError.Domain('ResourceNotFound', {
            message: `On-call schedule ${p.scheduleId} was not found`
        });
    }

    return resolveOnCallSchedule({
        schedule,
        at: parseResolveTime(p.at)
    });
}

export async function listRouting(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        enabledOnly?: boolean;
    }>(params, NOTIFICATION_ROUTING_LIST_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);

    return {
        items: await listRoutingPolicies({
            organizationId: orgId,
            enabledOnly: p.enabledOnly === true
        })
    };
}

export async function setRouting(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        policyId?: number;
        parentPolicyId?: number | null;
        name: string;
        sortOrder?: number;
        labelMatchers: unknown[];
        severityMatchers: string[];
        resourceSelectors: unknown[];
        contactPoints: unknown[];
        groupingKeys: string[];
        muteWindows: unknown[];
        runtimeSilences: unknown[];
        inhibitionRules: unknown[];
        escalationStages: unknown[];
        enabled?: boolean;
    }>(params, NOTIFICATION_ROUTING_SET_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);

    return setRoutingPolicy({
        organizationId: orgId,
        policyId: p.policyId,
        parentPolicyId: p.parentPolicyId,
        name: p.name,
        sortOrder: p.sortOrder ?? 0,
        labelMatchers: p.labelMatchers,
        severityMatchers: p.severityMatchers,
        resourceSelectors: p.resourceSelectors,
        contactPoints: p.contactPoints,
        groupingKeys: p.groupingKeys,
        muteWindows: p.muteWindows,
        runtimeSilences: p.runtimeSilences,
        inhibitionRules: p.inhibitionRules,
        escalationStages: p.escalationStages,
        enabled: p.enabled !== false
    });
}

export async function deleteRouting(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        policyId: number;
    }>(params, NOTIFICATION_ROUTING_DELETE_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);

    return {
        deleted: await deleteRoutingPolicy({
            organizationId: orgId,
            policyId: p.policyId
        })
    };
}

export async function evaluateRouting(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        severity: string;
        labels: Record<string, string>;
        resource?: {type: string; id: string};
    }>(params, NOTIFICATION_ROUTING_EVALUATE_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    const policies = await listRoutingPolicies({
        organizationId: orgId,
        enabledOnly: true
    });

    return {
        matches: evaluateRoutingPolicies({
            policies,
            severity: p.severity,
            labels: p.labels,
            resource: p.resource
        })
    };
}
