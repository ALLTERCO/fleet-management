import type {FlowStatus} from '@/stores/monitoring';
import {redactMonitoringPayload} from '@/helpers/monitoringRedaction';

export type RuntimeStatus = 'ok' | 'not_available' | 'invalid' | 'error';

export type RuntimeRecord = Record<string, unknown>;

export interface RuntimeIdentity {
    commit: string;
    environment: string;
    mode: string;
    client: string;
    composeProject: string;
}

export interface ContainerRow {
    name: string;
    image: string;
    status: string;
    client: string;
    environment: string;
    ownerKnown: boolean;
}

export interface ContainerSummary {
    expected: number;
    running: number;
    missing: number;
    unexpected: number;
    unknownOwner: number;
}

export interface DeviceUsageRow {
    client_id?: string;
    environment_id?: string;
    mode?: string;
    unique_active_devices?: number;
    paid_device_limit?: number | null;
    warning?: boolean;
    over_limit?: boolean;
    usage_percent?: number | null;
}

export interface RuntimeContractInput {
    versionInfo: RuntimeRecord;
    manifestPayload: RuntimeRecord | null;
    manifestError: string | null;
    deviceUsagePayload: RuntimeRecord | null;
}

export interface RuntimeContractView {
    manifest: RuntimeRecord | null;
    manifestStatus: RuntimeStatus;
    runtimeStatus: FlowStatus;
    runtimeIdentity: RuntimeIdentity;
    manifestStatusLabel: string;
    manifestChecksumLabel: string;
    manifestGeneratedAt: string;
    manifestSchema: string;
    manifestRevision: string;
    rollbackLabel: string;
    containerRows: ContainerRow[];
    containerSummary: ContainerSummary;
    deviceUsageRows: DeviceUsageRow[];
}

export function buildRuntimeContractView(
    input: RuntimeContractInput
): RuntimeContractView {
    const manifest = manifestFromPayload(input.manifestPayload);
    const runtimeIdentity = runtimeIdentityFrom(manifest, input.versionInfo);
    const containerRows = containersFrom(manifest, runtimeIdentity);
    const containerSummary = containerSummaryFrom(manifest, containerRows);
    const manifestStatus = manifestStatusFrom(
        input.manifestPayload,
        input.manifestError
    );
    const deviceUsageRows = deviceUsageRowsFrom(
        input.deviceUsagePayload,
        manifest
    );

    return {
        manifest,
        manifestStatus,
        runtimeStatus: runtimeStatusFrom(manifestStatus, containerSummary),
        runtimeIdentity,
        manifestStatusLabel: input.manifestError ? 'error' : manifestStatus,
        manifestChecksumLabel: manifestChecksumLabel(input.manifestPayload),
        manifestGeneratedAt: manifestGeneratedAt(manifest),
        manifestSchema: manifestSchema(manifest),
        manifestRevision: manifestRevision(manifest),
        rollbackLabel: rollbackLabel(manifest),
        containerRows,
        containerSummary,
        deviceUsageRows
    };
}

export function deployCheckStatus(
    manifest: RuntimeRecord | null,
    name: string
): string {
    const check = recordValue(recordValue(manifest, 'checks'), name);
    if (typeof check === 'string') return check;
    return firstString(recordValue(check, 'status')) ?? 'unknown';
}

export function runtimeStatusClass(status: string): string {
    if (['failed', 'invalid', 'critical'].includes(status)) {
        return 'runtime-danger';
    }
    if (['warning', 'degraded', 'unknown', 'not_available'].includes(status)) {
        return 'runtime-warning';
    }
    if (['passed', 'running', 'healthy', 'ok'].includes(status)) {
        return 'runtime-success';
    }
    return '';
}

export function deviceUsageStatusClass(row: DeviceUsageRow): string {
    if (row.over_limit) return 'runtime-danger';
    if (row.warning) return 'runtime-warning';
    return 'runtime-success';
}

export function deviceUsageStatusLabel(row: DeviceUsageRow): string {
    if (row.over_limit) return 'over_limit';
    if (row.warning) return 'warning';
    return 'ok';
}

export function shortSha(value: string): string {
    return value.length > 12 ? value.slice(0, 12) : value;
}

export function redactRuntimePayload(value: unknown): unknown {
    return redactMonitoringPayload(value);
}

function manifestFromPayload(
    payload: RuntimeRecord | null
): RuntimeRecord | null {
    const manifest = recordValue(payload, 'manifest');
    return isRecord(manifest) ? manifest : payload;
}

function manifestStatusFrom(
    payload: RuntimeRecord | null,
    error: string | null
): RuntimeStatus {
    const status = recordValue(payload, 'status');
    if (status === 'ok' || status === 'not_available' || status === 'invalid') {
        return status;
    }
    return error ? 'error' : 'not_available';
}

function runtimeStatusFrom(
    manifestStatus: RuntimeStatus,
    containerSummary: ContainerSummary
): FlowStatus {
    if (manifestStatus === 'invalid' || manifestStatus === 'error') {
        return 'critical';
    }
    if (manifestStatus === 'not_available') return 'warning';
    if (containerSummary.missing > 0) return 'warning';
    if (containerSummary.unexpected > 0) return 'warning';
    if (containerSummary.unknownOwner > 0) return 'warning';
    return 'healthy';
}

function runtimeIdentityFrom(
    manifest: RuntimeRecord | null,
    versionInfo: RuntimeRecord
): RuntimeIdentity {
    const runtime = recordValue(manifest, 'runtime') ?? manifest;
    const identity = recordValue(manifest, 'identity');
    return {
        commit:
            firstString(
                recordValue(runtime, 'commit'),
                recordValue(runtime, 'deployed_commit'),
                recordValue(runtime, 'build_commit'),
                recordValue(identity, 'commit'),
                recordValue(identity, 'deployed_commit'),
                recordValue(identity, 'build_commit'),
                recordValue(versionInfo, 'commit'),
                recordValue(versionInfo, 'build_commit')
            ) ?? 'unknown',
        environment:
            firstString(
                recordValue(runtime, 'environment_id'),
                recordValue(runtime, 'environment'),
                recordValue(identity, 'environment_id'),
                recordValue(identity, 'environment'),
                recordValue(versionInfo, 'environment_id')
            ) ?? 'unknown',
        mode:
            firstString(
                recordValue(runtime, 'deployment_mode'),
                recordValue(runtime, 'mode'),
                recordValue(identity, 'deployment_mode'),
                recordValue(identity, 'topology_mode'),
                recordValue(identity, 'mode'),
                recordValue(versionInfo, 'deployment_mode')
            ) ?? 'unknown',
        client:
            firstString(
                recordValue(runtime, 'client_id'),
                recordValue(identity, 'client_id'),
                recordValue(versionInfo, 'client_id')
            ) ?? 'unknown',
        composeProject:
            firstString(
                recordValue(runtime, 'compose_project_name'),
                recordValue(runtime, 'compose_project'),
                recordValue(identity, 'compose_project_name'),
                recordValue(identity, 'compose_project'),
                recordValue(versionInfo, 'compose_project_name')
            ) ?? 'unknown'
    };
}

function manifestChecksumLabel(payload: RuntimeRecord | null): string {
    const checksum = recordValue(payload, 'checksum');
    if (!checksum) return 'missing';
    return recordValue(checksum, 'value') ? 'present' : 'missing';
}

function manifestGeneratedAt(manifest: RuntimeRecord | null): string {
    return (
        firstString(
            recordValue(manifest, 'generated_at'),
            recordValue(manifest, 'deployed_at')
        ) ?? 'unknown'
    );
}

function manifestSchema(manifest: RuntimeRecord | null): string {
    return String(
        recordValue(manifest, 'schema_version') ??
            recordValue(manifest, 'manifest_version') ??
            'unknown'
    );
}

function manifestRevision(manifest: RuntimeRecord | null): string {
    const revision = recordValue(manifest, 'revision');
    if (isRecord(revision)) {
        return (
            firstString(
                recordValue(revision, 'image_tag'),
                recordValue(revision, 'commit'),
                recordValue(revision, 'deploy_script_version')
            ) ?? 'present'
        );
    }
    return String(
        revision ?? recordValue(manifest, 'manifest_revision') ?? 'unknown'
    );
}

function rollbackLabel(manifest: RuntimeRecord | null): string {
    const rollback =
        recordValue(manifest, 'rollback') ??
        recordValue(manifest, 'rollback_readiness');
    if (typeof rollback === 'boolean') return rollback ? 'ready' : 'not_ready';
    if (typeof recordValue(rollback, 'ready') === 'boolean') {
        return recordValue(rollback, 'ready') ? 'ready' : 'not_ready';
    }
    if (typeof recordValue(rollback, 'available') === 'boolean') {
        return recordValue(rollback, 'available') ? 'ready' : 'not_ready';
    }
    return firstString(recordValue(rollback, 'status')) ?? 'unknown';
}

function containersFrom(
    manifest: RuntimeRecord | null,
    identity: RuntimeIdentity
): ContainerRow[] {
    const containers: unknown[] = [];
    const topLevel = recordValue(manifest, 'containers');
    if (Array.isArray(topLevel)) containers.push(...topLevel);

    const sharedServices = recordValue(manifest, 'shared_services');
    if (isRecord(sharedServices)) {
        containers.push(...Object.values(sharedServices));
    }

    const clients = recordValue(manifest, 'clients');
    if (isRecord(clients)) {
        for (const client of Object.values(clients)) {
            const clientContainers = recordValue(client, 'containers');
            if (Array.isArray(clientContainers)) {
                containers.push(...clientContainers);
            }
        }
    }

    return containers.map((entry, index) => containerRow(entry, index, identity));
}

function containerRow(
    entry: unknown,
    index: number,
    identity: RuntimeIdentity
): ContainerRow {
    const labels = recordValue(entry, 'labels');
    const client =
        firstString(
            recordValue(labels, 'fleet.client'),
            recordValue(entry, 'client_id')
        ) ?? identity.client;
    const environment =
        firstString(
            recordValue(labels, 'fleet.environment'),
            recordValue(entry, 'environment_id')
        ) ?? identity.environment;
    return {
        name:
            firstString(
                recordValue(entry, 'name'),
                recordValue(entry, 'container_name'),
                recordValue(entry, 'service')
            ) ?? `container-${index + 1}`,
        image:
            firstString(
                recordValue(entry, 'image'),
                recordValue(entry, 'image_tag'),
                recordValue(entry, 'image_digest')
            ) ?? 'unknown',
        status:
            firstString(
                recordValue(entry, 'status'),
                recordValue(entry, 'state'),
                recordValue(entry, 'health')
            ) ?? 'unknown',
        client,
        environment,
        ownerKnown: client !== 'unknown' && environment !== 'unknown'
    };
}

function containerSummaryFrom(
    manifest: RuntimeRecord | null,
    rows: readonly ContainerRow[]
): ContainerSummary {
    const summary =
        recordValue(manifest, 'container_summary') ??
        recordValue(manifest, 'containers_summary') ??
        recordValue(manifest, 'container_inventory');
    const missing = recordValue(manifest, 'missing_containers');
    const unexpected = recordValue(manifest, 'unexpected_containers');
    const unknownOwner =
        recordValue(manifest, 'unknown_owner_containers') ??
        recordValue(manifest, 'unknownOwnerContainers');
    return {
        expected:
            numberValue(recordValue(summary, 'expected')) ??
            numberValue(recordValue(summary, 'expected_count')) ??
            rows.length,
        running:
            numberValue(recordValue(summary, 'running')) ??
            numberValue(recordValue(summary, 'running_count')) ??
            rows.filter((row) =>
                ['running', 'healthy', 'passed'].includes(row.status)
            ).length,
        missing:
            numberValue(recordValue(summary, 'missing')) ??
            (Array.isArray(missing) ? missing.length : 0),
        unexpected:
            numberValue(recordValue(summary, 'unexpected')) ??
            (Array.isArray(unexpected) ? unexpected.length : 0),
        unknownOwner:
            numberValue(recordValue(summary, 'unknown_owner')) ??
            numberValue(recordValue(summary, 'unknownOwner')) ??
            numberValue(recordValue(summary, 'unknown_owner_count')) ??
            numberValue(recordValue(summary, 'unknownOwnerCount')) ??
            numberValue(recordValue(summary, 'unknown_owner_containers')) ??
            numberValue(recordValue(summary, 'unknownOwnerContainers')) ??
            (Array.isArray(unknownOwner)
                ? unknownOwner.length
                : rows.filter((row) => !row.ownerKnown).length)
    };
}

function deviceUsageRowsFrom(
    payload: RuntimeRecord | null,
    manifest: RuntimeRecord | null
): DeviceUsageRow[] {
    for (const source of [payload, recordValue(manifest, 'device_usage')]) {
        if (!isRecord(source)) continue;
        for (const key of ['clients', 'rows', 'device_usage', 'data']) {
            const rows = recordValue(source, key);
            if (Array.isArray(rows)) return rows.map(deviceUsageRow);
        }
    }
    return [];
}

function deviceUsageRow(entry: unknown): DeviceUsageRow {
    if (!isRecord(entry)) return {};
    const status = firstString(recordValue(entry, 'status'));
    const uniqueActiveDevices =
        numberValue(recordValue(entry, 'unique_active_devices')) ??
        numberValue(recordValue(entry, 'unique_device_count'));
    const paidDeviceLimit = numberValue(recordValue(entry, 'paid_device_limit'));
    let usagePercent = numberValue(recordValue(entry, 'usage_percent'));
    if (
        usagePercent === null &&
        uniqueActiveDevices !== null &&
        paidDeviceLimit !== null &&
        paidDeviceLimit > 0
    ) {
        usagePercent = Math.round((uniqueActiveDevices / paidDeviceLimit) * 100);
    }

    return {
        ...entry,
        client_id: firstString(recordValue(entry, 'client_id')) ?? 'unknown',
        environment_id:
            firstString(recordValue(entry, 'environment_id')) ?? 'unknown',
        mode: firstString(recordValue(entry, 'mode')) ?? undefined,
        unique_active_devices: uniqueActiveDevices ?? 0,
        paid_device_limit: paidDeviceLimit,
        usage_percent: usagePercent,
        warning:
            recordValue(entry, 'warning') === true ||
            status === 'warning' ||
            status === 'near_limit',
        over_limit:
            recordValue(entry, 'over_limit') === true || status === 'over_limit'
    };
}

function recordValue(
    value: unknown,
    key: string
): RuntimeRecord | string | number | boolean | null | unknown[] | undefined {
    if (!isRecord(value)) return undefined;
    return value[key] as
        | RuntimeRecord
        | string
        | number
        | boolean
        | null
        | unknown[]
        | undefined;
}

function isRecord(value: unknown): value is RuntimeRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim() !== '') return value;
    }
    return null;
}

function numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
