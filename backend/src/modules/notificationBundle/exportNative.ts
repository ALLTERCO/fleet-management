import type {StoredOnCallSchedule} from '../notification/OnCallScheduleStore';
import type {StoredRoutingPolicy} from '../notification/RoutingPolicyStore';
import type {StoredBundleChannel} from './channelModel';
import type {NotificationBundle} from './schema';

export function exportNotificationBundle(input: {
    channels: StoredBundleChannel[];
    routingPolicies: StoredRoutingPolicy[];
    onCallSchedules: StoredOnCallSchedule[];
    exportedAt?: string;
}): NotificationBundle {
    return {
        schema: 'fm.notification.bundle',
        version: 1,
        exportedAt: input.exportedAt ?? new Date().toISOString(),
        channels: input.channels.map(channelToBundle),
        routingPolicies: input.routingPolicies.map(policyToBundle),
        onCallSchedules: input.onCallSchedules.map(scheduleToBundle)
    };
}

function channelToBundle(
    channel: StoredBundleChannel
): Record<string, unknown> {
    return {
        id: String(channel.id),
        name: channel.name,
        type: channel.type,
        config: channel.config
    };
}

function policyToBundle(policy: StoredRoutingPolicy): Record<string, unknown> {
    return {
        id: String(policy.id),
        name: policy.name,
        parentId:
            policy.parentPolicyId == null
                ? null
                : String(policy.parentPolicyId),
        labelMatchers: policy.labelMatchers,
        severityMatchers: policy.severityMatchers,
        resourceSelectors: policy.resourceSelectors,
        contactPoints: policy.contactPoints,
        groupingKeys: policy.groupingKeys,
        muteWindows: policy.muteWindows,
        silences: policy.runtimeSilences,
        inhibitionRules: policy.inhibitionRules,
        escalationStages: policy.escalationStages
    };
}

function scheduleToBundle(
    schedule: StoredOnCallSchedule
): Record<string, unknown> {
    return {
        id: String(schedule.id),
        name: schedule.name,
        timezone: schedule.timezone,
        rotationRules: schedule.rotationRules,
        overrides: schedule.overrides,
        target: schedule.target
    };
}
