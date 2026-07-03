import type {
    DeviceIngressRiskLevel,
    DeviceIngressSecurityModel,
    DeviceIngressSubjectType,
    DeviceIngressTransport
} from '../../types/api/deviceIngress';
import type {CreateIdentityInput} from './deviceIngressRepository';

export interface ConnectorIdentityInput {
    organizationId: string;
    subjectId: string;
    displayName: string;
    transport: DeviceIngressTransport;
    riskLevel: DeviceIngressRiskLevel;
    expectedExternalId?: string | null;
}

export function connectorSecurityModel(): DeviceIngressSecurityModel {
    return 'connector';
}

export function connectorSubjectType(): DeviceIngressSubjectType {
    return 'connector';
}

export function buildConnectorIdentityInput(
    input: ConnectorIdentityInput
): CreateIdentityInput {
    return {
        organizationId: input.organizationId,
        subjectType: connectorSubjectType(),
        subjectId: input.subjectId,
        displayName: input.displayName,
        securityModel: connectorSecurityModel(),
        transport: input.transport,
        riskLevel: input.riskLevel,
        status: 'pending',
        expectedExternalId: input.expectedExternalId ?? input.subjectId
    };
}

export function representedDeviceSubjectId(input: {
    connectorExternalId: string;
    childExternalId: string;
}): string {
    return `${input.connectorExternalId}:${input.childExternalId}`;
}

export function isConnectorTransport(
    transport: DeviceIngressTransport
): boolean {
    return (
        transport === 'modbus_tcp' ||
        transport === 'ble' ||
        transport === 'cloud_api' ||
        transport === 'connector_internal'
    );
}
