import RpcError from '../../rpc/RpcError';
import type {
    DeviceIngressProfileId,
    DeviceIngressRiskLevel,
    DeviceIngressSecurityModel,
    DeviceIngressTransport,
    DeviceIngressWaitingRoomApproveParams,
    DeviceIngressWaitingRoomRejectParams
} from '../../types/api/deviceIngress';
import {getConfigTemplate} from './configTemplates';
import {buildConnectorIdentityInput} from './connectors';
import type {
    CreateIdentityInput,
    DeviceIngressIdentity,
    DeviceIngressWaitingRoomEntry,
    EnsureApprovedFleetDeviceResult
} from './deviceIngressRepository';
import type {WaitingRoomProbe} from './waitingRoomProbeRegistry';

export interface WaitingRoomRepository {
    createIdentity(input: CreateIdentityInput): Promise<DeviceIngressIdentity>;
    getWaitingRoom(input: {
        organizationId: string;
        waitingRoomId: string;
    }): Promise<DeviceIngressWaitingRoomEntry | null>;
    approveWaitingRoom(input: {
        organizationId: string;
        waitingRoomId: string;
        identityId: string;
    }): Promise<DeviceIngressWaitingRoomEntry | null>;
    ensureApprovedFleetDevice(input: {
        organizationId: string;
        reportedExternalId: string;
    }): Promise<EnsureApprovedFleetDeviceResult | null>;
    rejectWaitingRoom(input: {
        organizationId: string;
        waitingRoomId: string;
        reasonCode: DeviceIngressWaitingRoomRejectParams['reasonCode'];
    }): Promise<DeviceIngressWaitingRoomEntry | null>;
}

export async function requireWaitingRoomEntry(input: {
    organizationId: string;
    waitingRoomId: string;
    repository: WaitingRoomRepository;
}): Promise<DeviceIngressWaitingRoomEntry> {
    const entry = await input.repository.getWaitingRoom({
        organizationId: input.organizationId,
        waitingRoomId: input.waitingRoomId
    });
    if (!entry) {
        throw RpcError.NotFound(
            'deviceIngress.waitingRoom',
            input.waitingRoomId
        );
    }
    return entry;
}

// Read-only operator probe: read the live device over the still-open socket.
// No live socket (device gone before approval) is a clean NoLiveConnection.
export async function probeWaitingRoomEntry(input: {
    organizationId: string;
    waitingRoomId: string;
    repository: WaitingRoomRepository;
    getProbe(
        organizationId: string,
        reportedExternalId: string
    ): WaitingRoomProbe | null;
}): Promise<{deviceInfo: unknown; status: unknown}> {
    const entry = await requireWaitingRoomEntry({
        organizationId: input.organizationId,
        waitingRoomId: input.waitingRoomId,
        repository: input.repository
    });
    const probe = input.getProbe(
        input.organizationId,
        entry.reportedExternalId
    );
    if (!probe) {
        throw RpcError.Domain('DeviceOffline', {
            message: `no live connection for ${entry.reportedExternalId}`
        });
    }
    const [deviceInfo, status] = await Promise.all([
        probe.sendRpc('Shelly.GetDeviceInfo'),
        probe.sendRpc('Shelly.GetStatus')
    ]);
    return {deviceInfo, status};
}

export async function approveWaitingRoomEntry(input: {
    organizationId: string;
    entry: DeviceIngressWaitingRoomEntry;
    params: DeviceIngressWaitingRoomApproveParams;
    repository: WaitingRoomRepository;
}): Promise<{
    identity: DeviceIngressIdentity;
    waitingRoom: DeviceIngressWaitingRoomEntry | null;
}> {
    await ensureFleetDeviceForApproval(input);
    const identity = await input.repository.createIdentity(
        identityInputForApproval(input)
    );
    const waitingRoom = await input.repository.approveWaitingRoom({
        organizationId: input.organizationId,
        waitingRoomId: input.params.waitingRoomId,
        identityId: identity.id
    });
    return {identity, waitingRoom};
}

async function ensureFleetDeviceForApproval(input: {
    organizationId: string;
    entry: DeviceIngressWaitingRoomEntry;
    params: DeviceIngressWaitingRoomApproveParams;
    repository: WaitingRoomRepository;
}): Promise<void> {
    if (input.params.action === 'bind_connector') return;
    const device = await input.repository.ensureApprovedFleetDevice({
        organizationId: input.organizationId,
        reportedExternalId: input.entry.reportedExternalId
    });
    if (device) return;
    throw RpcError.InvalidParams(
        'device is already assigned to another organization'
    );
}

export async function rejectWaitingRoomEntry(input: {
    organizationId: string;
    params: DeviceIngressWaitingRoomRejectParams;
    repository: WaitingRoomRepository;
}): Promise<DeviceIngressWaitingRoomEntry> {
    const entry = await input.repository.rejectWaitingRoom({
        organizationId: input.organizationId,
        waitingRoomId: input.params.waitingRoomId,
        reasonCode: input.params.reasonCode
    });
    if (!entry) {
        throw RpcError.NotFound(
            'deviceIngress.waitingRoom',
            input.params.waitingRoomId
        );
    }
    return entry;
}

function identityInputForApproval(input: {
    organizationId: string;
    entry: DeviceIngressWaitingRoomEntry;
    params: DeviceIngressWaitingRoomApproveParams;
}): CreateIdentityInput {
    const security = resolveApprovalSecurity(
        input.entry,
        input.params.profileId
    );
    const subjectId = input.params.deviceId ?? input.entry.reportedExternalId;
    if (input.params.action === 'bind_connector') {
        return {
            ...buildConnectorIdentityInput({
                organizationId: input.organizationId,
                subjectId,
                displayName: input.entry.reportedExternalId,
                transport: security.transport,
                riskLevel: security.riskLevel,
                expectedExternalId: input.entry.reportedExternalId
            }),
            status: 'active'
        };
    }
    return {
        organizationId: input.organizationId,
        subjectType: 'device',
        subjectId,
        displayName: input.entry.reportedExternalId,
        securityModel: security.securityModel,
        transport: security.transport,
        riskLevel: security.riskLevel,
        status: 'active',
        expectedExternalId: input.entry.reportedExternalId
    };
}

// Explicit profile wins; else the entry's own suggested profile; else fall back
// to how the device actually connected — so a plain "allow" needs no profile.
function resolveApprovalSecurity(
    entry: DeviceIngressWaitingRoomEntry,
    profileId: DeviceIngressProfileId | undefined
): {
    securityModel: DeviceIngressSecurityModel;
    transport: DeviceIngressTransport;
    riskLevel: DeviceIngressRiskLevel;
} {
    const resolved = profileId ?? entry.profileId;
    if (resolved) {
        const profile = getConfigTemplate(resolved);
        return {
            securityModel: profile.securityModel,
            transport: profile.transport,
            riskLevel: profile.riskLevel
        };
    }
    return {
        securityModel: entry.securityModel as DeviceIngressSecurityModel,
        transport: entry.observedTransport as DeviceIngressTransport,
        riskLevel: entry.riskLevel as DeviceIngressRiskLevel
    };
}
