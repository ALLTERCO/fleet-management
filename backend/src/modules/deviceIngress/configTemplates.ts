import type {
    DeviceIngressApplyMethod,
    DeviceIngressProfile,
    DeviceIngressProfileId
} from '../../types/api/deviceIngress';

export interface DeviceIngressCapabilityHints {
    model?: string;
    modelFamily?: string;
    componentTypes?: readonly string[];
    protocols?: readonly string[];
    supportsWss?: boolean;
    supportsPlainWs?: boolean;
}

export interface ConfigTemplate extends DeviceIngressProfile {
    provisioning: {
        applyMethods: readonly DeviceIngressApplyMethod[];
        preferredApplyMethod: DeviceIngressApplyMethod;
        requiresReboot: boolean;
    };
}

export const DEVICE_INGRESS_CONFIG_TEMPLATES: readonly ConfigTemplate[] =
    Object.freeze([
        {
            id: 'wall-display-local-ws',
            name: 'WS Token',
            securityModel: 'direct_token',
            transport: 'ws',
            riskLevel: 'legacy',
            appliesTo: {modelFamily: 'WallDisplay'},
            warnings: [
                'Plain WS is not encrypted. Use only on a trusted local network or through a connector.'
            ],
            provisioning: {
                applyMethods: ['ble', 'local_http'],
                preferredApplyMethod: 'ble',
                requiresReboot: true
            }
        },
        {
            id: 'shelly-pro-em-wss-token',
            name: 'WSS Token',
            securityModel: 'direct_token',
            transport: 'wss',
            riskLevel: 'compatible',
            appliesTo: {componentTypes: ['em', 'em1']},
            provisioning: {
                applyMethods: ['local_http', 'ws_rpc'],
                preferredApplyMethod: 'local_http',
                requiresReboot: true
            }
        },
        {
            id: 'shelly-pro-em-wss-certificate',
            name: 'WSS Certificate',
            securityModel: 'certificate',
            transport: 'wss',
            riskLevel: 'strong',
            appliesTo: {componentTypes: ['em', 'em1']},
            provisioning: {
                applyMethods: ['local_http', 'ws_rpc'],
                preferredApplyMethod: 'local_http',
                requiresReboot: true
            }
        },
        {
            id: 'modbus-tcp-connector',
            name: 'Connector',
            securityModel: 'connector',
            transport: 'modbus_tcp',
            riskLevel: 'compatible',
            appliesTo: {protocols: ['modbus_tcp']},
            provisioning: {
                applyMethods: ['connector'],
                preferredApplyMethod: 'connector',
                requiresReboot: false
            }
        }
    ]);

export function listConfigTemplates(): readonly ConfigTemplate[] {
    return DEVICE_INGRESS_CONFIG_TEMPLATES;
}

export function getConfigTemplate(id: DeviceIngressProfileId): ConfigTemplate {
    const found = DEVICE_INGRESS_CONFIG_TEMPLATES.find(
        (item) => item.id === id
    );
    if (!found) throw new Error(`unknown device ingress profile ${id}`);
    return found;
}

export function selectConfigTemplate(
    hints: DeviceIngressCapabilityHints,
    preferredId?: DeviceIngressProfileId
): ConfigTemplate | null {
    if (preferredId) return getConfigTemplate(preferredId);
    return (
        DEVICE_INGRESS_CONFIG_TEMPLATES.find((template) =>
            templateMatches(template, hints)
        ) ?? null
    );
}

function templateMatches(
    template: ConfigTemplate,
    hints: DeviceIngressCapabilityHints
): boolean {
    const appliesTo = template.appliesTo as Record<string, unknown>;
    if (typeof appliesTo.modelFamily === 'string') {
        return hints.modelFamily === appliesTo.modelFamily;
    }
    if (Array.isArray(appliesTo.componentTypes)) {
        return overlaps(hints.componentTypes, appliesTo.componentTypes);
    }
    if (Array.isArray(appliesTo.protocols)) {
        return overlaps(hints.protocols, appliesTo.protocols);
    }
    return false;
}

function overlaps(
    left: readonly string[] | undefined,
    right: readonly unknown[]
): boolean {
    if (!left) return false;
    const allowed = new Set(right.filter((item) => typeof item === 'string'));
    return left.some((item) => allowed.has(item));
}
