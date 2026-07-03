import type {
    DeviceIngressRiskLevel,
    DeviceIngressSecurityModel,
    DeviceIngressTransport
} from '../../types/api/deviceIngress';

export interface RiskInput {
    securityModel: DeviceIngressSecurityModel;
    transport: DeviceIngressTransport;
    connectorRiskLevel?: DeviceIngressRiskLevel;
}

export interface RiskMatchInput extends RiskInput {
    riskLevel: DeviceIngressRiskLevel;
}

export function riskForIngress(input: RiskInput): DeviceIngressRiskLevel {
    if (input.transport === 'ws') return 'legacy';
    if (input.securityModel === 'certificate') return 'strong';
    if (input.securityModel === 'connector') {
        return input.connectorRiskLevel ?? 'compatible';
    }
    return 'compatible';
}

export function riskMatchesIngress(input: RiskMatchInput): boolean {
    return input.riskLevel === riskForIngress(input);
}

export function isLegacyTransport(transport: DeviceIngressTransport): boolean {
    return transport === 'ws';
}
