// Per-role and device-level health rules for virtual devices.

import type {VirtualDeviceDto} from '../../types/api/virtualdevice';

export type VirtualDevicePresence = 'online' | 'degraded' | 'offline';

export type VirtualDeviceRoleStatus =
    | 'ok'
    | 'unavailable'
    | 'missing_source'
    | 'missing_component'
    | 'source_offline'
    | 'read_only';

export interface VirtualDeviceRoleHealth {
    roleKey: string;
    required: boolean;
    sourceOnline: boolean;
    sourcePresent: boolean;
    componentPresent: boolean;
    writableAvailable: boolean;
    status: VirtualDeviceRoleStatus;
    reason?: string;
}

export interface ComputeRoleHealthInput {
    roleKey: string;
    sourceExternalId: string;
    sourceComponentKey: string;
    sourcePresent: boolean;
    sourceOnline: boolean;
    componentPresent: boolean;
    required?: boolean;
    writable?: boolean;
}

export function computeRoleHealth(
    input: ComputeRoleHealthInput
): VirtualDeviceRoleHealth {
    const required = input.required ?? true;
    const writable = input.writable ?? false;
    let status: VirtualDeviceRoleStatus;
    let reason: string | undefined;

    if (!input.sourcePresent) {
        status = 'missing_source';
        reason = `source ${input.sourceExternalId} not found`;
    } else if (!input.sourceOnline) {
        status = writable ? 'unavailable' : 'source_offline';
        reason = `source ${input.sourceExternalId} is offline`;
    } else if (!input.componentPresent) {
        status = 'missing_component';
        reason = `component ${input.sourceComponentKey} not in source status`;
    } else {
        status = 'ok';
    }

    return {
        roleKey: input.roleKey,
        required,
        sourceOnline: input.sourceOnline,
        sourcePresent: input.sourcePresent,
        componentPresent: input.componentPresent,
        writableAvailable:
            writable && input.sourceOnline && input.componentPresent,
        status,
        ...(reason ? {reason} : {})
    };
}

export interface DeviceHealth {
    status: VirtualDevicePresence;
    reasons: string[];
}

export interface ComputeDeviceHealthInput {
    kind: VirtualDeviceDto['kind'];
    roleHealth: readonly VirtualDeviceRoleHealth[];
    // Extracted devices: presence of the host device they were carved from.
    // Null means the host is unknown to FM.
    hostPresence?: 'online' | 'offline' | 'pending' | null;
}

export function computeDeviceHealth(
    input: ComputeDeviceHealthInput
): DeviceHealth {
    const requiredBad = input.roleHealth.filter(
        (r) => r.required && r.status !== 'ok'
    );
    const reasons = requiredBad
        .map((r) => r.reason)
        .filter((r): r is string => Boolean(r));

    if (input.kind === 'extracted') {
        return extractedHealth(input, requiredBad, reasons);
    }

    if (input.kind === 'composed') {
        if (input.roleHealth.length === 0) {
            return {status: 'offline', reasons: ['no active bindings']};
        }
        const allRequiredBad =
            requiredBad.length > 0 &&
            requiredBad.length ===
                input.roleHealth.filter((r) => r.required).length;
        if (allRequiredBad) return {status: 'offline', reasons};
        if (requiredBad.length > 0) return {status: 'degraded', reasons};
        return {status: 'online', reasons: []};
    }

    // Connector / bluetooth use the generic fallback for now.
    if (requiredBad.length > 0) return {status: 'degraded', reasons};
    return {status: 'online', reasons: []};
}

function extractedHealth(
    input: ComputeDeviceHealthInput,
    requiredBad: readonly VirtualDeviceRoleHealth[],
    reasons: string[]
): DeviceHealth {
    if (input.hostPresence == null) {
        return {
            status: 'degraded',
            reasons: ['extraction source host is unknown to FM']
        };
    }
    if (input.hostPresence !== 'online') {
        const live = requiredBad.length === 0;
        return {
            status: live ? 'degraded' : 'offline',
            reasons: ['extraction source host is offline', ...reasons]
        };
    }
    if (requiredBad.length > 0) return {status: 'degraded', reasons};
    return {status: 'online', reasons: []};
}
