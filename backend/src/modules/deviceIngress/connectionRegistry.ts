import {type DeviceIngressMetricLabels, setLiveConnections} from './metrics';

export interface LiveIngressConnection {
    connectionId: string;
    organizationId: string;
    identityId: string;
    // null for a grandfathered admit; closed by identity, not by credential.
    credentialId: string | null;
    reportedExternalId: string;
    metricLabels: DeviceIngressMetricLabels;
    remoteAddressHash?: string | null;
    close(reason: string): void;
}

const byConnection = new Map<string, LiveIngressConnection>();
const byIdentity = new Map<string, Set<string>>();
const byCredential = new Map<string, Set<string>>();
const byIdentityDevice = new Map<string, Set<string>>();
const byOrganization = new Map<string, Set<string>>();
const byRemoteAddress = new Map<string, Set<string>>();
// Live count per serialized label tuple — kept incrementally so the gauge
// never scans all connections on register/unregister.
const countByLabelKey = new Map<string, number>();

export function registerConnection(input: LiveIngressConnection): void {
    unregisterConnection(input.connectionId);
    byConnection.set(input.connectionId, input);
    addIndex(byIdentity, input.identityId, input.connectionId);
    if (input.credentialId) {
        addIndex(byCredential, input.credentialId, input.connectionId);
    }
    addIndex(byOrganization, input.organizationId, input.connectionId);
    if (input.remoteAddressHash) {
        addIndex(byRemoteAddress, input.remoteAddressHash, input.connectionId);
    }
    addIndex(
        byIdentityDevice,
        identityDeviceKey(input.identityId, input.reportedExternalId),
        input.connectionId
    );
    bumpLabelCount(input.metricLabels, 1);
}

export function unregisterConnection(connectionId: string): void {
    const existing = byConnection.get(connectionId);
    if (!existing) return;
    byConnection.delete(connectionId);
    deleteIndex(byIdentity, existing.identityId, connectionId);
    if (existing.credentialId) {
        deleteIndex(byCredential, existing.credentialId, connectionId);
    }
    deleteIndex(byOrganization, existing.organizationId, connectionId);
    if (existing.remoteAddressHash) {
        deleteIndex(byRemoteAddress, existing.remoteAddressHash, connectionId);
    }
    deleteIndex(
        byIdentityDevice,
        identityDeviceKey(existing.identityId, existing.reportedExternalId),
        connectionId
    );
    bumpLabelCount(existing.metricLabels, -1);
}

export function closeIdentityConnections(
    identityId: string,
    reason: string
): number {
    return closeIndexedConnections(byIdentity.get(identityId), reason);
}

export function closeCredentialConnections(
    credentialId: string,
    reason: string
): number {
    return closeIndexedConnections(byCredential.get(credentialId), reason);
}

export function closeIdentityDeviceConnections(
    identityId: string,
    reportedExternalId: string,
    reason: string
): number {
    return closeIndexedConnections(
        byIdentityDevice.get(identityDeviceKey(identityId, reportedExternalId)),
        reason
    );
}

export function closeConnection(connectionId: string, reason: string): boolean {
    const connection = byConnection.get(connectionId);
    if (!connection) return false;
    connection.close(reason);
    unregisterConnection(connectionId);
    return true;
}

export function listLiveConnections(): LiveIngressConnection[] {
    return [...byConnection.values()];
}

export function countIdentityConnections(identityId: string): number {
    return byIdentity.get(identityId)?.size ?? 0;
}

export function countOrganizationConnections(organizationId: string): number {
    return byOrganization.get(organizationId)?.size ?? 0;
}

export function countRemoteAddressConnections(
    remoteAddressHash: string | null
): number {
    if (!remoteAddressHash) return 0;
    return byRemoteAddress.get(remoteAddressHash)?.size ?? 0;
}

export function clearConnectionRegistryForTests(): void {
    byConnection.clear();
    byIdentity.clear();
    byCredential.clear();
    byIdentityDevice.clear();
    byOrganization.clear();
    byRemoteAddress.clear();
    countByLabelKey.clear();
}

function identityDeviceKey(
    identityId: string,
    reportedExternalId: string
): string {
    return `${identityId}\u0000${reportedExternalId}`;
}

function bumpLabelCount(
    labels: DeviceIngressMetricLabels,
    delta: 1 | -1
): void {
    const key = labelKey(labels);
    const next = (countByLabelKey.get(key) ?? 0) + delta;
    if (next <= 0) countByLabelKey.delete(key);
    else countByLabelKey.set(key, next);
    setLiveConnections({labels, count: Math.max(0, next)});
}

function labelKey(labels: DeviceIngressMetricLabels): string {
    return `${labels.securityModel} ${labels.transport} ${labels.riskLevel}`;
}

function closeIndexedConnections(
    connectionIds: Set<string> | undefined,
    reason: string
): number {
    if (!connectionIds) return 0;
    let closed = 0;
    for (const connectionId of [...connectionIds]) {
        const connection = byConnection.get(connectionId);
        if (!connection) continue;
        connection.close(reason);
        unregisterConnection(connectionId);
        closed++;
    }
    return closed;
}

function addIndex(
    index: Map<string, Set<string>>,
    key: string,
    connectionId: string
): void {
    const set = index.get(key) ?? new Set<string>();
    set.add(connectionId);
    index.set(key, set);
}

function deleteIndex(
    index: Map<string, Set<string>>,
    key: string,
    connectionId: string
): void {
    const set = index.get(key);
    if (!set) return;
    set.delete(connectionId);
    if (set.size === 0) index.delete(key);
}
