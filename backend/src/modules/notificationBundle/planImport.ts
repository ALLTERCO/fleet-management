import type {StoredOnCallSchedule} from '../notification/OnCallScheduleStore';
import type {StoredRoutingPolicy} from '../notification/RoutingPolicyStore';
import type {ImportMappingResult} from '../virtualDeviceAlerts';
import {readKey, readName, readObjects, readString} from './bundleReaders';
import type {StoredBundleChannel} from './channelModel';
import {type NotificationBundle, validateNotificationBundle} from './schema';
import {
    collectVirtualBundleSelectors,
    virtualSelectorConflicts
} from './virtualSelectors';

export type BundleImportAction = 'create' | 'update' | 'unsupported';

export interface BundleImportConflict {
    path: string;
    message: string;
}

export interface BundleImportWarning {
    path: string;
    message: string;
}

export interface BundleImportOperation {
    resourceType: 'routing_policy' | 'on_call_schedule' | 'channel';
    key: string;
    action: BundleImportAction;
    message: string;
    conflicts: BundleImportConflict[];
    requiresSecretMapping: boolean;
    mappingKeys: string[];
}

export function planNotificationBundleImport(input: {
    bundle: unknown;
    existingChannels?: StoredBundleChannel[];
    existingRoutingPolicies: StoredRoutingPolicy[];
    existingOnCallSchedules: StoredOnCallSchedule[];
    channelMappings?: Record<string, number>;
    virtualSubjectMappings?: Record<string, ImportMappingResult>;
}): {
    bundle: NotificationBundle;
    operations: BundleImportOperation[];
    warnings: BundleImportWarning[];
    conflicts: BundleImportConflict[];
} {
    const bundle = validateNotificationBundle(input.bundle);
    const conflicts = collectBundleConflicts(
        bundle,
        input.virtualSubjectMappings ?? {}
    );
    return {
        bundle,
        warnings: [],
        conflicts,
        operations: [
            ...planChannels(bundle, {
                existingChannels: input.existingChannels ?? [],
                channelMappings: input.channelMappings ?? {},
                conflicts
            }),
            ...planRoutingPolicies(
                bundle,
                input.existingRoutingPolicies,
                conflicts
            ),
            ...planOnCallSchedules(
                bundle,
                input.existingOnCallSchedules,
                conflicts
            )
        ]
    };
}

function planChannels(
    bundle: NotificationBundle,
    input: {
        existingChannels: StoredBundleChannel[];
        channelMappings: Record<string, number>;
        conflicts: BundleImportConflict[];
    }
): BundleImportOperation[] {
    const existingNames = new Set(
        input.existingChannels.map((channel) => channel.name)
    );
    return readObjects(bundle.channels).map((channel, index) => {
        const key = readKey(channel);
        const name = readName(channel, key);
        const channelId =
            input.channelMappings[key] ?? input.channelMappings[name];
        if (!channelId) {
            return {
                resourceType: 'channel',
                key,
                action: 'unsupported',
                message:
                    'channel import requires an explicit existing-channel mapping',
                conflicts: operationConflicts(
                    'channels',
                    index,
                    input.conflicts
                ),
                requiresSecretMapping: true,
                mappingKeys: uniqueStrings([key, name])
            };
        }
        const action = existingNames.has(name) ? 'update' : 'create';
        return {
            resourceType: 'channel',
            key,
            action,
            message: `${action} channel ${name}`,
            conflicts: operationConflicts('channels', index, input.conflicts),
            requiresSecretMapping: false,
            mappingKeys: uniqueStrings([key, name])
        };
    });
}

function planRoutingPolicies(
    bundle: NotificationBundle,
    existing: StoredRoutingPolicy[],
    conflicts: BundleImportConflict[]
): BundleImportOperation[] {
    const existingNames = new Set(existing.map((policy) => policy.name));
    return readObjects(bundle.routingPolicies).map((policy, index) => {
        const key = readKey(policy);
        const name = readName(policy, key);
        const action = existingNames.has(name) ? 'update' : 'create';
        return {
            resourceType: 'routing_policy',
            key,
            action,
            message: `${action} routing policy ${name}`,
            conflicts: operationConflicts('routingPolicies', index, conflicts),
            requiresSecretMapping: false,
            mappingKeys: []
        };
    });
}

function planOnCallSchedules(
    bundle: NotificationBundle,
    existing: StoredOnCallSchedule[],
    conflicts: BundleImportConflict[]
): BundleImportOperation[] {
    const existingNames = new Set(existing.map((schedule) => schedule.name));
    return readObjects(bundle.onCallSchedules).map((schedule, index) => {
        const key = readKey(schedule);
        const name = readName(schedule, key);
        const action = existingNames.has(name) ? 'update' : 'create';
        return {
            resourceType: 'on_call_schedule',
            key,
            action,
            message: `${action} on-call schedule ${name}`,
            conflicts: operationConflicts('onCallSchedules', index, conflicts),
            requiresSecretMapping: false,
            mappingKeys: []
        };
    });
}

function collectBundleConflicts(
    bundle: NotificationBundle,
    virtualSubjectMappings: Record<string, ImportMappingResult>
): BundleImportConflict[] {
    return [
        ...duplicateObjectConflicts('channels', bundle.channels),
        ...duplicateObjectConflicts('routingPolicies', bundle.routingPolicies),
        ...duplicateObjectConflicts('onCallSchedules', bundle.onCallSchedules),
        ...virtualSelectorConflicts(
            collectVirtualBundleSelectors(bundle),
            virtualSubjectMappings
        )
    ];
}

function duplicateObjectConflicts(
    section: string,
    value: unknown
): BundleImportConflict[] {
    const records = readObjects(value);
    return [
        ...duplicateFieldConflicts(section, records, 'id'),
        ...duplicateFieldConflicts(section, records, 'name')
    ];
}

function duplicateFieldConflicts(
    section: string,
    records: Array<Record<string, unknown>>,
    field: 'id' | 'name'
): BundleImportConflict[] {
    const seen = new Map<string, number>();
    const conflicts: BundleImportConflict[] = [];
    records.forEach((record, index) => {
        const value = readString(record[field]);
        if (!value) return;
        const normalized = value.toLowerCase();
        const first = seen.get(normalized);
        if (first == null) {
            seen.set(normalized, index);
            return;
        }
        conflicts.push({
            path: `${section}[${index}].${field}`,
            message: `duplicates ${section}[${first}].${field}: ${value}`
        });
    });
    return conflicts;
}

function operationConflicts(
    section: string,
    index: number,
    conflicts: BundleImportConflict[]
): BundleImportConflict[] {
    const prefix = `${section}[${index}].`;
    return conflicts.filter((conflict) => conflict.path.startsWith(prefix));
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}
