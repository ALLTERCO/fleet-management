import {
    type StoredOnCallSchedule,
    setOnCallSchedule
} from '../notification/OnCallScheduleStore';
import {
    type StoredRoutingPolicy,
    setRoutingPolicy
} from '../notification/RoutingPolicyStore';
import type {ImportMappingResult} from '../virtualDeviceAlerts';
import {readKey, readName, readObjects, readString} from './bundleReaders';
import {type StoredBundleChannel, setBundleChannel} from './channelModel';
import {
    type BundleImportConflict,
    type BundleImportOperation,
    type BundleImportWarning,
    planNotificationBundleImport
} from './planImport';
import type {NotificationBundle} from './schema';
import {mapVirtualResourceSelectors} from './virtualSelectors';

export interface BundleApplyResult {
    bundle: NotificationBundle;
    operations: BundleImportOperation[];
    applied: BundleImportOperation[];
    skipped: BundleImportOperation[];
    warnings: BundleImportWarning[];
    conflicts: BundleImportConflict[];
}

export interface BundleApplyDependencies {
    setBundleChannel: typeof setBundleChannel;
    setRoutingPolicy: typeof setRoutingPolicy;
    setOnCallSchedule: typeof setOnCallSchedule;
}

const defaultDependencies: BundleApplyDependencies = {
    setBundleChannel,
    setRoutingPolicy,
    setOnCallSchedule
};

export async function applyNotificationBundleImport(
    input: {
        organizationId: string;
        bundle: unknown;
        existingChannels: StoredBundleChannel[];
        existingRoutingPolicies: StoredRoutingPolicy[];
        existingOnCallSchedules: StoredOnCallSchedule[];
        channelMappings: Record<string, number>;
        virtualSubjectMappings?: Record<string, ImportMappingResult>;
    },
    dependencies: BundleApplyDependencies = defaultDependencies
): Promise<BundleApplyResult> {
    const planned = planNotificationBundleImport(input);
    const applied: BundleImportOperation[] = [];
    const skipped: BundleImportOperation[] = [];

    for (const operation of planned.operations) {
        if (operation.conflicts.length > 0) {
            skipped.push(operation);
            continue;
        }
        if (operation.resourceType === 'channel') {
            const appliedChannel = await applyChannel(
                input,
                operation,
                dependencies
            );
            if (appliedChannel) {
                applied.push(operation);
            } else {
                skipped.push(operation);
            }
            continue;
        }
        if (operation.resourceType === 'routing_policy') {
            await applyRoutingPolicy(input, operation, dependencies);
            applied.push(operation);
            continue;
        }
        if (operation.resourceType === 'on_call_schedule') {
            await applyOnCallSchedule(input, operation, dependencies);
            applied.push(operation);
            continue;
        }
        skipped.push(operation);
    }

    return {
        bundle: planned.bundle,
        operations: planned.operations,
        applied,
        skipped,
        warnings: planned.warnings,
        conflicts: planned.conflicts
    };
}

async function applyRoutingPolicy(
    input: {
        organizationId: string;
        bundle: unknown;
        existingChannels: StoredBundleChannel[];
        existingRoutingPolicies: StoredRoutingPolicy[];
        channelMappings: Record<string, number>;
        virtualSubjectMappings?: Record<string, ImportMappingResult>;
    },
    operation: BundleImportOperation,
    dependencies: BundleApplyDependencies
): Promise<void> {
    const policy = findBundleObject(
        planNotificationBundleImport({
            bundle: input.bundle,
            existingChannels: input.existingChannels,
            existingRoutingPolicies: input.existingRoutingPolicies,
            existingOnCallSchedules: [],
            channelMappings: input.channelMappings,
            virtualSubjectMappings: input.virtualSubjectMappings
        }).bundle.routingPolicies,
        operation.key
    );
    if (!policy) return;
    const existing = input.existingRoutingPolicies.find(
        (row) => row.name === readName(policy, operation.key)
    );
    await dependencies.setRoutingPolicy({
        organizationId: input.organizationId,
        policyId: existing?.id,
        parentPolicyId: null,
        name: readName(policy, operation.key),
        sortOrder: readNumber(policy.sortOrder) ?? 0,
        labelMatchers: readArray(policy.labelMatchers),
        severityMatchers: readStringArray(policy.severityMatchers),
        resourceSelectors: mapVirtualResourceSelectors(
            readArray(policy.resourceSelectors),
            input.virtualSubjectMappings ?? {}
        ),
        contactPoints: readContactPoints(policy),
        groupingKeys: readStringArray(policy.groupingKeys),
        muteWindows: readArray(policy.muteWindows),
        runtimeSilences: readArray(policy.silences),
        inhibitionRules: readArray(policy.inhibitionRules),
        escalationStages: readArray(policy.escalationStages),
        enabled: readBoolean(policy.enabled) ?? true
    });
}

async function applyOnCallSchedule(
    input: {
        organizationId: string;
        bundle: unknown;
        existingOnCallSchedules: StoredOnCallSchedule[];
    },
    operation: BundleImportOperation,
    dependencies: BundleApplyDependencies
): Promise<void> {
    const schedule = findBundleObject(
        planNotificationBundleImport({
            bundle: input.bundle,
            existingRoutingPolicies: [],
            existingOnCallSchedules: input.existingOnCallSchedules
        }).bundle.onCallSchedules,
        operation.key
    );
    if (!schedule) return;
    const existing = input.existingOnCallSchedules.find(
        (row) => row.name === readName(schedule, operation.key)
    );
    await dependencies.setOnCallSchedule({
        organizationId: input.organizationId,
        scheduleId: existing?.id,
        name: readName(schedule, operation.key),
        timezone: readString(schedule.timezone) ?? 'UTC',
        rotationRules: readArray(schedule.rotationRules),
        overrides: readArray(schedule.overrides),
        target: readObject(schedule.target),
        enabled: readBoolean(schedule.enabled) ?? true
    });
}

async function applyChannel(
    input: {
        organizationId: string;
        bundle: unknown;
        existingChannels: StoredBundleChannel[];
        existingRoutingPolicies: StoredRoutingPolicy[];
        existingOnCallSchedules: StoredOnCallSchedule[];
        channelMappings: Record<string, number>;
        virtualSubjectMappings?: Record<string, ImportMappingResult>;
    },
    operation: BundleImportOperation,
    dependencies: BundleApplyDependencies
): Promise<boolean> {
    if (operation.action === 'unsupported') return false;
    const channel = findBundleObject(
        planNotificationBundleImport({
            bundle: input.bundle,
            existingChannels: input.existingChannels,
            existingRoutingPolicies: [],
            existingOnCallSchedules: [],
            channelMappings: input.channelMappings
        }).bundle.channels,
        operation.key
    );
    if (!channel) return false;
    const name = readName(channel, operation.key);
    const channelId =
        input.channelMappings[operation.key] ?? input.channelMappings[name];
    if (!channelId) return false;
    const existing = input.existingChannels.find((row) => row.name === name);
    await dependencies.setBundleChannel({
        organizationId: input.organizationId,
        channelId: existing?.id ?? channelId,
        name,
        config: readObject(channel.config)
    });
    return true;
}

function findBundleObject(
    values: unknown[] | undefined,
    key: string
): Record<string, unknown> | null {
    return readObjects(values).find((value) => readKey(value) === key) ?? null;
}

function readContactPoints(policy: Record<string, unknown>): unknown[] {
    const explicit = readArray(policy.contactPoints);
    if (explicit.length > 0) return explicit;
    return readStringArray(policy.contactPointIds).map((id) => ({
        type: 'destination_group',
        id
    }));
}

function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
    return readArray(value).filter(
        (entry): entry is string => typeof entry === 'string'
    );
}

function readObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}
